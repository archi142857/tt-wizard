# 저장한 시간표 (web/js/timetables.js)

SNUTT 처럼 분반을 직접 골라 시간표를 만들고 저장하는 '내 시간표'와, 탐색 결과마다의 `저장하기`가 쓰는 자료 형식과 함수다(2026-10-22 사용자 요청).
백엔드 세션이 정한다. 화면(탭, 시간표 칸, 버튼, 기기에 두기)은 프론트엔드 세션(`web/js/app.js`), 모양과 문구는 디자인 세션이 맡는다
(디자인 시스템 66판 '10월 22일 저녁': 이름 `시간표 n`, 복사본 `시간표 1 (2)`, 겹치면 묻지 않고 바꿔 넣은 뒤 되돌리기, `편람 바뀜`·`없는 과목`·`없는 분반`, 색 `item-0`~`item-7`).

- `web/js/timetables.js`: 저장 형식, 시간표·항목 다루기, 편람과 맞추기, 기기에서 읽기·쓰기 모양. 화면과 기기 저장은 하지 않는 순수 함수다(받은 것을 고치지 않고 새로 돌려준다).
- `web/js/engine.js` 의 `checkRoute`: 정해진 시간표 하나의 동선(`동선 확인하기`).
- 시험: `tests/test_timetables.py`(`tests/timetables_runner.mjs` 를 node 로 부른다).

## 저장 형식

학기마다 목록 하나. 기기에만 둔다(서버로 보내지 않는다).

```
시간표 { v: 1, id, sem: "2026-2", title, created, updated,      ISO 시각
         primary?: true,                                        학기마다 하나('대표 시간표', 앞으로 위젯·오늘 수업이 쓴다)
         source: "manual" | "search",                           직접 만든 것 | 탐색 결과에서 저장한 것
         from?: { home, mode },                                 탐색에서 저장했을 때의 출발·이동 기준
         items: [항목, ...] }

강좌 항목 { course: 교과목번호, no: 강좌번호, name, instructor, credit, cls,   과목이 편람에서 사라져도 보이게 적어 둔다
           base: [[요일, 시작, 끝, 건물, 강의실], ...],                       저장할 때(또는 '편람 바뀜'을 본 것으로 할 때)의 편람 수업
           own?: [[...], ...],                                              사용자가 정한 수업(강의실 미정에 고른 건물, 바꾼 시간·장소)
           alts?: [분반 키, ...],                                           같은 시간·건물의 다른 분반(탐색은 이런 분반을 하나로 묶어 찾는다)
           color }                                                          색 번호 0~7(`COLORS` = 8. 화면의 `item-0`~`item-7`)

직접 넣은 일정 { custom: id, title, meetings: [[요일, 시작, 끝, 건물, ""], ...], memo?, color }
```

요일 0 = 월, 시각은 자정부터 센 분, 건물은 `campus.json` 의 지점 id(모르면 `""`). 항목의 열쇠(`itemKey`)는 강좌면 `교과목번호-강좌번호`(엔진의 분반 `key` 와 같다),
직접 넣은 일정이면 그 `custom` id 다. 한 시간표에 한 과목은 분반 하나만 둔다.

## 함수

