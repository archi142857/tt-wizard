// Firebase 웹 설정 — 백엔드 update110. 저장소에는 비워 두고(null), 배포(GitHub Actions)가 저장소 변수 FIREBASE_WEB_CONFIG(JSON)로 채운다
// (scripts/export_web.py --firebase). 값은 Firebase 콘솔 > 프로젝트 설정 > 내 앱 > TT Wizard Web 의 구성, googleClientId 는 웹 클라이언트 ID(앱 안 구글 로그인).
// 비어 있으면 로그인·동기화·친구가 숨는다(account.available() 이 false).
export default null;
