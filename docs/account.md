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
  줄 사이 쉼표가 빠졌거나 따옴표가 둥근 따옴표(“ ”)로 바뀌었어도 아는 열쇠의 값만 하나씩 읽는다(update114).
  못 채우면 배포 로그의 `firebase-config.js 그대로(…)` 줄이 까닭을 적는다(변수가 비었는지, 글자 수와 찾은 열쇠 이름. 값은 찍지 않는다).

## 서버 자료(Firestore)와 규칙(`firebase/firestore.rules`)

| 경로 | 무엇 | 누가 |
| --- | --- | --- |
| `users/{uid}`, `users/{uid}/timetables/{id}` | 내 시간표 사본(기기 꼴, 교수 이름·출발 지점 뺌, 수업은 `{day,start,end,building,room}`), 지운 것은 `{id, sem, deleted, updated}` | 나만 |
| `profiles/{uid}` | 닉네임·계정 번호 `tag`(친구 기능을 켤 때)·찾는 열쇠 `handle`(`닉네임#번호`, 닉네임은 소문자·띄어쓰기 없이, update138)·`oldHandle`(네 자리 때 열쇠, 그때 만든 사람만), `showSchool`(학교 계정 보이기, 처음 true)·`school`(보이게 두었고 확인된 snu.ac.kr 메일일 때만 true, 규칙이 토큰으로 본다, update112) | 로그인한 사람이 uid 로 하나씩 읽음(목록째는 막음, update116), 나만 씀(관리자는 번호와 열쇠만) |
| `numbers/{번호}` | uid. 계정 번호(숫자 여섯 자리, 0으로 시작해도 됨) 하나에 한 사람(update136·139). 거둔 번호는 `{retired: true}`(누구 것이었는지 없이 남아 다시 안 줌) | 본인과 관리자만 읽음(남은 못 읽어 번호만으로 누구인지 모른다. 빈 번호인지는 누구나, update138), 내 프로필이 가리킬 때만 만들고 프로필을 지울 때만 거둠(관리자는 번호 바꿔 주기), 아무도 못 지움(콘솔만) |
| `handles/{닉네임#번호}` | uid. 친구 찾는 열쇠(update138). 예전 `닉네임#네 자리` 열쇠도 여기(그때 초대 링크가 열리게, 닉네임을 바꾸거나 계정을 지울 때까지) | 로그인한 사람이 열쇠로 하나씩 읽음(목록째는 막음), 내 프로필이 가리킬 때만 만들고 더는 안 가리킬 때 지움(닉네임 바꾸기·번호 바꿔 주기·계정 삭제. 닉네임이 들어 있어 남기지 않는다) |
| `requests/{보낸_받은}` | 친구 요청 `pending` → 받은 사람이 `accepted` | 보낸·받은 사람. 받은 사람이 막았으면 못 만든다 |
| `limits/{uid}` | 하루 요청 수 `{day, sent}`. update138 에서 세다가 update139 에서 없앴다(사용자 11/17 22:54 '20개 제한 없애기로 했음 이름이랑 같이 식별하는 걸로 바꿔서'). 그때 생긴 문서만 남아 있다 | 새로 못 쓰고 못 읽음. 본인이 지우기만(계정 삭제 때 같이 지운다) |
| `reports/{신고한_신고된_날}` | 닉네임 신고 `{reporter, target, handle(그때 닉네임#번호), reason, note(200자까지), created, state, closed}`(update138) | 본인 이름으로 만들기만(같은 사람은 하루 한 번), 읽기·처리 표시·지우기는 관리자만 |
| `blocks/{uid}/list/{상대}` | 막은 사람 | 나만 |
| `shared/{uid}/terms/{학기}` | 친구에게 보이는 사본(대표 시간표의 강좌, 일정은 제목·시간만, 숨긴 항목은 `{hidden: true, meetings: [{day,start,end}]}` 시간만) | 나와 친구만 읽음 |
| `admins/{uid}` | 관리자 표시(update134, 개발자가 콘솔에서 만든다. 필드는 아무것이나, 예: `on: true`) | 본인만 읽음(웹 개발자 메뉴가 도구를 보일지), 아무도 못 씀 |