| 함수 | 하는 일 |
| --- | --- |
| `createTimetable(list, sem, {title, source, from, items})` | 새 시간표. 이름을 안 주면(빈칸뿐이어도) `시간표 n`, 주면 그 이름(겹치면 `이름 (2)`부터 비는 번호). 학기의 첫 시간표면 대표. 학기마다 `PER_SEMESTER_MAX`(50)개까지(넘으면 `null`) |
| `nextTitle(list)` | 새 시간표의 기본 이름 `시간표 n`(n 은 1 부터 이 학기에 비는 가장 작은 번호). 저장하기는 이름을 묻지 않고 이것으로 만든다 |
| `renameTimetable(t, title, list)` | `{t}` 또는 `{problem: "empty" \| "duplicate"}`. 이름은 공백을 줄이고 `TITLE_MAX`(30)자까지 |
| `copyTimetable(t, list)` | 복사본 `이름 (2)`부터 비는 번호(디자인 규칙 `시간표 1 (2)`. 이름 끝의 ` (n)` 은 떼고 붙인다). 대표는 옮기지 않는다 |
| `deleteTimetable(list, id)`, `setPrimary(list, id)` | 지우기(대표를 지우면 가장 최근에 고친 것이 대표), 대표 바꾸기 |
| `sectionItem(course, section, {meetings, alts})` | 편람 분반 → 강좌 항목. `meetings` 가 편람과 다르면 `own` 으로 |
| `customItem({title, meetings, memo})` | 직접 넣은 일정 항목 |
| `addItem(t, item, {force, byId})` | 넣기 → `{t, overlaps, removed}`. 시간이 겹치는 항목이 있으면 넣지 않고 받은 `t` 그대로, `overlaps: [열쇠]`. `force` 면 겹친 것을 빼고 넣는다(SNUTT 와 같다). 같은 과목의 다른 분반은 바꿔 넣고 색은 그대로. `removed` 는 이번에 빠진 항목들(겹쳐서 뺀 것 + 바꿔 넣느라 뺀 것). 받은 `t` 는 고치지 않으니 되돌리기는 그것을 다시 쓰면 된다. `byId`(지금 편람)를 주면 겹침을 지금 편람 기준으로 본다 |
| `overlapsWith(t, meetings, {except, course, byId})` | 이 수업들과 겹치는 항목 열쇠들(항목의 시간을 바꾸기 전에 물을 때) |
| `removeItem(t, key)`, `updateItem(t, key, patch)` | 빼기, 고치기(`undefined` 인 칸은 지운다) |
| `credits(t)` | 학점 합 |
| `itemsFromRanked(ev, byId)` | 탐색 결과 하나(`search().ranked[i]`) → 항목들. 저장하기는 `createTimetable(list, sem, {source: "search", from, items})` |
| `findSaved(list, ev, byId)` | 이 탐색 결과와 같은 시간표가 이미 있으면 그 시간표(`저장됨`) |
| `reconcile(t, byId)` | 지금 편람과 견준 항목들 `[{key, item, meetings, state, live, missing}]`(아래) |
| `acknowledge(t, byId, {key})` | '편람 바뀜'을 본 것으로(`base` 를 지금 편람 값으로). `key` 를 주면 그 항목만(항목 시트를 닫을 때), 안 주면 모두. 바뀐 것이 없으면 받은 `t` 그대로 |
| `toSections(t, byId)` | 엔진이 읽는 분반 모양. `checkRoute` 와 시간표 칸 그리기에 쓴다 |
| `serialize(list)` / `parseList(raw, sem)` | 기기에 둘 값 / 기기에서 읽은 값 → 목록(모양이 어긋난 것은 버리고 나머지는 살린다. 색 번호는 0~7 로) |
| `STORE_KEYS`, `hasTimetables(raw)`, `colorMode(raw)` | 기기에 두는 열쇠 이름, 이 학기에 이 판이 읽는 시간표가 있나(첫 탭), 칸 색 설정 읽기(아래 '기기에 두기') |
| `addTimetableToPng(png, t)` | 시간표 그림(PNG 바이트)에 시간표 자료를 파일 안의 글 조각으로 넣은 새 PNG(아래 '이미지 파일에 담기'). PNG 가 아니면 `null` |
| `readTimetableImage(bytes)` | 고른 이미지 파일 → `{payload}` 또는 `{problem}`(`not-png`·`jpeg`·`no-data`·`broken`·`newer`) |
| `timetableFromImage(payload, list)` | 읽은 자료 → 새 시간표(학기는 `payload.sem`, `list` 는 그 학기 목록. 이름이 겹치면 `(2)`, 꽉 찼으면 `null`) |
| `widgetData(terms, {name, place, minutes, home, colors})` | 홈 화면 위젯 자료(아래 '홈 화면 위젯'). `terms = [{t: 대표 시간표, entries}]`, 결과를 `TTW_APP.updateWidgets` 에 넘긴다 |
| `widgetSemesters(sems, now)`, `termDates(sem)`, `termLabel(sem)` | 위젯에 넘길 학기(끝나지 않은 학기를 시작 차례로 셋까지), 위젯이 학기를 보이는 날들, `2026년 2학기` |
| `widgetDataFromStore({get, keys, campus, travel})` | 기기에 둔 값(대표 시간표·출발 지점·이동 기준·칸 색)만으로 위젯 자료. 앱 연결(`native.js`)이 앱을 켤 때·내릴 때 부른다 |

