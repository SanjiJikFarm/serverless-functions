import axios from "axios";
import AWS from "aws-sdk";

function isValidItem(name, price, qty, total) {
  const onlyNumber = (s) => /^\d{1,3}(,\d{3})*$/.test(s);
  const hasHangul = (s) => /[가-힣]/.test(s);
  const isLikelyCode = (s) => /^[0-9]{3}$|^[0-9]{3}-[0-9]{5,}$/.test(s);

  if (!hasHangul(name) || isLikelyCode(name)) return false;
  if (!(onlyNumber(price) && onlyNumber(qty) && onlyNumber(total))) return false;

  const totalNumber = parseInt(total.replace(/,/g, ""));
  if (totalNumber <= 0) return false;

  return true;
}

// OCR 파싱 함수 
function parseReceipt(data) {
  const fields = data.images[0].fields.map((f) => f.inferText.trim());
  const items = [];
  let storeName = null;
  let date = null;
  let totalAmount = null;

  for (let i = 0; i < fields.length; i++) {
    const text = fields[i];

    // 상호명
    if (!storeName && /로컬푸드직매장/.test(text)) {
      storeName = text;
    }

    // 날짜
    if (!date && /^\d{4}-\d{2}-\d{2}/.test(text)) {
      date = text.replace(/-/g, ".");
    }

    // 총구매액
    if (!totalAmount && /총\s*구매액/.test(text)) {
      const next = fields[i + 1];
      if (/^\d{1,3}(,\d{3})*$/.test(next)) {
        totalAmount = next;
      }
    }

    // 품목 추출 로직
    const name = text;
    const price = fields[i + 1];
    const qty = fields[i + 2];
    const total = fields[i + 3];

    if (price && qty && total && isValidItem(name, price, qty, total)) {
      items.push({ name, price, qty, total });
      i += 3; 
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
