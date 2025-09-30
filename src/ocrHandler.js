import axios from "axios";
import AWS from "aws-sdk";

// OCR 결과 파싱 함수
function parseReceipt(data) {
  const fields = data.images[0].fields.map((f) => f.inferText.trim());
  const items = [];
  let totalAmount = null;
  let storeName = null;
  let date = null;

  for (let i = 0; i < fields.length; i++) {
    const text = fields[i];

    // 날짜 추출
    if (!date && /^\d{4}[.\-]\d{2}[.\-]\d{2}/.test(text)) {
      date = text.split(" ")[0].replace(/-/g, ".");
    }

    // 매장명 추출
    if (!storeName && /(로컬푸드|직매장|마트|판매장)/.test(text)) {
      storeName = text;
    }

    // 상품명 + 금액
    if (/^[A-Za-z가-힣0-9]{2,}/.test(text)) {
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
      }
    }

    // 총구매액 추출
    if (text.includes("총구매액")) {
      const amount = fields[i + 1] || "";
      if (/^\d{1,3}(,\d{3})*$/.test(amount)) {
        totalAmount = amount;
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

// 메인 엔트리 함수
export async function main(args) {
  try {
    const {
      username,
      imageBase64,
    } = args;

    const NCP_BUCKET = process.env.NCP_BUCKET;
    const NCLOUD_ACCESS_KEY_ID = process.env.NCLOUD_ACCESS_KEY_ID;
    const NCLOUD_SECRET_KEY = process.env.NCLOUD_SECRET_KEY;
    const NCP_REGION = process.env.NCP_REGION;
    const CLOVA_OCR_SECRET = process.env.CLOVA_OCR_SECRET;
    const CLOVA_OCR_URL = process.env.CLOVA_OCR_URL;

    if (!imageBase64) {
      return {
        statusCode: 400,
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ error: "imageBase64가 전달되지 않았습니다." }),
      };
    }

    // S3 설정
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
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ error: "OCR 응답 형식이 유효하지 않음", raw: data }),
      };
    }

    const parsed = parseReceipt(data);

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(parsed),
    };
  } catch (err) {
    console.error("🔥 서버 오류:", err);
    return {
      statusCode: 500,
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ error: err.message || "알 수 없는 오류" }),
    };
  }
}
