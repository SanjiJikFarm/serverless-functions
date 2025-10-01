import axios from "axios";
import AWS from "aws-sdk";

// OCR 파싱 함수
function parseReceipt(data) {
  const fields = data.images[0].fields.map((f) => f.inferText.trim());
  const items = [];
  let totalAmount = null;
  let storeName = null;
  let date = null;

  // 바코드/상품코드 제거
  const skipNumberPrefixes = ['*', '880', '2100'];
  const isValidNumber = (val) => {
    if (!/^\d+$/.test(val)) return false;
    return !skipNumberPrefixes.some((p) => val.startsWith(p));
  };

  // 상품명 여부
  const isProductLine = (text) =>
    /^P\s?[가-힣a-zA-Z]/.test(text) || /로컬푸드/.test(text);

  
  function getBestTriple(numbers) {
    if (numbers.length < 3) return null;

    for (let a of numbers) {
      for (let b of numbers) {
        if (b === a) continue;
        for (let c of numbers) {
          if (c === a || c === b) continue;
          const [p, q, t] = [parseInt(a), parseInt(b), parseInt(c)];
          if (p * q === t || Math.abs(p * q - t) <= 1) {
            return { price: a, qty: b, total: c };
          }
        }
      }
    }
    return null;
  }

  for (let i = 0; i < fields.length; i++) {
    const text = fields[i];

    // 날짜
    if (!date && /^\d{4}[.\-]\d{2}[.\-]\d{2}/.test(text)) {
      date = text.match(/\d{4}[.\-]\d{2}[.\-]\d{2}/)[0].replace(/-/g, ".");
    }

    // 점포명
    if (!storeName && /(로컬푸드|직매장|하나로마트|농협)/.test(text)) {
      storeName = text;
    }

    // 상품 
    if (isProductLine(text)) {
      let name = text.replace(/^P\s*/, '');

      const maybeNext = fields[i + 1] || '';
      if (/^[가-힣a-zA-Z\s]+$/.test(maybeNext) && !isValidNumber(maybeNext)) {
        name += " " + maybeNext.trim();
        i++;
      }

      name = name.replace(/^P\s*/, '');

      let numberCandidates = [];
      let j = i + 1;

      while (
        j < fields.length &&
        !isProductLine(fields[j]) &&
        !/총\s*구\s*매\s*액/.test(fields[j])
      ) {
        const val = fields[j].replace(/,/g, '');
        if (isValidNumber(val)) numberCandidates.push(val);
        j++;
      }

      // 최적 조합 찾기
      let best = getBestTriple(numberCandidates);

      if (!best && numberCandidates.length >= 3) {
        best = {
          price: numberCandidates[0],
          qty: numberCandidates[1],
          total: numberCandidates[2],
        };
      }

      if (best) items.push({ name, ...best });

      i = j - 1; 
    }

    // 총구매액
    if (/총\s*구\s*매\s*액/.test(text)) {
      const next = fields[i + 1]?.replace(/,/g, '');
      if (/^\d+$/.test(next)) {
        totalAmount = next;
      }
    }
  }

  return {
    storeName,
    date,
    totalAmount,
    items,
  };
}


export async function main(args) {
  console.log("디버깅: args =", JSON.stringify(args, null, 2));

  try {
    const {
      username,
      imageBase64,
      NCP_BUCKET,
      NCLOUD_ACCESS_KEY_ID,
      NCLOUD_SECRET_KEY,
      NCP_REGION,
      CLOVA_OCR_SECRET,
      CLOVA_OCR_URL,
    } = args;

    if (!imageBase64) {
      return {
        statusCode: 400,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "imageBase64가 전달되지 않았습니다." }),
      };
    }

    // AWS S3 설정
    const s3 = new AWS.S3({
      endpoint: "https://kr.object.ncloudstorage.com",
      region: NCP_REGION,
      credentials: {
        accessKeyId: NCLOUD_ACCESS_KEY_ID,
        secretAccessKey: NCLOUD_SECRET_KEY,
      },
    });

    const ext = "jpg";
    const key = `uploads/${username}/${Date.now()}.${ext}`;
    const buffer = Buffer.from(imageBase64, "base64");

    await s3
      .putObject({
        Bucket: NCP_BUCKET,
        Key: key,
        Body: buffer,
        ContentType: "image/jpeg",
      })
      .promise();

    const imageUrl = s3.getSignedUrl("getObject", {
      Bucket: NCP_BUCKET,
      Key: key,
      Expires: 600,
    });

    // Clova OCR 요청
    const body = {
      version: "V1",
      requestId: `req-${Date.now()}`,
      timestamp: Date.now(),
      images: [{ format: "jpg", name: "receipt", url: imageUrl }],
      lang: "ko",
      resultType: "string",
    };

    const response = await axios.post(CLOVA_OCR_URL, body, {
      headers: {
        "Content-Type": "application/json",
        "X-OCR-SECRET": CLOVA_OCR_SECRET,
      },
    });

    const data = response.data;

    if (!data?.images?.[0]?.fields) {
      console.error("❗ OCR 응답 오류:", JSON.stringify(data, null, 2));
      return {
        statusCode: 500,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "OCR 응답 형식이 유효하지 않음", raw: data }),
      };
    }

    const parsed = parseReceipt(data);

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(parsed),
    };
  } catch (err) {
    console.error("🔥 서버 오류:", err);
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: err.message || "알 수 없는 오류" }),
    };
  }
}