`checkRoute(sections, travel, home, {weights})`(`engine.js`)는 `evaluate` 와 같은 모양(요일별 경로 `legs`, `cost` 등)에
`overlaps: [[i, j], ...]`(시간이 겹치는 분반 쌍)을 더해 돌려준다. 탐색 결과를 저장한 시간표는 `checkRoute(toSections(t, byId), …)` 가 탐색 때와 같은 비용·경로를 낸다(시험이 본다).

## 편람과 맞추기

강좌 항목은 편람을 따른다(SNUTT 처럼). 편람은 하루 네 번 새로 받으니 화면은 그릴 때 `reconcile` 로 견준다.

| `state` | 뜻 | 쓰는 수업(`meetings`) |
| --- | --- | --- |
| `same` | 저장할 때 본 편람과 같다 | 지금 편람(`own` 이 있으면 `own`) |
| `changed` | 편람이 바뀌었다('편람 바뀜') | 지금 편람(`own` 이 있으면 `own`). `acknowledge` 하면 `same` |
| `gone` | 편람에서 사라졌다. `missing` 이 `"course"` 면 과목째(`없는 과목`), `"section"` 이면 과목은 있고 분반만(`없는 분반`) | 적어 둔 `own` 이나 `base` |
| `custom` | 직접 넣은 일정 | 그 일정 |

`live` 는 지금 편람의 분반(없으면 `null`)이라 `live.status === "폐강대상"` 이면 `폐강 대상`을 달 수 있다. `missing` 은 `gone` 이 아니면 `null`.
디자인 규칙: `편람 바뀜` 은 항목 시트를 닫을 때 그 항목만 `acknowledge(t, byId, {key})` 한다.

과목·항목 시트의 `수강편람` 링크: 수강신청 사이트는 과목 하나를 여는 주소가 없다. 강의계획서(`/sugang/cc/cc103.action`)·검색
(`/sugang/cc/cc100InterfaceSrch.action`) 주소를 바로 열면 첫 화면으로 돌아간다(10/22 브라우저로 확인. 첫 화면은 접속 대기열(NetFunnel)을 거친다).
그래서 링크는 `https://sugang.snu.ac.kr/` 를 기기 브라우저로 열고(과목·항목 시트의 `강의평` 옆. 10/23 부터 과목 추가는 검색과 분반 행뿐이라 링크가 없다), 그 사이트 검색에는
시트에 보이는 교과목번호(시트 머리)·강좌번호(분반 행)를 넣는다. 번호 복사는 넣지 않는다(디자인 67판. 길게 눌러 고를 수 있다).
스크린리더 이름은 `서울대학교 수강편람`(그 과목 화면이 아니라서). 주소에 아무것도 붙이지 않으니 처리방침에는 바깥 링크로만 적는다.

## 이미지 파일에 담기 (10/23)

사용자: 시간표를 이미지로 내보내고, 그 이미지로 시간표를 똑같이 불러오게. "OCR 방식 대신", "이미지 자체에 텍스트로 입력하라는 게 아니라 파일 자체에".

- PNG 는 그림 말고도 글 조각(chunk)을 담는다. 화면이 그린 시간표 그림의 끝(`IEND`) 앞에 `iTXt` 조각 하나를 넣는다:
  열쇠 `TTWizard`(`IMAGE_KEY`), 압축 없음, 글 = `imagePayload(t)` 의 JSON(UTF-8). 그림을 보는 프로그램은 이 조각을 지나친다(그림은 그대로. 시험이 Pillow 로 연다).
- 넣는 것: `{app: "ttwizard", v: 1, sem, title, items}`. 항목은 저장 형식 그대로(강좌의 교과목번호·강좌번호·과목명·교수·학점·구분·`base`·`own`·`alts`·색,
  직접 넣은 일정의 이름·시간·장소·색)에서 **메모만 뺀다**(그림에 안 보이는 사사로운 글). 시간표 id·만든 때·대표 표시·탐색 기준(`from`)도 넣지 않는다.
- 불러오기: `readTimetableImage` 가 그 조각만 읽고(CRC 가 틀리거나 JSON 이 아니면 `broken`), `timetableFromImage` 가 기기에서 읽을 때(`parseList`)와 같은 규칙으로
  다듬어 새 시간표를 만든다(어긋난 항목은 버린다, 직접 넣은 일정은 새 id). 남이 만든 파일이라도 그 이상은 하지 않는다.