규칙은 콘솔 Firestore > 규칙에 그대로 붙여 게시한다(백엔드가 사용자 크롬에서. 규칙 파일이 바뀌면 다시 게시). 규칙 파일의 설명은 사람이 읽는 글로 둔다
(사용자 11/17 '파이어베이스 규칙 좀 사람처럼 써봐': 판 번호·세션 이름 없이 무엇을 왜 막는지만). 시험: `.github/workflows/firebase.yml`(에뮬레이터, `tests/rules_test.mjs` 117가지,
`tests/account_e2e.mjs` 일곱 사람으로 로그인·맞추기·닉네임·닉네임#번호로 찾기·요청·수락·친구 사본·닉네임 바꾸기·다른 기기·지우기·예전 번호 옮기기·update136 꼴 고치기·
번호 바꿔 주기(0으로 시작하는 번호)·신고·막기·계정 삭제·지운 계정이 남긴 번호·열쇠 정리).

### 계정 번호와 찾는 열쇠(update136·138)

사용자 11/17 '계정마다 고유 번호 부여하고'(여섯 자리, 모두 새 번호로 정함, update136). 같은 날 법무 채팅에서 '닉네임 + 번호로 친구추가 되게 하고,
현재 닉네임과 다르면 초대 발송이 안되는 걸로'(update138: 번호만으로 찾던 136 을 바꿈).
- 번호는 처음 닉네임을 정할 때 한 번 받는다(`setNick` → `claimNumber`: 000000~999999 가운데 기기의 암호 난수로 뽑아(사용자 11/18 '0도 처음에 쓸 수 있게', update139) `numbers/{번호}`·`handles/{닉네임#번호}`·프로필을
  한 번에 쓴다. 남의 번호 문서는 못 읽어 비었는지만 보고 쓰고, 그새 누가 가져가 규칙이 막으면 다시 뽑는다). 닉네임을 바꿔도 번호는 그대로이고, 닉네임은 겹쳐도 된다
  (번호로 가른다). 본인은 번호를 못 바꾼다(관리자만, 아래).
- 친구 찾기는 지금 `닉네임#번호`만(`sync.parseHandle`, 띄어쓰기는 괜찮다). 열쇠는 `handleKey(nick, tag)`: 닉네임을 소문자로 띄어쓰기 없이 + `#번호`(규칙 `keyOf` 와 같다).
  번호만(`482193`·`#482193`)이거나 닉네임이 지금 것과 다르면 `NOT_FOUND`. 화면은 '닉네임이나 번호가 맞지 않아요'만 보이고 지금 닉네임은 알려 주지 않는다(법무 11/17).
  요청 전에 누구인지 보이려면 `find(글)` → `{uid, nick, tag, school}`.
- 닉네임을 바꾸면 새 열쇠를 만들고 예전 열쇠(네 자리 열쇠도)는 같은 쓰기에서 지운다: 바꾸기 전 초대 링크·QR 은 열리지 않는다(다시 보내야 한다).
- 예전 번호(네 자리, `닉네임#0420`): 그때 만든 프로필은 새 앱이 처음 `profile()`·`setNick()` 을 부를 때 새 번호로 옮기고, 네 자리 열쇠는 `oldHandle` 로 남겨 그때 초대 링크가
  그 사람에게 간다(닉네임을 바꾸거나 계정을 지우면 지운다). update136 판이 쓴 프로필(번호는 있고 열쇠가 없거나 `handle` 칸에 네 자리 열쇠)도 처음 읽을 때 고친다(`fixHandle`).
  옮기거나 고치지 못하면(연결 끊김) 이번엔 그대로 보이고 다음에 다시.
- 거둔 번호(법무 11/17 ⓓ: 옛 번호는 적어도 1년 남에게 주지 말 것): 관리자가 번호를 바꿔 준 뒤의 옛 번호와 지운 계정의 번호는 지우지 않고 `{retired: true}` 로 남긴다
  (누구 것이었는지는 지움). 다시 아무에게도 주지 않는다. 열쇠는 닉네임이 들어 있어 남기지 않고 지운다(법무 11/17: 지운 계정의 예전 열쇠도). 여섯 자리라 모자랄 일은 없다.
