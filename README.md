# 🌱 SanjiJikFarm - Serverless OCR Pipeline

산지직팜 프로젝트를 위한 서버리스 기반 OCR 파이프라인입니다.  
이 파이프라인은 **Naver CLOVA OCR**을 활용하여 사용자의 영수증 이미지를 분석하고, **Naver Cloud Functions** 환경에서 **비동기 이벤트 기반**으로 동작합니다.

> **주요 목적**: 영수증 자동 인식 + 소비 내역 추출 → 탄소 절감량 계산 및 ESG 소비 리포트 제공

---

## ✨ 주요 기능

- 사용자가 업로드한 **영수증 이미지**를 CLOVA OCR로 인식
- **매장명, 날짜, 품목, 단가, 수량, 총액** 등 주요 항목 추출
- 추출 결과(JSON)를 **Object Storage에 저장**
- **Presigned URL**로 클라이언트에게 결과 전달
- 이후 소비 리포트 및 ESG 탄소 절감 시각화로 연계

---

## 🏗️  Architecture Diagram

![OCR 구조도](https://private-user-images.githubusercontent.com/192183202/510724942-9fb6a64d-fb68-4f0d-97d4-50ec943388e6.png?jwt=eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJpc3MiOiJnaXRodWIuY29tIiwiYXVkIjoicmF3LmdpdGh1YnVzZXJjb250ZW50LmNvbSIsImtleSI6ImtleTUiLCJleHAiOjE3NjI0MjgwNzcsIm5iZiI6MTc2MjQyNzc3NywicGF0aCI6Ii8xOTIxODMyMDIvNTEwNzI0OTQyLTlmYjZhNjRkLWZiNjgtNGYwZC05N2Q0LTUwZWM5NDMzODhlNi5wbmc_WC1BbXotQWxnb3JpdGhtPUFXUzQtSE1BQy1TSEEyNTYmWC1BbXotQ3JlZGVudGlhbD1BS0lBVkNPRFlMU0E1M1BRSzRaQSUyRjIwMjUxMTA2JTJGdXMtZWFzdC0xJTJGczMlMkZhd3M0X3JlcXVlc3QmWC1BbXotRGF0ZT0yMDI1MTEwNlQxMTE2MTdaJlgtQW16LUV4cGlyZXM9MzAwJlgtQW16LVNpZ25hdHVyZT00MjZhMGQwYjZjY2M5OTIwMmY1MDljNDZmZmZlZmNhODAwNjYxZDkxM2VkOTY2N2NkZTY0YzIxNDExZWZjNmM2JlgtQW16LVNpZ25lZEhlYWRlcnM9aG9zdCJ9.R31H7aDJ8nW9FBYENrDPr_2RvH796g8cn_lb-sNc7X8)


## ⚙️ 기술 스택 및 선정 이유

| 컴포넌트        | 기술 스택            | 선정 이유 |
|----------------|----------------------|-----------|
| 서버리스 백엔드 | Node.js + NCP Functions | I/O 중심 작업에 적합, 경량 런타임, 빠른 Cold Start |
| OCR API        | Naver CLOVA OCR      | 한글 기반 영수증 인식 성능 우수 |
| 스토리지       | Naver Object Storage | Presigned URL 기반 안전한 접근 제어 |
| 통신 방식      | Presigned URL + Axios | 서버리스 환경에서 비동기 및 보안 처리 용이 |