- 조각은 파일을 그대로 옮길 때만 남는다. 메신저가 '사진'으로 보내며 다시 압축하면(JPEG 로 바뀐다, `jpeg`) 사라지고, 화면 캡처도 마찬가지다(`no-data`).
  '파일'로 보내거나 사진·파일 앱에 저장한 것은 남는다. 화면 문구는 디자인이 정한다.
- `IMAGE_VERSION`(1)은 뜻을 바꿀 때만 올린다. 옛 앱은 새 판 이미지를 `newer` 로 알린다.
- 앱에서 내보내기: `TTW_APP.shareImage({bytes, name, title})`(공유 시트)·`TTW_APP.saveImage({bytes, name})`(사진에 저장, 10/30 부터 모든 기기).
  `docs/app.md` '시간표 이미지'. 웹은 화면이 내려받기(`<a download>`)나 `navigator.share` 로.
- 불러오기의 파일 고르기는 `<input type="file" accept="image/png">`(`capture` 를 붙이지 않는다: 붙이면 앱이 카메라 권한을 묻는다).
  화면에서는 항목 목록 맨 아래의 `이미지로 추가`, 내보내기는 머리 줄 공유 버튼의 `이미지로 공유`와 목록 시트의 `이미지로 저장`(10/23 저녁부터).

## 링크에 담기 (10/23 저녁, 프론트엔드)

사용자: "링크로 공유 했을 때 어플이 있으면 어플 켜서 시간표 추가, 어플 없으면 웹으로 시간표 띄우는 기능". 코드는 `web/js/app.js` '공유' 절
(`linkPayload`·`linkCode`·`readLinkCode`·`linkToPayload`), 화면 정리는 `web/README.md` '공유'. 받은 것은 이미지와 같은 길(`timetableFromImage`)로 넣는다.

- 주소: `<웹 앱 주소>#t=<글>`. 웹은 지금 연 주소(설치한 웹 앱도), 앱은 `TTW_APP.remote` 가 https 주소면 그것, 아니면 `https://archi142857.github.io/tt-wizard/`.
  `#` 뒤는 브라우저가 서버로 보내지 않아 GitHub Pages 기록과 메신저의 링크 미리보기 서버에는 시간표가 가지 않는다(메신저 대화에는 주소 그대로 남는다).
- 글: `z` + base64url(deflate-raw(JSON)). 압축 스트림(`CompressionStream`)이 없는 브라우저는 `j` + base64url(JSON). 받는 쪽은 64 KB 가 넘는 글과
  풀어서 256 KB 가 넘는 것(압축 폭탄)은 읽지 않는다. 압축만 하고 암호화하지 않아 주소를 가진 누구나 풀 수 있다.
- JSON: `[판(1), 학기, 이름, 항목들]`. 강좌 항목은 배열 `[교과목번호, 강좌번호, 색, 과목명, 바꾼 수업?]` 만 넣는다. 교수·학점·구분·편람 수업은 받는 쪽이
  그 학기 편람에서 채워서 주소가 짧다(과목 넷 + 일정 하나가 300자 남짓. 이미지에 넣는 자료를 그대로 넣으면 600자쯤). 과목명은 받는 쪽 편람에 그 강좌가 없을 때
  쓴다(`없는 과목`으로 남는다). 보내는 쪽 편람에 없는 강좌와 직접 넣은 일정은 이미지에 넣는 항목 그대로(객체). **메모는 넣지 않는다**(이미지와 같다).
- 판(첫 칸)이 이 화면보다 크면 `newer`, 모양이 어긋나면 `broken`, 압축을 풀 수 없는 브라우저면 `old`(화면 문구는 `LINK_PROBLEM`).
- 받기: 웹은 '공유받은 시간표' 시트로 보여 주고 `내 시간표에 넣기`, 앱은 보여 주지 않고 바로 넣는다(그 학기에 새 시간표, 다른 학기면 그 학기로 옮긴다).
  앱이 깔린 폰에서는 링크를 누르면 앱이 열린다(App Links·Universal Links, `docs/app.md` '시간표 링크로 앱 열기'). 받은 이름·과목명·일정 이름은 화면에 글로만 넣는다(법무 10/23).
