import axios from "axios";
import AWS from "aws-sdk";

// OCR 파싱 함수 
function parseReceipt(data) {
  const fields = data.images[0].fields.map((f) => f.inferText.trim());
  const items = [];
  let totalAmount = null;
  let storeName = null;
  let date = null;

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

     // 상품명 + 금액
     if (/^P\s?[가-힣a-zA-Z]/.test(text)) {
      let name = text.replace(/^P\s*/, ''); 
      let price = null, qty = null, total = null;

      const maybeNext = fields[i + 1] || "";
      if (/^[^\d]*$/.test(maybeNext) && !/^(\*|880|2100)/.test(maybeNext)) {
        name += " " + maybeNext;
        i++; 
      }

      let count = 0;
      for (let j = i + 1; j < fields.length && count < 3; j++) {
        const val = fields[j].replace(/,/g, '');
        if (/^\d+$/.test(val)) {
          if (!price) price = val;
          else if (!qty) qty = val;
          else if (!total) total = val;
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