import axios from "axios";
import AWS from "aws-sdk";

// OCR 파싱 함수
function parseReceipt(data) {
  const fields = data.images[0].fields.map((f) => f.inferText.trim());
  const items = [];
  let totalAmount = null;
  let storeName = null;
  let date = null;

  // 숫자 필터: 바코드/상품코드 제외
  const skipNumberPrefixes = ['880', '2100'];
  const isValidNumber = (val) => {
    if (!/^\d+$/.test(val)) return false;
    return !skipNumberPrefixes.some((p) => val.startsWith(p));
  };

  for (let i = 0; i < fields.length; i++) {
    const text = fields[i];

    // 날짜
    if (!date && /^\d{4}[.\-]\d{2}[.\-]\d{2}/.test(text)) {
      date = text.split(" ")[0].replace(/-/g, ".");
    }

    // 점포 이름
    if (!storeName && /(로컬푸드|직매장|하나로마트|농협)/.test(text)) {
      storeName = text;
    }

    // 상품명 
    if (/^P\s?[가-힣a-zA-Z]/.test(text)) {
      let name = text.replace(/^P\s*/, '');

      const maybeNext = fields[i + 1] || '';
      if ((name.includes('로컬푸드') || name === '·' || name.length <= 2) &&
          /^[가-힣a-zA-Z\s]+$/.test(maybeNext)) {
        name = maybeNext.trim();
        i++; 
      }

      // P 제거
      name = name.replace(/^P\s*/, '');

      // 가격, 수량, 총액 추출
      let price = null, qty = null, total = null;
      let count = 0;
      for (let j = i + 1; j < fields.length && count < 4; j++) {
        const val = fields[j].replace(/,/g, '');
        if (isValidNumber(val)) {
          if (!price) price = val;
          else if (!qty) qty = val;
          else if (!total) total = val;
          count++;
        }
      }

      // 순서가 꼬인 경우 교정
      if (price && qty && total) {
        const p = parseInt(price), q = parseInt(qty), t = parseInt(total);
        if (p < 100 && q < 10 && t > 1000) {
          [price, qty, total] = [total, price, qty];
        }

        items.push({ name, price, qty, total });
      }
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
