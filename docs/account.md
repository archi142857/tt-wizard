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
  비밀값(Secrets) 탭에 같은 이름으로 넣어도 읽는다(`FIREBASE_WEB_CONFIG_SECRET`, update113). 중괄호 없이 `열쇠: "값"` 줄만 붙여도 된다.
  못 채우면 배포 로그의 `firebase-config.js 그대로(…)` 줄이 까닭을 적는다(변수가 비었는지, 글자 수와 찾은 열쇠 이름. 값은 찍지 않는다).

## 서버 자료(Firestore)와 규칙(`firebase/firestore.rules`)

| 경로 | 무엇 | 누가 |
| --- | --- | --- |
| `users/{uid}`, `users/{uid}/timetables/{id}` | 내 시간표 사본(기기 꼴, 교수 이름·출발 지점 뺌, 수업은 `{day,start,end,building,room}`), 지운 것은 `{id, sem, deleted, updated}` | 나만 |
| `profiles/{uid}` | 닉네임·태그(친구 기능을 켤 때), `showSchool`(학교 계정 보이기, 처음 true)·`school`(보이게 두었고 확인된 snu.ac.kr 메일일 때만 true, 규칙이 토큰으로 본다, update112) | 로그인한 사람이 읽음, 나만 씀 |
| `handles/{닉네임#태그}` | uid(겹치지 않게) | 로그인한 사람이 읽음, 내 것만 만들고 지움 |
| `requests/{보낸_받은}` | 친구 요청 `pending` → 받은 사람이 `accepted` | 보낸·받은 사람. 받은 사람이 막았으면 못 만든다 |
| `blocks/{uid}/list/{상대}` | 막은 사람 | 나만 |
| `shared/{uid}/terms/{학기}` | 친구에게 보이는 사본(대표 시간표의 강좌, 일정은 제목·시간만, 숨긴 항목은 `{hidden: true, meetings: [{day,start,end}]}` 시간만) | 나와 친구만 읽음 |

규칙은 콘솔 Firestore > 규칙에 그대로 붙여 게시한다(백엔드가 사용자 크롬에서. 규칙 파일이 바뀌면 다시 게시). 시험: `.github/workflows/firebase.yml`(에뮬레이터, `tests/rules_test.mjs` 33가지,
`tests/account_e2e.mjs` 두 사람으로 로그인·맞추기·닉네임·요청·수락·친구 사본·다른 기기·지우기·막기·계정 삭제).

## 화면이 부르는 것

`web/js/account.js` 머리 주석(available·ready·onUser·signIn·signOut·deleteAccount·sync(store)·syncStatus·onSyncStatus·forget·profile·setNick·friends·request·accept·
decline·cancel·unfriend·block·unblock·friendTimetables·publish·inviteLink·reportLink). 순수 셈은 `web/js/sync.js`(node 시험 `tests/sync_runner.mjs`).
- 디자인 130판(update112): 숨긴 항목은 친구에게 시간만(회색 칸), 학교 계정 표시는 `setNick(nick, { showSchool })`·`profile().showSchool`·`friends()` 사람마다 `school`
  (화면 글 `학교 계정(snu.ac.kr)`, 법무 11/11 ①), 동기화 줄은 `syncStatus(store)`·`onSyncStatus(cb)`(`idle`·`syncing`·`offline`·`error`·`signedOut`와 마지막으로 맞춘 때 `last`,
  기기 `syncLast`), 이미 친구에게 `request` 는 `ALREADY`, 신고 메일 제목 `[신고] 닉네임 민지#0420`. 같은 닉네임으로 다시 저장하면 태그를 그대로 둔다.
- 로그아웃·계정 삭제 때 `이 기기의 시간표도 지우기`를 고르면 화면이 기기 시간표를 지운 뒤 `forget(store)` 를 부른다: 맞추기 기록(`syncKnown`·`syncLast`)이 남아 있으면
  다시 로그인할 때 서버 시간표를 '이 기기에서 지운 것'으로 보고 지움 표시를 올린다.

- 맞추기: 기기 자료가 먼저. 같은 id 는 `updated` 가 늦은 쪽, 지운 것은 지움 표시로 다른 기기에서도 지운다(지난번 서버에 있던 id 를 기기 `syncKnown` 에 둔다).
  처음 로그인 때 이름이 겹치면 '이름 (2)'. 학기마다 대표는 하나(늦게 고친 쪽). 받은 시간표는 이 기기의 출발 지점·교수 이름을 이어 쓴다.
- 친구에게 숨기기: 항목 `hidden: true`, 시간표 `shareOff: true`(timetables.js parseList 가 남긴다). 친구 기능을 켠 뒤(닉네임이 있으면) 맞출 때마다 친구 사본을 올린다.
- 앱 안 로그인(update111): 웹뷰는 구글 로그인 창을 못 띄운다(구글이 막는다). 그래서 앱 플러그인 `TTWAuth`(`AuthPlugin.java`)가 폰의 구글 계정 고르기
  (AndroidX Credential Manager 의 'Google 계정으로 로그인' 시트, `GetSignInWithGoogleOption`)로 id 토큰을 받고, `native.js` 의 `TTW_APP.googleSignIn({ clientId })` 로
  `account.js` 에 넘긴다. `account.js` 는 `GoogleAuthProvider.credential(idToken)` 으로 Firebase 에 들어간다(웹뷰 안 Firebase 가 로그인 상태를 IndexedDB 에 둔다).
  - `clientId` 는 Firebase 웹 클라이언트 ID(`googleClientId`, GitHub 변수 `FIREBASE_WEB_CONFIG` 의 중괄호 안에 한 줄). 없으면 `NO_CONFIG`.
  - 폰이 그 앱의 서명을 Google 에 묻는다: Firebase 안드로이드 앱 `com.ttwizard.app` 에 그 빌드의 서명 SHA-1 이 있어야 한다(지금: Play 앱 서명 키·업로드 키).
    Play(내부·비공개 테스트)로 깐 앱은 된다. 디버그 APK 는 만든 PC·실행기의 디버그 키라 안 된다(`NO_ACCOUNT` 또는 `FAILED`) → 데모는 release 워크플로의 데모 빌드를 내부 테스트로.
  - 닫으면 `null`(취소), 폰에 구글 계정이 없거나 서명이 없으면 `NO_ACCOUNT`, 앱이 옛 판(플러그인 없음)이면 `APP_LOGIN`.
  - 로그아웃은 Firebase 로그아웃과 `TTW_APP.googleSignOut()`(다음 로그인 때 계정을 다시 고르게).
  - 권한은 더하지 않는다(라이브러리가 들여오는 생체 인증 권한은 매니페스트에서 뺀다). 고지문은 `licenses/google.txt`·`androidx.txt`.
- 에뮬레이터 시험 `tests/account_e2e.mjs` 는 결과를 `node:assert` 로 확인한다(update111): 같은 요청을 두 번 보내도·이미 친구여도 막히지 않고(`request` 가 먼저 내 요청을 본다),
  친구가 아닌 사람의 사본은 `NOT_FRIEND`, 숨긴 항목·메모·교수 이름·출발 지점·일정 장소는 친구에게 안 보인다.
- 계정 삭제: 서버의 내 시간표·친구 사본·막은 목록·요청·닉네임·프로필을 지우고 계정을 지운다(오래전에 로그인했으면 다시 로그인). 기기 자료는 그대로.
