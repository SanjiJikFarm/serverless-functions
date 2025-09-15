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

    if (!date && /^\d{4}[.\-]\d{2}[.\-]\d{2}/.test(text)) {
      date = text.split(" ")[0].replace(/-/g, ".");
    }

    if (!storeName && /(로컬푸드|직매장|마트|판매장)/.test(text)) {
      storeName = text;
    }

    // 상품명 + 금액
    if (text.startsWith("P")) {
      let price = null, qty = null, total = null;
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

    // 총구매액
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

// S3 설정
const s3 = new AWS.S3({
  endpoint: "https://kr.object.ncloudstorage.com",
  region: process.env.NCP_REGION,
  credentials: {
    accessKeyId: process.env.NCP_ACCESS_KEY,
    secretAccessKey: process.env.NCP_SECRET_KEY,
  },
});

// Presigned URL로 OCR 요청하는 방식
async function uploadImageToS3AndGetUrl(userId, imageBase64) {
  const key = `uploads/${userId}/${Date.now()}.jpg`;
  const buffer = Buffer.from(imageBase64, "base64");

  await s3.putObject({
    Bucket: process.env.NCP_BUCKET,
    Key: key,
    Body: buffer,
    ContentType: "image/jpeg",
  }).promise();

  const url = s3.getSignedUrl("getObject", {
    Bucket: process.env.NCP_BUCKET,
    Key: key,
    Expires: 60 * 10, // 10분
  });

  return url;
}

// 분석된 결과도 S3에 JSON으로 저장
async function uploadToObjectStorage(userId, parsed) {
  const key = `results/${userId}/${Date.now()}.json`;
  await s3.putObject({
    Bucket: process.env.NCP_BUCKET,
    Key: key,
    Body: JSON.stringify(parsed, null, 2),
    ContentType: "application/json",
  }).promise();

  return s3.getSignedUrl("getObject", {
    Bucket: process.env.NCP_BUCKET,
    Key: key,
    Expires: 60 * 10,
  });
}

export async function main(args) {
  try {
    const userId = args.userId || "testuser";
    const imageBase64 = args.imageBase64;
    const NCP_BUCKET = args.NCP_BUCKET;
    const NCP_ACCESS_KEY = args.NCP_ACCESS_KEY;
    const NCP_SECRET_KEY = args.NCP_SECRET_KEY;
    const NCP_REGION = args.NCP_REGION;
    const CLOVA_OCR_SECRET = args.CLOVA_OCR_SECRET;
    const CLOVA_OCR_URL = args.CLOVA_OCR_URL;

    if (!imageBase64) {
      return { error: "imageBase64가 전달되지 않았습니다." };
    }

    const s3 = new AWS.S3({
      endpoint: "https://kr.object.ncloudstorage.com",
      region: NCP_REGION,
      credentials: {
        accessKeyId: NCP_ACCESS_KEY,
        secretAccessKey: NCP_SECRET_KEY,
      },
    });

    const key = `uploads/${userId}/${Date.now()}.jpg`;
    const buffer = Buffer.from(imageBase64, "base64");

    await s3.putObject({
      Bucket: NCP_BUCKET,
      Key: key,
      Body: buffer,
      ContentType: "image/jpeg",
    }).promise();

    const imageUrl = s3.getSignedUrl("getObject", {
      Bucket: NCP_BUCKET,
      Key: key,
      Expires: 600,
    });

    const body = {
      version: "V1",
      requestId: `request-${Date.now()}`,
      timestamp: Date.now(),
      images: [
        {
          format: "jpg",
          name: "receipt",
          url: imageUrl,
        },
      ],
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
      return { error: "OCR 응답 형식이 유효하지 않음", raw: data };
    }

    const parsed = parseReceipt(data);

    const resultKey = `results/${userId}/${Date.now()}.json`;

    await s3.putObject({
      Bucket: NCP_BUCKET,
      Key: resultKey,
      Body: JSON.stringify(parsed, null, 2),
      ContentType: "application/json",
    }).promise();

    const resultUrl = s3.getSignedUrl("getObject", {
      Bucket: NCP_BUCKET,
      Key: resultKey,
      Expires: 600,
    });

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...parsed, fileUrl: resultUrl }),
    };    
  } catch (err) {
    console.error("🔥 최종 에러:", err);
    return { error: err.message || "알 수 없는 오류" };
  }
}
