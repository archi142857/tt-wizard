# 다른 사람의 코드와 그 고지문

이 저장소의 `LICENSE`(MIT)는 우리 코드에만 걸린다. 여기는 우리가 가져다 쓴 코드의 저작권 표시와 라이선스 전문이다.
자료(편람·지도·그래프)의 조건은 루트 `README.md` 의 '라이선스와 자료 조건'.

| 파일 | 무엇 | 어디에 들어가나 |
| --- | --- | --- |
| `snutt.txt` | SNUTT(MIT, Wafflestudio)에서 가져온 값·규칙 | `scripts/sugang_client.py`, `ttwizard/parse_sugang.py`, `scripts/fetch_buildings.py`, `web/js/search.js`(파일 머리에도 적었다) |
| `capacitor.txt` | Capacitor 와 플러그인(MIT), 그 안의 다른 사람 코드(Apache-2.0, BSD, MIT) | 스토어 앱(안드로이드·iOS) |
| `androidx.txt` | AndroidX(Apache-2.0) | 안드로이드 앱 |
| `cordova.txt` | Apache Cordova(Apache-2.0)와 NOTICE | 안드로이드 앱(cordova-android framework), iOS 앱(CapacitorCordova) |
| `apache-2.0.txt` | Apache License 2.0 전문 | `capacitor.txt` 가 가리킨다 |

`scripts/build_app.py` 가 이 폴더의 `*.txt` 를 앱 묶음의 `licenses/` 로 넣는다. 앱의 '오픈소스 라이선스' 화면이 거기를 연다.
웹 화면에 들어가는 것 가운데 Leaflet 은 `web/vendor/leaflet/LICENSE`, three.js 는 `web/vendor/three/LICENSE`,
앱에 넣는 글꼴 Pretendard 는 앱 묶음의 `vendor/pretendard/LICENSE.txt`(`build_app.py` 가 글꼴과 함께 넣는다)에 있다.

Capacitor·AndroidX·Cordova 의 판을 올리면(`app/package.json`, `app/android/variables.gradle`) 위 파일의 판 숫자도 같이 고친다(`tests/test_app.py` 가 본다).