- 링크 만들기를 이 모듈(`timetables.js`)로 옮겨 node 시험에 넣을 수 있다(프론트엔드 제안). 지금은 화면 코드에 있다.

## 홈 화면 위젯 (10/30)

사용자 10/30: 위젯 셋(다음 수업 2×2, 오늘 수업 4×2~4×4, 주간 시간표 4×4) "셋 다 만들고". 안드로이드 위젯은 앱이 꺼져 있어도 그려야 해서
화면이 대표 시간표를 위젯 자료로 바꿔 앱 연결에 넘기고(`TTW_APP.updateWidgets(widgetData(...))`), 앱이 기기 안에 둔다(`docs/app.md` '홈 화면 위젯').

- 자료 `{v: 1, colors: "item" | "cls", terms: [학기]}`. 학기 `{sem, label, title, from, to, days, untimed}`: `days` 는 월~일 일곱 칸의 수업(시작 차례),
  `from`·`to` 는 위젯이 그 학기를 보이는 날들(`termDates`), `untimed` 는 시간이 정해지지 않은 항목 수.
  수업 `{name, place, start, end, color, cls, walk, from, late}`: `place` 는 화면의 강의실 표기(미정이면 `""`), `cls` 는 `req`·`elec`·`gen`·`etc`(칸 색 설정이
  교과구분일 때), `walk` 는 앞 자리에서 걷는 분(반올림, 모르면 `null`), `from` 은 `"home"`(그날 첫 위치 확정 수업: 출발 지점에서 걸어서 나설 시각을 셀 수 있다)
  이나 `"class"`(앞 수업에서), `late` 는 늦는 분. 걷는 셈은 `engine.evaluate` 와 같다(강의실 미정 수업은 자리를 옮기지 않고 쉬는 시간을 보탠다. 시험이 견준다).
- 메모·시간표 id·만든 때는 넣지 않는다. 같은 시간표면 같은 글이라 앱 연결과 앱이 같은 자료를 거른다(자주 넘겨도 된다).
- 학기 고르기: 학사 일정 자료가 없어 어림으로 정한다. 1학기 3/1~6/21, 여름학기 6/22~8/31, 2학기 9/1~12/21, 겨울학기 12/22~2월 끝날.
  화면은 `widgetSemesters(학기 목록)` 이 고른 학기(끝나지 않은 것, 셋까지)의 대표 시간표를 넘기고, 위젯은 그날이 든 학기를, 없으면 가장 먼저 시작하는
  앞으로의 학기(개강 전)를 보인다. 그 학기에 대표 시간표가 없으면 `이번 학기 대표 시간표가 없어요`.
- 넘기는 곳: 앱 연결(`native.js`)이 앱을 켜고 조금 뒤와 앱을 내릴 때 `widgetDataFromStore` 로 만들어 넘긴다(기기에 둔 `timetables@학기` 의 대표 시간표를 적어 둔 수업으로,
  출발 지점 `home`·이동 기준 `mode`·칸 색 `timetableColor`, 걷는 분은 `engine.js` 의 이동 행렬). 화면이 편람과 맞춘 값을 넘기고 싶으면
  `TTW_APP.updateWidgets(widgetData(terms, {name, place, minutes, home, colors}))` 를 부르면 되고, 그 뒤로는 앱 연결이 넘기지 않는다. 웹·iOS 에는 위젯이 없다(iOS 는 나중).

## 기기에 두기 (프론트엔드)

- 다른 값처럼 `store` 로 학기마다: `store.set(semKey("timetables"), serialize(list))`, 읽을 때 `parseList(store.get(semKey("timetables"), []), sem)`.
  지금 보고 있는 시간표 id 도 학기마다(`semKey("timetable")`). 열쇠 이름은 `STORE_KEYS`(`list`·`current`·`color`·`open`).
- 앱을 켤 때 첫 탭(프론트엔드 10/22): 학기 목록을 받기 전에 정해야 해서 기기 하나에 마지막에 연 학기 `openSem` 을 둔다(없으면 고른 학기 `semester` 의 `id`).
  그 학기에 이 판이 읽는 시간표가 있으면 내 시간표, 아니면 탐색: `hasTimetables(store.get(semKey("timetables", openSem), []))`
  (항목은 읽지 않는다. 새 판이 적은 것은 세지 않는다 = `parseList(...).filter((t) => !t._newer).length > 0`).
  `index.html` 머리의 스크립트가 app.js 보다 먼저 같은 판단을 해서(`data-launch`) 켜자마자 탐색 화면이 번쩍이지 않게 한다. 이 스크립트는 판 숫자 1 을 적어 두었으니
  `VERSION` 을 올리면 프론트엔드에 알려 같이 고친다.