- 옛 판 앱(update138 규칙으로 에뮬레이터에서 돌려 봄. update139 에서 하루 요청 수를 없애 요청 보내기는 다시 된다): 웹은 새 판이 바로 가고, 앱 묶음은 새 판을 빨리 올린다.
  - 네 자리 때 앱: 닉네임 정하기·바꾸기(번호 받기 전)·요청·수락·친구 목록·친구 사본은 된다. 여섯 자리 사람은 못 찾는다.
    번호를 받은 뒤에는 닉네임 저장이 막힌다(`FAILED`, 예전 열쇠를 모르고 떼려 해서). 그 뒤 옛 앱으로 계정을 지우면 번호 문서와 네 자리 열쇠가 uid 를 단 채 남는다
    (프로필이 없어 `find` 는 NOT_FOUND) → 관리자가 정리한다(아래 '지운 계정이 남긴 번호·열쇠').
  - update136 판: 새 닉네임(`FAILED`)·번호로 찾기(`permission-denied`)·닉네임 바꾸기(`FAILED`)가 막히고, 계정 삭제는 마지막 쓰기(열쇠를 '안 씀'으로)가
    막혀 시간표·요청만 지운 채 멈춘다(새 판으로 다시 지우면 된다).
- 한계: 번호를 뽑는 것은 기기라, 고친 앱으로는 처음 번호를 고를 수 있다(서버 함수가 없는 무료 요금제).

### 하루 요청 수(update138 에 넣고 update139 에서 없앰)

법무 11/17 권고로 새 친구 요청을 하루 20개까지 셌다가(update138), 사용자 11/17 22:54 '20개 제한 없애기로 했음 이름이랑 같이 식별하는 걸로 바꿔서'로 없앴다.
닉네임과 번호를 같이 맞혀야 찾으니 아무에게나 무더기로 보내기 어렵다. 그때 생긴 `limits/{uid}` 는 새로 쓰지 못하고, 본인이 계정을 지울 때 같이 지운다.

### 닉네임 신고(update138)

사용자 11/17 '목록으로 모아 보는 이 방식으로 가자', 법무 11/17 승인. 앱 안 신고를 켜는 날은 처리방침 다음 판 시행일이다(그때까지 화면은 메일 신고 `reportLink`).
- `report(사람, 까닭, 덧붙임?)` → `reports/{신고한 uid}_{신고된 uid}_{날}` = `{reporter, target, handle(그때 닉네임#번호), reason, note, created, state: 'open'}`.
  까닭 `REPORT_REASONS`: `nick`(부적절한 닉네임)·`impersonation`(사칭)·`stranger`(모르는 사람의 친구 요청)·`other`. 덧붙임은 200자까지(넘으면 자른다).
  같은 사람은 하루 한 번(`ALREADY`), 나는 `SELF`, 까닭이 틀리면 `BAD_REASON`.
- 읽기·처리는 관리자만: 웹 개발자 메뉴의 `닉네임 신고`(처리 안 한 것을 새것 먼저, [처리]) 또는 `listReports({ all })`·`closeReport(id)`(`state: 'closed'`, `closed` 때).
  신고한 사람은 신고된 사람에게 알리지 않는다(관리자 화면에도 보이지 않는다). 처리하고 1년이 지나면 관리자가 콘솔에서 지운다. 신고한 사람·신고된 사람이 계정을 지워도
  신고는 그때까지 남는다.

### 번호 바꿔 주기(관리자, update134·136·138·139)

11/17 사용자 '태그 번호는 아무나 원하는 걸 할 수 없고 원하는 사람에 한해서 내가 바꿔줄 수 있는 번호로 바꿔주는 방식'. 번호는 저절로 뽑히고(고르는 칸 없음),
바꾸고 싶은 사람은 메일로 부탁한다(`tagLink(p)`: 제목 `[번호 바꾸기] 닉네임 민지#482193`, 화면 버튼은 디자인 152판 ⑥). 개발자가 웹에서 바꿔 준다.
- 관리자 만들기(한 번): 콘솔 Authentication > Users 에서 내 계정의 사용자 UID 를 복사 → Firestore > 데이터 > 컬렉션 시작 `admins` → 문서 ID 에 그 UID,
  필드 `on`(boolean) `true` → 저장. 누가 관리자인지는 저장소에 적지 않는다. 그만두려면 그 문서를 지운다.
