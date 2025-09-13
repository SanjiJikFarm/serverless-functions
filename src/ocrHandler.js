import axios from "axios";
import FormData from "form-data";
import AWS from "aws-sdk";

  // OCR 결과 파싱 함수
  function parseReceipt(data) {
    const fields = data.images[0].fields.map(f => f.inferText.trim());
    const items = [];
    let totalAmount = null;
    let storeName = null;
    let date = null;

    for (let i = 0; i < fields.length; i++) {
      const text = fields[i];

      // 날짜 (YYYY.MM.DD or YYYY-MM-DD 패턴)
      if (!date && /^\d{4}[.\-]\d{2}[.\-]\d{2}/.test(text)) {
        date = text.split(" ")[0].replace(/-/g, ".");
      }

      // 매장명 (로컬푸드 / 직매장 / 마트 / 판매장)
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

    return { date, storeName, items, totalAmount };
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

  // Object Storage 업로드
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
    const response = await axios.post(process.env.CLOVA_OCR_URL, formData, {
      headers: {
        "X-OCR-SECRET": process.env.CLOVA_OCR_SECRET,
        ...formData.getHeaders(),
      },
    });

    // 결과 파싱 + 저장
    const parsed = parseReceipt(response.data);
    const userId = req.body?.userId || "defaultUser";
    const fileUrl = await uploadToObjectStorage(userId, parsed);

    res.status(200).json({
      ...parsed,
      fileUrl,
    });
  } catch (err) {
    const errorMessage = err.response?.data || err.message;
    console.error("❌ OCR 처리 실패:", errorMessage);
    res.status(500).json({ error: errorMessage });
  }
}