- 시간표 칸 색 설정은 기기 하나: `colorMode(store.get("timetableColor", "item"))` → `"item"`(항목마다 `item-0`~`item-7`, 처음) | `"cls"`(교과구분별).
- 이 판보다 새 판(`v` 가 큰 것)으로 적은 시간표는 `parseList` 가 `_newer: true` 로 그대로 두고 `serialize` 가 그대로 돌려준다(앱을 되돌려도 지워지지 않게). 화면은 그런 시간표를 고치지 않는다.
- 스토어 앱의 웹뷰 저장 공간(localStorage)은 기기 공간이 모자라면 OS 가 비울 수 있다(Capacitor 문서 'Storage': localStorage 는 잠깐 두는 곳으로 보라,
  작은 키·값은 Preferences API). 저장한 시간표는 잃으면 안 되는 자료라, 스토어에 내기 전에 앱에서는 Capacitor Preferences 에도 같이 두게 한다
  (디자인 규칙 '스토어 출시 > 개인정보'의 'Preferences 병행'. 백엔드가 `app/src/native.js` 와 앱 플러그인으로 붙일 남은 일).
  같이 둘 것: 학기마다 `timetables`·`timetable`, 기기 하나 `timetableColor`·`openSem`(머리 스크립트가 읽는 `semester` 도). 붙이면 iOS `PrivacyInfo.xcprivacy` 의 UserDefaults(사유 `CA92.1`)가
  필요한데 이미 들어 있다. Preferences 는 비동기라 머리 스크립트보다 늦게 읽힌다: OS 가 웹뷰 저장 공간을 비운 뒤 처음 켤 때는 머리 스크립트가 빈 값을 보고
  탐색을 먼저 보일 수 있다. 화면 쪽은 정해서 붙여 두었다(프론트엔드 10/22 밤): `window.TTW_APP.restored` 가 `{ keys }` 로 풀리고 `keys` 가 비어 있지 않으면
  그때부터 localStorage 에 쓰지 않고 `location.reload()` 를 한 번 한다(세션에 한 번, sessionStorage `ttw.reopened`). 그래서 `native.js` 가 지킬 것:
  ① 되살릴지는 app.js 가 돌기 전에 정한다. 처음 돌 때 `ttw.` 열쇠가 하나도 없으면 Preferences 를 통째로 되살린다('없는 열쇠만'으로 하면 app.js 가 켜자마자 쓰는
  `ttw.openSem`, 학기 자료를 받으면 빈 목록이어도 쓰는 `ttw.picks@학기` 가 빈 값으로 남는다) ② 되살린 값은 한 번에 쓰고 바로 `restored` 를 푼다
  ③ localStorage → Preferences 거울은 되살리기가 끝난 뒤에 켠다(그 전에 app.js 가 쓴 빈 값이 Preferences 를 덮지 않게).

## SNUTT 와 견주어

- 따른 것: 학기마다 시간표 여러 개, 복사본에 번호, 대표 시간표, 직접 넣는 일정, 겹치면 겹친 강의를 빼고 넣는다, 강의는 편람(강좌 정보)을 따른다.
- 다른 것: 계정·서버가 없다(기기에만). 기본 이름은 `시간표 n`, 복사본 번호는 `(2)`부터(SNUTT 는 `(1)`부터). SNUTT 는 겹치면 '덮어쓸까요?'를 묻는데, 여기서는 묻지 않고 바꿔 넣은 뒤 되돌리기를 준다
  (디자인 규칙: 묻는 창은 되돌릴 수 없는 일에만). 편람이 바뀌면 SNUTT 는 알림을 보내고 고치는데, 여기서는 열 때 견주어 `편람 바뀜`·`없는 과목`·`없는 분반`을 단다.
  탐색 결과(동선이 짧은 조합)를 그대로 저장할 수 있고, 어느 시간표든 `동선 확인하기`로 걷는 시간·지각을 본다.
