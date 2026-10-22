# 저장한 시간표 (web/js/timetables.js)

SNUTT 처럼 분반을 직접 골라 시간표를 만들고 저장하는 '내 시간표'와, 탐색 결과마다의 `저장하기`가 쓰는 자료 형식과 함수다(2026-10-22 사용자 요청).
백엔드 세션이 정한다. 화면(탭, 시간표 칸, 버튼, 기기에 두기)은 프론트엔드 세션(`web/js/app.js`), 모양과 문구는 디자인 세션이 맡는다.

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
           color }                                                          0 부터의 색 번호(팔레트는 화면이 정한다)

직접 넣은 일정 { custom: id, title, meetings: [[요일, 시작, 끝, 건물, ""], ...], memo?, color }
```

요일 0 = 월, 시각은 자정부터 센 분, 건물은 `campus.json` 의 지점 id(모르면 `""`). 항목의 열쇠(`itemKey`)는 강좌면 `교과목번호-강좌번호`(엔진의 분반 `key` 와 같다),
직접 넣은 일정이면 그 `custom` id 다. 한 시간표에 한 과목은 분반 하나만 둔다.

## 함수

| 함수 | 하는 일 |
| --- | --- |
| `createTimetable(list, sem, {title, source, from, items})` | 새 시간표. 이름이 겹치면 `이름 (n)`, 학기의 첫 시간표면 대표. 학기마다 `PER_SEMESTER_MAX`(50)개까지(넘으면 `null`) |
| `renameTimetable(t, title, list)` | `{t}` 또는 `{problem: "empty" \| "duplicate"}`. 이름은 공백을 줄이고 `TITLE_MAX`(30)자까지 |
| `copyTimetable(t, list)` | 복사본 `이름 (n)`(SNUTT 와 같은 꼴). 대표는 옮기지 않는다 |
| `deleteTimetable(list, id)`, `setPrimary(list, id)` | 지우기(대표를 지우면 가장 최근에 고친 것이 대표), 대표 바꾸기 |
| `sectionItem(course, section, {meetings, alts})` | 편람 분반 → 강좌 항목. `meetings` 가 편람과 다르면 `own` 으로 |
| `customItem({title, meetings, memo})` | 직접 넣은 일정 항목 |
| `addItem(t, item, {force, byId})` | 넣기. 시간이 겹치는 항목이 있으면 넣지 않고 `{t, overlaps: [열쇠]}`(화면이 '덮어쓸까요?'를 묻는다). `force` 면 겹친 것을 빼고 넣는다(SNUTT 와 같다). 같은 과목의 다른 분반은 바꿔 넣고 색은 그대로. `byId`(지금 편람)를 주면 겹침을 지금 편람 기준으로 본다 |
| `overlapsWith(t, meetings, {except, course, byId})` | 이 수업들과 겹치는 항목 열쇠들(항목의 시간을 바꾸기 전에 물을 때) |
| `removeItem(t, key)`, `updateItem(t, key, patch)` | 빼기, 고치기(`undefined` 인 칸은 지운다) |
| `credits(t)` | 학점 합 |
| `itemsFromRanked(ev, byId)` | 탐색 결과 하나(`search().ranked[i]`) → 항목들. 저장하기는 `createTimetable(list, sem, {source: "search", from, items})` |
| `findSaved(list, ev, byId)` | 이 탐색 결과와 같은 시간표가 이미 있으면 그 시간표(`저장됨`) |
| `reconcile(t, byId)` | 지금 편람과 견준 항목들 `[{key, item, meetings, state, live}]`(아래) |
| `acknowledge(t, byId)` | '편람 바뀜'을 본 것으로(`base` 를 지금 편람 값으로) |
| `toSections(t, byId)` | 엔진이 읽는 분반 모양. `checkRoute` 와 시간표 칸 그리기에 쓴다 |
| `serialize(list)` / `parseList(raw, sem)` | 기기에 둘 값 / 기기에서 읽은 값 → 목록(모양이 어긋난 것은 버리고 나머지는 살린다) |

`checkRoute(sections, travel, home, {weights})`(`engine.js`)는 `evaluate` 와 같은 모양(요일별 경로 `legs`, `cost` 등)에
`overlaps: [[i, j], ...]`(시간이 겹치는 분반 쌍)을 더해 돌려준다. 탐색 결과를 저장한 시간표는 `checkRoute(toSections(t, byId), …)` 가 탐색 때와 같은 비용·경로를 낸다(시험이 본다).

## 편람과 맞추기

강좌 항목은 편람을 따른다(SNUTT 처럼). 편람은 하루 네 번 새로 받으니 화면은 그릴 때 `reconcile` 로 견준다.

| `state` | 뜻 | 쓰는 수업(`meetings`) |
| --- | --- | --- |
| `same` | 저장할 때 본 편람과 같다 | 지금 편람(`own` 이 있으면 `own`) |
| `changed` | 편람이 바뀌었다('편람 바뀜') | 지금 편람(`own` 이 있으면 `own`). `acknowledge` 하면 `same` |
| `gone` | 편람에서 사라졌다 | 적어 둔 `own` 이나 `base` |
| `custom` | 직접 넣은 일정 | 그 일정 |

`live` 는 지금 편람의 분반(없으면 `null`)이라 `live.status === "폐강대상"` 이면 '폐강 대상'을 달 수 있다.

## 기기에 두기 (프론트엔드)

- 다른 값처럼 `store` 로 학기마다: `store.set(semKey("timetables"), serialize(list))`, 읽을 때 `parseList(store.get(semKey("timetables"), []), sem)`.
  지금 보고 있는 시간표 id 도 학기마다(`semKey("timetable")` 같은 열쇠).
- 이 판보다 새 판(`v` 가 큰 것)으로 적은 시간표는 `parseList` 가 `_newer: true` 로 그대로 두고 `serialize` 가 그대로 돌려준다(앱을 되돌려도 지워지지 않게). 화면은 그런 시간표를 고치지 않는다.
- 스토어 앱의 웹뷰 저장 공간(localStorage)은 기기 공간이 모자라면 OS 가 비울 수 있다(Capacitor 문서 'Storage': localStorage 는 잠깐 두는 곳으로 보라,
  작은 키·값은 Preferences API). 저장한 시간표는 잃으면 안 되는 자료라, 스토어에 내기 전에 앱에서는 Capacitor Preferences 에도 같이 두게 한다
  (디자인 규칙 '스토어 출시 > 개인정보'의 'Preferences 병행'. 백엔드가 `app/src/native.js` 와 앱 플러그인으로 붙일 남은 일).

## SNUTT 와 견주어

- 따른 것: 학기마다 시간표 여러 개, 기본 이름과 복사본 `이름 (n)`, 대표 시간표, 직접 넣는 일정, 겹치면 '덮어쓸까요?' 하고 겹친 강의를 뺀다, 강의는 편람(강좌 정보)을 따른다.
- 다른 것: 계정·서버가 없다(기기에만). 편람이 바뀌면 SNUTT 는 알림을 보내고 고치는데, 여기서는 열 때 견주어 '편람 바뀜'·'편람에서 사라짐'을 단다.
  탐색 결과(동선이 짧은 조합)를 그대로 저장할 수 있고, 어느 시간표든 `동선 확인하기`로 걷는 시간·지각을 본다.
