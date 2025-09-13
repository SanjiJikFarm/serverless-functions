import axios from "axios";
import FormData from "form-data";
import AWS from "aws-sdk";

// OCR 결과 파싱 함수
function parseReceipt(data) {
  const fields = data.images[0].fields.map(f => f.inferText.trim());
  const items = [];
  let totalAmount = null;

  for (let i = 0; i < fields.length; i++) {
    const text = fields[i];

    // 상품명 후보: P로 시작하는 문자열
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

    // 총구매액 찾기
    if (text.includes("총구매액")) {
      const amount = fields[i + 1] || "";
      if (/^\d{1,3}(,\d{3})*$/.test(amount)) {
        totalAmount = amount;
      }
    }
  }

  return { items, totalAmount };
}

// Object Storage 클라이언트
const s3 = new AWS.S3({
  endpoint: "https://kr.object.ncloudstorage.com",
  region: process.env.NCP_REGION,
  credentials: {
    accessKeyId: process.env.NCP_ACCESS_KEY,
    secretAccessKey: process.env.NCP_SECRET_KEY,
  },
});

// Object Storage 업로드 함수
async function uploadToObjectStorage(userId, data) {
  const key = `receipts/${userId}/${Date.now()}.json`;

  const params = {
    Bucket: process.env.NCP_BUCKET,
    Key: key,
    Body: JSON.stringify(data, null, 2),
    ContentType: "application/json",
  };

  await s3.putObject(params).promise();

  return `https://kr.object.ncloudstorage.com/${process.env.NCP_BUCKET}/${key}`;
}

// Cloud Functions 엔트리포인트
export async function main(req, res) {
  try {
    const formData = new FormData();
    formData.append("file", req.files[0].buffer, {
      filename: req.files[0].originalname,
      contentType: req.files[0].mimetype,
    });

    const message = JSON.stringify({
      version: "V2",
      requestId: "serverless-request",
      timestamp: new Date().getTime(),
      images: [{ format: "jpg", name: "receipt" }],
    });
    formData.append("message", message);

    // OCR 호출
    const response = await axios.post(
      process.env.CLOVA_OCR_URL,
      formData,
      {
        headers: {
          "X-OCR-SECRET": process.env.CLOVA_OCR_SECRET,
          ...formData.getHeaders(),
        },
      }
    );

    // OCR 결과 파싱
    const parsed = parseReceipt(response.data);

    // Object Storage 업로드
    const fileUrl = await uploadToObjectStorage("user123", parsed);

    // 최종 응답
    res.status(200).json({
      ...parsed,
      fileUrl,
    });
  } catch (err) {
    console.error("❌ OCR 처리 실패:", err.response?.data || err.message);
    res.status(500).json({ error: err.response?.data || err.message });
  }
}