- 쓰기: 웹(archi142857.github.io/tt-wizard)에서 그 계정으로 로그인 → 개발자 메뉴 → `번호 바꿔 주기`에 `닉네임#번호`(관리자는 번호만도, 예전 `닉네임#네 자리`도)와
  새 여섯 자리 번호 → 바꾸기(`adminSetTag`). 다른 사람이 쓰거나 거둔 번호면 `TAKEN`, 없으면 `NOT_FOUND`. 앱 묶음에는 개발자 메뉴가 없다(웹만).
- 규칙: 관리자는 남의 프로필에서 `tag`·`handle`·`updated` 만 바꾸고 닉네임은 못 바꾼다. 새 번호·새 열쇠 문서는 같은 쓰기에서 그 사람 프로필이 가리키는 것만 만들고,
  옛 번호 문서는 프로필이 더는 안 가리킬 때만 거둔다(`{retired: true}`), 옛 열쇠는 지운다. 거둔 번호는 관리자도 다시 못 준다(`TAKEN`). 남의 시간표·친구·요청은 관리자도 못 본다.
- 바뀐 사람의 앱은 프로필을 서버에서 다시 읽을 때(`profile()`, 친구 화면) 새 번호를 본다. 친구 관계는 uid 로 이어져 그대로다. 옛 닉네임#번호로는 더 찾을 수 없다.
- 부탁 받는 법(법무 11/17): 그 계정에 로그인한 Google 메일 주소에서 온 부탁만(다른 주소면 거절), 무료로만(돈·선물·기프티콘을 받으면 거래가 된다. 이용자끼리 사고팔기도
  이용 규칙으로 막는다), 거절할 번호: 남과 헷갈리는 것, 운영자처럼 보이는 것(000000·100000 같은), 욕·성적인 뜻으로 읽히는 것. 바꾼 기록은 부탁 메일이 대신한다(1년 뒤 지움).
  메일 본문 두 줄은 `TAG_MAIL_BODY`(`tagLink` 가 채운다). 앱의 `번호 바꾸기 부탁` 버튼은 디자인 153판에서 뺐다(사용자 '개인적으로 아는 사람만 바꿔줄 거임').
  아는 사람에게 바꿔 줄 때도 돈·선물은 받지 않는다(법무 11/17).

### 지운 계정이 남긴 번호·열쇠(관리자, update139)

옛 판 앱(번호를 받기 전 판)으로 계정을 지우면 그 앱이 모르는 번호 문서와 예전 네 자리 열쇠가 uid 를 단 채 남는다. 지운 계정의 개인정보라 늦어도 5일 안에 지운다
(법무 11/17, 개인정보 보호법 제21조 '지체 없이'). 옛 판이 남아 있는 동안 며칠에 한 번 본다.
- 쓰기: 웹 개발자 메뉴 → `지운 계정이 남긴 번호·열쇠` → `찾기`(`adminOrphans`: 번호·열쇠 목록을 읽고 그 uid 의 프로필이 없는 것) → 수만 보인다(열쇠 이름은 안 보임)
  → `정리`(`adminCleanOrphans`: 번호는 `{retired: true}` 로 거두고 열쇠는 지운다).
- 규칙: 번호·열쇠 목록은 관리자만 읽는다. 거두기·지우기는 지금처럼 그 uid 의 프로필이 없을 때만 된다(쓰는 번호·열쇠는 관리자도 못 건드린다).

## 화면이 부르는 것

`web/js/account.js` 머리 주석(available·ready·onUser·signIn·signOut·deleteAccount·sync(store)·syncStatus·onSyncStatus·forget·profile·setNick·friends·find·request·accept·
decline·cancel·unfriend·block·unblock·friendTimetables·publish·inviteLink·reportLink·tagLink·isAdmin·adminSetTag·report·listReports·closeReport·adminOrphans·
adminCleanOrphans, 오류 code 와 `REPORT_REASONS`). 순수 셈은 `web/js/sync.js`(node 시험 `tests/sync_runner.mjs`).
- 디자인 130판(update112): 숨긴 항목은 친구에게 시간만(회색 칸), 학교 계정 표시는 `setNick(nick, { showSchool })`·`profile().showSchool`·`friends()` 사람마다 `school`
  (화면 글 `학교 계정(snu.ac.kr)`, 법무 11/11 ①), 동기화 줄은 `syncStatus(store)`·`onSyncStatus(cb)`(`idle`·`syncing`·`offline`·`error`·`signedOut`와 마지막으로 맞춘 때 `last`,
  기기 `syncLast`), 이미 친구에게 `request` 는 `ALREADY`, 신고 메일 제목 `[신고] 닉네임 민지#482193`. 닉네임을 바꿔도 번호는 그대로다(update136).
