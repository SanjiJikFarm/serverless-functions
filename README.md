# 🌱 SanjiJikFarm - Serverless OCR Pipeline

산지직팜 프로젝트를 위한 서버리스 기반 OCR 파이프라인입니다.  
이 파이프라인은 **Naver CLOVA OCR**을 활용하여 사용자의 영수증 이미지를 분석하고, **Naver Cloud Functions** 환경에서 **비동기 이벤트 기반**으로 동작합니다.

> **주요 목적**: 영수증 자동 인식 + 소비 내역 추출 → 탄소 절감량 계산 및 ESG 소비 리포트 제공


## ✨ 주요 기능

- 사용자가 업로드한 **영수증 이미지**를 CLOVA OCR로 인식
- **매장명, 날짜, 품목, 단가, 수량, 총액** 등 주요 항목 추출
- 추출 결과(JSON)를 **Object Storage에 저장**
- **Presigned URL**로 클라이언트에게 결과 전달
- 이후 소비 리포트 및 ESG 탄소 절감 시각화로 연계



## 🏗️  Architecture Diagram

<img width="770" height="406" alt="Image" src="https://github.com/user-attachments/assets/71e79147-3019-4479-b1eb-541a45318465" />


## ⚙️ 기술 스택 

| 컴포넌트        | 기술 스택            |
|----------------|----------------------|
| 서버리스 백엔드 | Node.js + NCP Functions | 
| OCR API        | Naver CLOVA OCR      | 
| 스토리지       | NCP Object Storage | 
| 통신 방식      | Presigned URL + Axios | 

