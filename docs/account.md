# 로그인·기기 간 동기화·친구 시간표 (백엔드 update110)

사용자 11/14 "로그인이랑 친구 시간표도 지금 작업 시작하라고", "16일에 데모데이 출품해야 해서 그때까지 다 구현되어야 함". 설계는 공유 폴더 `계정_동기화_설계안.md`(로그인은 구글, 사용자 11/11).
**처리방침 전면 개정 전이라 남에게는 열지 않는다**: 데모는 사용자 계정 둘로만. 공개 전에 처리방침·이용약관·Play 데이터 보안·계정 삭제 웹 경로를 고친다(법무·문서).

## 쓰는 것

- Firebase 프로젝트 `tt-wizard`(사용자 Google 계정, Spark). Authentication: Google 로그인, 허용 도메인 `archi142857.github.io`.
  Cloud Firestore `(default)`. 안드로이드 앱 `com.ttwizard.app`(서명 지문 SHA-1·SHA-256 둘씩 등록됨), 웹 앱 `TT Wizard Web`.
- Firebase JS SDK 12.19.0 을 로그인을 쓸 때만 gstatic 에서 받는다(`account.js` 의 `SDK_URL`, Apache-2.0). 앱 묶음에 넣지 않는다.
- 웹 설정 값: GitHub 저장소 변수 `FIREBASE_WEB_CONFIG`(Settings > Secrets and variables > Actions > Variables). 콘솔 > 프로젝트 설정 > 내 앱 > TT Wizard Web 의
  '구성'(`const firebaseConfig = {…}` 를 그대로 붙여도 된다)에 앱 안 로그인용 `googleClientId`(Authentication > Google > 웹 SDK 구성의 웹 클라이언트 ID)를 더한다.
  배포(pages·app·release)의 `export_web.py` 가 `web/js/firebase-config.js` 를 채운다. 저장소의 그 파일은 `export default null`(값이 없으면 로그인이 숨는다).

## 서버 자료(Firestore)와 규칙(`firebase/firestore.rules`)

| 경로 | 무엇 | 누가 |
| --- | --- | --- |
| `users/{uid}`, `users/{uid}/timetables/{id}` | 내 시간표 사본(기기 꼴, 교수 이름·출발 지점 뺌, 수업은 `{day,start,end,building,room}`), 지운 것은 `{id, sem, deleted, updated}` | 나만 |
| `profiles/{uid}` | 닉네임·태그(친구 기능을 켤 때) | 로그인한 사람이 읽음, 나만 씀 |
| `handles/{닉네임#태그}` | uid(겹치지 않게) | 로그인한 사람이 읽음, 내 것만 만들고 지움 |
| `requests/{보낸_받은}` | 친구 요청 `pending` → 받은 사람이 `accepted` | 보낸·받은 사람. 받은 사람이 막았으면 못 만든다 |
| `blocks/{uid}/list/{상대}` | 막은 사람 | 나만 |
| `shared/{uid}/terms/{학기}` | 친구에게 보이는 사본(대표 시간표의 강좌, 일정은 제목·시간만) | 나와 친구만 읽음 |

규칙은 콘솔 Firestore > 규칙에 그대로 붙여 게시한다(백엔드가 사용자 크롬에서). 시험: `.github/workflows/firebase.yml`(에뮬레이터, `tests/rules_test.mjs` 26가지,
`tests/account_e2e.mjs` 두 사람으로 로그인·맞추기·닉네임·요청·수락·친구 사본·다른 기기·지우기·막기·계정 삭제).

## 화면이 부르는 것

`web/js/account.js` 머리 주석(available·ready·onUser·signIn·signOut·deleteAccount·sync(store)·profile·setNick·friends·request·accept·decline·cancel·
unfriend·block·unblock·friendTimetables·publish·inviteLink·reportLink). 순수 셈은 `web/js/sync.js`(node 시험 `tests/sync_runner.mjs`).

- 맞추기: 기기 자료가 먼저. 같은 id 는 `updated` 가 늦은 쪽, 지운 것은 지움 표시로 다른 기기에서도 지운다(지난번 서버에 있던 id 를 기기 `syncKnown` 에 둔다).
  처음 로그인 때 이름이 겹치면 '이름 (2)'. 학기마다 대표는 하나(늦게 고친 쪽). 받은 시간표는 이 기기의 출발 지점·교수 이름을 이어 쓴다.
- 친구에게 숨기기: 항목 `hidden: true`, 시간표 `shareOff: true`(timetables.js parseList 가 남긴다). 친구 기능을 켠 뒤(닉네임이 있으면) 맞출 때마다 친구 사본을 올린다.
- 앱 안 로그인: 웹뷰는 구글 창을 못 띄워 `TTW_APP.googleSignIn()`(앱 플러그인, update111)이 폰의 계정 고르기로 받은 id 토큰을 넘긴다.
- 계정 삭제: 서버의 내 시간표·친구 사본·막은 목록·요청·닉네임·프로필을 지우고 계정을 지운다(오래전에 로그인했으면 다시 로그인). 기기 자료는 그대로.