- SDK 는 로그인한 적이 있는 기기에서만 받는다(update115, 법무 11/15): 로그인하면 기기에 `ttw.signedIn` 표시를 두고 로그아웃·계정 삭제 때 지운다. 표시가 없으면
  `ready()`·`onUser` 는 SDK 없이 '로그인 안 함'(gstatic·Firebase 로 아무것도 보내지 않음), `signIn()` 이 그때 받는다. 표시 전 판에서 로그인한 기기는 Firebase 저장소
  (`firebaseLocalStorageDb` 의 `firebaseLocalStorage` 에 `firebase:authUser:` 열쇠가 있을 때)를 보고 이어 간다. update116: 저장소는 Firebase 를 켜기만 해도 생기고
  로그아웃해도 남아서, 115 는 있는지만 보고 로그아웃한 기기에서도 SDK 를 받았다(11/15 사이트에서 확인). 이제 사용자 열쇠를 보고, SDK 를 받은 뒤 사용자가 없으면
  표시를 지운다(115 가 빈 저장소를 보고 둔 표시도 한 번 받은 뒤 풀린다). 시험 `tests/lazy_runner.mjs`.
- 웹 데모 주소 `?demo`(update115, 사용자 11/15 '지금 다 열자'): 개발자 메뉴의 '로그인'과 같다(그 탭만, 주소에서는 지운다). 11/15 처리방침 새 판과 함께
  `ACCOUNT_FROM` 을 열어(update116) 이제 쓸 일이 없다. 앱 데모 빌드(release 의 `demo`)는 update117 에서 뺐다.
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
- 계정 삭제: 서버의 내 시간표·친구 사본·막은 목록·요청·찾는 열쇠·프로필(update138 때 남은 하루 요청 수도)을 지우고 번호는 '안 씀'으로 남긴 뒤 계정을 지운다(오래전에 로그인했으면 다시 로그인).
  기기 자료는 그대로. 내가 한 신고와 나를 신고한 것은 관리자가 처리하고 1년 뒤 지울 때까지 남는다(update138).
  남이 나를 막아 둔 기록(`blocks/{그 사람}/list/{내 uid}`, 차단한 때만)은 그 사람 자료라 남는다(계정이 지워져 누구인지 알 수 없는 번호). 지운 시간표의 '지움 표시'는 계정과 함께 지워진다.
  앱 없이 메일로 청하면 개발자가 콘솔에서 그 메일의 인증 계정(Authentication > Users)과 위 문서를 손으로 지운다(관리용 키·서버는 쓰지 않는다).
- 처리방침·이용 규칙·계정 삭제 안내(update116, 11/15 시행): `docs/legal/privacy.md`·`terms.md`·`delete-account.md` → https://archi142857.github.io/tt-wizard/privacy/ ·…/terms/ ·…/delete-account/
  (`scripts/legal_pages.py`). 로그인 카드의 '이용 규칙에 동의해요'가 …/terms/ 를, Play 데이터 보안의 계정 삭제 칸이 …/delete-account/ 를 쓴다.
  처리방침에 쓴 사실(11/15 백엔드 확인): Firebase 인증 기록에는 Google 메일·메일 확인 여부·uid·Google 계정 번호·이름·프로필 사진 주소·가입·마지막 로그인 때가 남는다
  (Google 로그인이면 이름·사진 주소가 저절로 들어간다). IP 기록은 몇 주, 지운 사용자는 실제 시스템과 백업에서 180일 안(https://firebase.google.com/support/privacy),
  Firestore 는 Google Cloud 삭제 약속 최대 약 180일(https://docs.cloud.google.com/security/deletion). 개발자 쪽 백업은 없다(무료 요금제라 지난 시점 복구·예약 백업을 켤 수 없다.
  켜게 되면 처리방침부터 고친다). Firestore 저장 위치는 asia-northeast3(서울), Firebase 인증은 미국에서만 돈다. 우리 사이트·앱은 쿠키를 쓰지 않는다(로그인 상태는 IndexedDB·앱 저장공간).
