# sanjijikfarm-serverless

이 레포지토리는 **산지직팜 프로젝트**를 위한 서버리스 함수 코드입니다.  
네이버 **Clova OCR**을 활용하여 영수증 이미지를 인식하고,  
**NCP Cloud Functions** 환경에서 동작하며, 인식 결과를 **Object Storage**에 저장합니다.

---

## ✨ 주요 기능
- 사용자가 업로드한 영수증 이미지를 Clova OCR API로 전달
- OCR 결과에서 주요 항목 파싱:
  - 상품명 / 단가 / 수량 / 금액
  - 총구매액
- 파싱된 JSON 결과를 **Object Storage**에 업로드
- Cloud Functions + API Gateway 연동을 전제로 설계

---

## 📂 프로젝트 구조
serverless-functions/
├── src/
│ ├── index.js # 엔트리포인트 (Cloud Functions 호출 지점)
│ └── ocrHandler.js # OCR 호출 + 파싱 + Object Storage 업로드
│
├── package.json
├── README.md
└── .gitignore
