# 캘린더 파일(.ics) 내보내기

2026-11-13, update102. 사용자 11/13 '이건 다 구현해'(남은 기능 목록의 '캘린더(.ics) 내보내기').
대표 시간표를 학기 첫날부터 종강일까지 매주 되풀이하는 일정으로 만든 캘린더 파일이다. 이 판은 **자료와 계산, 앱 연결만** 넣는다.
화면(공유·내보내기의 '캘린더 파일' 줄)은 디자인 → 프론트엔드.

- 법무 방식(`법무_출시_참고.md` '위젯·캘린더 내보내기'): 캘린더는 인텐트·.ics·공유 시트로. 기기 캘린더에 직접 쓰지 않는다(캘린더 권한 없음).
- 파일은 기기 안에서 만든다. 서버로 보내지 않는다.

## 1. 자료: `data/calendar/terms.json` → 웹 `data/calendar.json`

```json
{"checked_on": "2026-11-13", "terms": {"2026-2": {"start": "2026-09-01", "end": "2026-12-14", "makeup": ["2026-12-15", "2026-12-21"],
  "no_class": [{"date": "2026-10-05", "name": "대체공휴일(개천절)"}], "src": ["s1"]}}, "sources": {"s1": {"title": "…", "url": "https://…", "accessed": "2026-11-13"}}}
```

- `start`·`end`: 학교 학사일정의 개강·종강. `makeup`: 보강 기간(종강 뒤라 일정에 넣지 않는다).
- `no_class`: 학기 안의 공휴일(관공서의 공휴일에 관한 규정, 대체공휴일·임시공휴일 포함). 그날 수업은 일정에서 뺀다(EXDATE).
- 개교기념일(10월 15일)은 학사일정에 휴업으로 적혀 있지 않아 넣지 않았다(미확인).
- **학기마다 고친다**(백엔드): 학교 학사일정이 다음 학기 개강·종강을 실으면 그 학기를 더한다. 2027-1 은 아직 실리지 않았다(11/13, 수강신청 1월 26일~2월 2일만).
  그 학기 자료가 없으면 화면은 캘린더 줄을 끄거나 '아직 학기 기간이 나오지 않았어요'를 보인다(`termInfo` 가 null).
- 학교 본부 학사일정 쪽(www.snu.ac.kr)은 11/13 에 받지 못해 같은 줄을 싣는 단과대 누리집 두 곳을 출처로 적었다.

## 2. 계산: `web/js/ics.js`

| 함수 | 하는 일 |
| --- | --- |
| `termInfo(calendar, term)` | 학기 기간 `{start, end, skip, names, makeup}`, 자료가 없으면 null |
| `itemsFromSections(sections)` | 엔진 분반 → 일정 항목 `{key, title, detail, meetings}`(설명은 '과목번호 · 분반'. 교수 이름은 넣지 않는다) |
| `buildIcs(items, info, {name, now, place})` | .ics 글과 일정 수. 수업마다 VEVENT 하나(첫 그 요일 DTSTART, `RRULE:FREQ=WEEKLY;UNTIL=종강일 23:59:59 KST`, 공휴일 EXDATE), 시각은 `TZID=Asia/Seoul`(VTIMEZONE 포함) |
| `placeOf(m)` | 장소 글: 화면과 같은 꼴(301동 118호, 83동 강당). 직접 넣은 일정은 `meetings[].place` 를 그대로 |
| `icsFileName(term, title)` | '2026년 2학기 시간표 1.ics'(update104, 디자인 122판) |
| `termLabel(term)` · `termRangeLabel(info)` | '2026년 2학기' · 칸의 학기 기간 '9월 1일~12월 14일'(화면이 '매주'를 붙인다. 끝은 종강일, 보강 기간은 빼므로 12월 14일) |
| `escapeText`·`fold` | RFC 5545 글 이스케이프와 75 옥텟 접기(UTF-8, 글자 가운데서 자르지 않음), 줄 끝 CRLF |

- UID 는 '학기-분반-요일-시작@ttwizard.app' 라 같은 시간표를 다시 내보내면 같은 일정으로 읽힌다(캘린더 앱에 따라 덮어쓰거나 겹친다).
- 직접 넣은 일정(시간표의 내 일정)은 항목으로 함께 넘긴다: `{key, title, meetings: [{day, start, end, place}]}`.

## 3. 넘기기 (디자인 122판 공유 시트 셋째 종류 '캘린더')

- 파일은 공유 시트를 연 그 시간표로 만든다(대표 시간표가 아니어도).
- **파일로 저장**: 웹은 `new Blob([text], {type: "text/calendar"})` 내려받기. 안드로이드 앱은 `TTW_APP.saveFile({ text, name, mime: "text/calendar" })` →
  기기 다운로드(Download/, MediaStore.Downloads, 권한 없음, `ImagePlugin.saveFile`). 되는 기기(안드로이드 10 이상)인지는 `TTW_APP.canSaveFile`
  (켤 때 `info` 에 한 번 묻고 답이 오면 바뀐다, 처음엔 false). 안 되면 code `UNSUPPORTED`.
- **캘린더 앱 단추**: `TTW_APP.calendarApps()` → 이 폰에서 .ics(text/calendar)를 여는 앱 셋까지 `[{id(패키지), app, icon}]`(기기가 주는 이름·아이콘 그대로, 못 물으면 []).
  누르면 `TTW_APP.openCalendar({ target: id, text, name })`: 그 앱으로 파일을 연다(ACTION_VIEW, FileProvider 주소, 읽기만 허락). 못 열면 code `MISSING` → 기기 공유 창.
  안드로이드 11 이상은 매니페스트 `<queries>` 의 VIEW text/calendar 로 그 앱들이 보인다(모든 앱을 보는 권한은 쓰지 않는다).
- **더 보기**: `TTW_APP.shareFile({ text, name, mime: "text/calendar", title })` → 기기 공유 창(앱 캐시에 쓰고 FileProvider 주소로, 권한 없음, `ImagePlugin.shareFile`).
  플러그인에 그 함수가 없는 판(옛 앱, iOS)은 `UNSUPPORTED` → 화면은 웹과 같은 길.
- 구글 캘린더 안드로이드 앱이 .ics 를 직접 못 가져온다는 안내는 두지 않는다(디자인 122판: 구글 캘린더에 넣는 길은 Tachyon 이 맡는다).

## 4. 시험

- `tests/test_calendar.py`: 자료 꼴, 웹 내보내기, 2026-2 의 요일마다 수업 수(월 14·화 15·목 14·금 13: 10/5·9/24·9/25·10/9 빠짐), 보강 기간이 안 들어가는지,
  75 옥텟 접기·이스케이프, 장소 글. `icalendar` 가 깔려 있으면 그것으로도 읽어 본다(클라우드에서 icalendar 7.3 + dateutil 로 되풀이를 펼쳐 같은 수를 확인함).
- `tests/test_app.py`: `TTW_APP.shareFile` 이 글을 UTF-8 base64 로 넘기는지, 옛 플러그인이면 UNSUPPORTED, 플러그인이 받는 mime 이 캘린더 하나인지.

## 5. 앱 묶음

`js/ics.js` 와 `data/calendar.json` 은 화면이 부르기 전까지 앱 묶음에 넣지 않는다(`build_app.py` 의 `UNTIL_USED`, `docs/app.md`). 화면이 부르면 저절로 들어간다.
