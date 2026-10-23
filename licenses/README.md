# 다른 사람의 코드와 그 고지문

이 저장소의 `LICENSE`(MIT)는 우리 코드에만 걸린다. 여기는 우리가 가져다 쓴 코드의 저작권 표시와 라이선스 전문이다.
자료(편람·지도·그래프)의 조건은 루트 `README.md` 의 '라이선스와 자료 조건'.

| 파일 | 무엇 | 어디에 들어가나 |
| --- | --- | --- |
| `web/licenses/snutt.txt` | SNUTT(MIT, Wafflestudio)에서 가져온 값·규칙 | `scripts/sugang_client.py`, `ttwizard/parse_sugang.py`, `scripts/fetch_buildings.py`, `web/js/search.js`(파일 머리에도 적었다). 웹·앱 |
| `web/licenses/pretendard.txt` | 글꼴 Pretendard(SIL OFL 1.1) | 웹(jsDelivr 에서 받는 글꼴), 앱(글꼴 파일을 넣는다. 묶음의 `vendor/pretendard/LICENSE.txt` 와 같은 글) |
| `web/licenses/fredoka.txt` | 로고 글꼴 Fredoka(SIL OFL 1.1, google/fonts `ofl/fredoka/OFL.txt` 그대로) | 워드마크 그림(`web/icons/wordmark*.svg`). 글꼴 파일은 넣지 않는다 |
| `web/licenses/odbl.txt` | © OpenStreetMap contributors, ODbL 1.0 원문(SPDX `ODbL-1.0` 과 낱말·차례가 같다) | 바탕 지도의 OSM 층과 출입구 자리(루트 `README.md` '라이선스와 자료 조건') |
| `web/licenses/kogl-type1.txt` | 국토지리정보원 수치지형도의 출처 표시(공공누리가 권하는 꼴)와 공공누리 제1유형 조건 요약·원문 링크(법무 10/23 문안) | 바탕 지도·고도·경사·접속선 |
| `capacitor.txt` | Capacitor 와 플러그인(MIT), 그 안의 다른 사람 코드(Apache-2.0, BSD, MIT) | 스토어 앱(안드로이드·iOS) |
| `androidx.txt` | AndroidX(Apache-2.0) | 안드로이드 앱 |
| `cordova.txt` | Apache Cordova(Apache-2.0)와 NOTICE | 안드로이드 앱(cordova-android framework), iOS 앱(CapacitorCordova) |

Apache License 2.0 전문은 따로 두지 않고 그 라이선스가 걸리는 세 파일(`capacitor.txt`·`androidx.txt`·`cordova.txt`) 끝에 같이 넣었다(파일 하나만 읽어도 되게).
10/22 밤부터 앱 화면은 고지문 전문을 차례로 다 보여서 전문이 세 번 나온다. 그대로 둔다.

웹에도 쓰는 것(SNUTT, Pretendard)은 `web/licenses/` 에 둔다. 웹은 그대로 `licenses/…` 주소로 열고, `scripts/build_app.py` 가 `web/` 을 앱 묶음으로 옮길 때 같이 들어간다.
앱에만 들어가는 것(이 폴더의 `*.txt`: Capacitor·AndroidX·Cordova)은 `build_app.py` 가 같은 묶음 `licenses/` 에 더한다(두 곳에 같은 이름이 있으면 멈춘다).
그래서 앱과 웹이 같은 주소 `licenses/<이름>.txt` 를 연다. 앱의 '오픈소스 라이선스' 화면이 이 파일들을 읽는다.
그 밖에 Leaflet 은 `web/vendor/leaflet/LICENSE`, three.js 는 `web/vendor/three/LICENSE`, 앱에 넣는 글꼴 파일 옆에는 `vendor/pretendard/LICENSE.txt` 가 있다.
Pretendard 판을 올리면(`app/package.json`, `web/index.html` 의 CDN 주소) `web/licenses/pretendard.txt` 첫 줄의 판도 고친다(`tests/test_app.py` 가 본다).

Capacitor·AndroidX·Cordova 의 판을 올리면(`app/package.json`, `app/android/variables.gradle`) 위 파일의 판 숫자도 같이 고친다(`tests/test_app.py` 가 본다).
