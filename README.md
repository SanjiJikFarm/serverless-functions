# serverless-functions
 NCP Cloud Functions에서 동작하는 Clova OCR 함수 코드입니다.

## 기능
- 영수증 이미지 OCR 호출 (Clova OCR)
- 상품명 / 단가 / 수량 / 금액 파싱
- 총구매액 추출
- Cloud Functions + API Gateway로 제공

## 파일 구조
- index.js : 엔트리포인트
- ocrHandler.js : OCR 호출 및 파싱 로직