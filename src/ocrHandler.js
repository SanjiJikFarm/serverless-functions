import axios from "axios";
import AWS from "aws-sdk";

// OCR 결과 파싱 함수
function parseReceipt(data) {
  const fields = data.images[0].fields.map((f) => f.inferText.trim());
  const items = [];
  let totalAmount = null;
  let storeName = null;
  let date = null;

  const garbageKeywords = [
    "주소", "대표", "전화", "사업자", "송순영", "단가", "수량", "금액",
    "총구매액", "내실금액", "현금", "카드", "승인", "코드", "P", "로컬푸드"
  ];

  for (let i = 0; i < fields.length; i++) {
    const text = fields[i];

    // 날짜 
    if (!date && /^\d{4}[.\-]\d{2}[.\-]\d{2}/.test(text)) {
      date = text.replace(/-/g, ".");
      continue;
    }

    // 점포명 
    if (!storeName && /(로컬푸드|직매장|마트|판매장)/.test(text)) {
      storeName = text;
      continue;
    }

    // 총 금액 추출
    if (text.includes("총구매액")) {
      const amount = fields[i + 1] || "";
      if (/^\d{1,3}(,\d{3})*$/.test(amount)) {
        totalAmount = amount;
      }
      continue;
    }

    // 쓰레기 필터
    if (garbageKeywords.some((kw) => text.includes(kw))) {
      continue;
    }

    // 품목 추정
    if (/^[A-Za-z가-힣0-9()]{2,}/.test(text)) {
      let price = null,
          qty = null,
          total = null;
      let count = 0;

      for (let j = i + 1; j < fields.length && count < 3; j++) {
        if (/^\d{1,3}(,\d{3})*$/.test(fields[j])) {
          if (!price) price = fields[j];
          else if (!qty) qty = fields[j];
          else if (!total) total = fields[j];
          count++;
        }
      }

      if (price && qty && total) {
        items.push({ name: text, price, qty, total });
        i += count; 
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


// 디폴트 파라미터 기반
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
