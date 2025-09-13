import axios from "axios";
import dotenv from "dotenv";
import FormData from "form-data";

dotenv.config();

// 파서 함수
function parseReceipt(data) {
  const fields = data.images[0].fields.map(f => f.inferText.trim());
  const items = [];
  let totalAmount = null;

  for (let i = 0; i < fields.length; i++) {
    const text = fields[i];

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

    if (text.includes("총구매액")) {
      const amount = fields[i + 1] || "";
      if (/^\d{1,3}(,\d{3})*$/.test(amount)) {
        totalAmount = amount;
      }
    }
  }
  return { items, totalAmount };
}

// Cloud Functions 엔트리포인트
export async function main(req, res) {
  try {
    const formData = new FormData();

    formData.append("file", req.files[0].buffer, {
      filename: req.files[0].originalname,
      contentType: req.files[0].mimetype
    });

    const message = JSON.stringify({
      version: "V2",
      requestId: "serverless-request",
      timestamp: new Date().getTime(),
      images: [{ format: "jpg", name: "receipt" }]
    });
    formData.append("message", message);

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

    const parsed = parseReceipt(response.data);
    res.status(200).json(parsed);

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.response?.data || err.message });
  }
}
