# 스토어 앱 (Capacitor)

2026-10-01. 백엔드 세션. Google Play·App Store 에 낼 앱이다. 웹 화면(`web/`)을 Capacitor 8 로 감싸
안드로이드와 iOS 를 한 번에 낸다(10/1 방향: 홈 화면 위젯 때문에 안드로이드도 TWA 대신 Capacitor).
화면 코드(HTML·CSS·JS)는 웹과 같고, 앱에만 있는 것은 아래 셋이다.

- 네이티브 프로젝트: `app/android/`(Android Studio), `app/ios/`(Xcode, Swift Package Manager)
- 앱 연결 스크립트: `app/src/native.js` → 앱 묶음의 `js/native.js` (자료 새로 받기, 안드로이드 뒤로 가기)
- 앱 묶음 만들기: `scripts/build_app.py` (web/ → `app/www/`, 글꼴 내장), 아이콘: `scripts/app_icons.py`

원격 주소만 띄우는 래퍼(`server.url`)가 아니다. 화면 파일과 과목 자료 스냅샷을 앱에 넣어 첫 실행부터 오프라인으로 돌고,
그 뒤로는 자료(JSON)만 새로 받는다(디자인 규칙 '스토어 출시' > '앱다움').

## 구조

```
app/
  package.json, package-lock.json   Capacitor 8.5.2 (core·cli·android·ios) + 플러그인 app·browser·haptics, 글꼴 pretendard
  capacitor.config.json             앱 아이디·이름, 시스템 바(SystemBars)
  src/native.js                     앱 연결 스크립트 (웹에서는 아무것도 안 한다)
  assets/icons/                     디자인 세션 아이콘 원본(design\v3\app-icons, 10/5 판)
  android/                          네이티브 안드로이드 프로젝트 (커밋한다. 빌드 결과·복사본은 .gitignore)
  ios/                              네이티브 iOS 프로젝트 (커밋한다)
  www/                              build_app.py 가 만드는 묶음 (git 에 안 올림)
  node_modules/                     npm ci (git 에 안 올림)
.github/workflows/app.yml           안드로이드 디버그 APK·iOS 시뮬레이터 빌드
```

- 앱 안 플러그인(이 앱에만 있는 네이티브 코드): `TTWImage`(시간표 이미지 공유·저장, 안드로이드 `ImagePlugin.java`·iOS `ImagePlugin.swift`),
  `TTWShell`(링크 공유·앱 설정 열기, `ShellPlugin.java`·`ShellPlugin.swift`), `TTWWidget`(홈 화면 위젯 자료, 안드로이드 `WidgetPlugin.java`. 아래 '홈 화면 위젯').
  안드로이드는 `MainActivity` 가, iOS 는 `MainViewController`(`SceneDelegate.swift`)가 등록한다.
  화면은 이것들을 직접 부르지 않고 `native.js` 의 `TTW_APP` 으로 쓴다.
- 앱 묶음(`www/`)에서 빼는 것: 서비스 워커 `sw.js`(앱은 파일을 품고 있다), 3D·2D 모델(`model/`, `vendor/three/`), 실측 페이지(`field/`), 설명(`README.md`),
  node 시험용 표시(`js/package.json`), 웹에만 둔 개발자 메뉴(`js/dev.js`, 10/24. 스토어 앱은 열지 않고 숨긴 기능을 바이너리에 넣지 않는다, 법무: Apple 2.5.19).
  앱은 `dev.js` 를 부르지 않아서 묶음에 없어도 오류가 나지 않는다(`build_app.py` 의 `SKIP_DIRS`·`SKIP_FILES`).

- 앱 아이디 `com.ttwizard.app`(10/1 사용자 결정: 개인 GitHub 아이디와 떼어 두고, 나중에 `ttwizard.com` 같은 주소를 사면 그대로 맞게), 이름 `TT Wizard`.
  **스토어에 처음 올린 뒤에는 앱 아이디를 바꿀 수 없다.** 안드로이드 `namespace`·`applicationId`·`MainActivity` 패키지, iOS `PRODUCT_BUNDLE_IDENTIFIER`,
  `capacitor.config.json` 이 같아야 한다(`tests/test_app.py`).
  사용자가 Play Console 을 보고 정하기 전까지 바꾸지 않는다(법무 10/22: 콘솔에서 앱을 만들 때 패키지 이름이 등록된 것으로 보이고, 바꾸면 Play 는 다른 앱으로 본다).
- 안드로이드: minSdk 24, compile·targetSdk 36(Play 2026-08-31 요건), AGP 8.13, Gradle 8.14.3, JDK 21.
- iOS: 15.0 이상, Xcode 26 이상(Capacitor 8 요건), iPhone 전용(`TARGETED_DEVICE_FAMILY = 1`, 디자인 규칙의 권장. iPad 를 넣으려면 `1,2` 와 iPad 스크린샷).

## 빌드

### GitHub Actions (PC 에 아무것도 안 깔고)

`web/`·`app/`·`scripts/build_app.py` 가 바뀌어 main 에 올라가면 `app` 워크플로가 돈다(Actions 화면의 Run workflow 로도).

- 안드로이드: 디버그 APK. 실행 화면 아래 **Artifacts > tt-wizard-android-debug** 를 받아 압축을 풀고 안드로이드 폰에 옮겨 설치한다
  (설치할 때 '출처를 알 수 없는 앱' 허용을 묻는다). 14일 동안 받을 수 있다.
- iOS: 시뮬레이터용으로 서명 없이 빌드해 컴파일만 확인한다. 아이폰에 설치하거나 TestFlight 에 올리려면 Apple 개발자 계정과 서명이 필요하다.

### PC (Windows, 안드로이드)

Android Studio Otter(2025.2.1) 이상을 깐다(JDK 21 이 함께 온다). Node 22 이상.

```
cd /d "D:\프로젝트 폴더\코딩\TT Wizard\tt-wizard"
.venv\Scripts\python scripts\export_web.py
cd app
npm ci
cd ..
.venv\Scripts\python scripts\build_app.py
cd app
npx cap sync android
npx cap open android
```

Android Studio 에서 폰을 USB 로 잇고(개발자 옵션 > USB 디버깅) Run. 웹 화면(`web/`)을 고친 뒤에는 `build_app.py` 와 `npx cap sync` 를 다시 돌린다.

### Mac (iOS)

Xcode 26 이상. 위와 같고 마지막 두 줄만 `npx cap sync ios`, `npx cap open ios`. Signing & Capabilities 에서 팀을 고른다.

## 앱 연결 스크립트 (`app/src/native.js`)

`build_app.py` 가 `index.html` `<head>` 끝에 넣어 `app.js`(모듈)보다 먼저 돈다. 웹·PWA 에서는 바로 끝난다(Capacitor 가 없으면).

- **자료**: `data/*.json` 을 웹 서버(`https://archi142857.github.io/tt-wizard/`)에서 네이티브 HTTP(CapacitorHttp, 웹뷰 CORS 를 타지 않음)로 받는다.
  3초 안에 안 오면 지난번에 받아 둔 것(IndexedDB), 그것도 없으면 앱에 넣은 스냅샷을 쓴다. 늦게 온 응답은 저장해 다음 실행에 쓴다.
  받아 둔 것은 앱 빌드(`BUILD`)마다 따로 두므로 앱을 새로 내면 새 스냅샷이 옛 저장본보다 먼저다. 웹 서비스 워커(네트워크 먼저, 3초)와 같은 방식이다.
- **자료 모양은 이미 낸 앱과 맞아야 한다.** 앱은 화면 코드를 품고 있고 자료만 새로 받으므로, `export_web.py` 의 JSON 은
  칸을 더하기만 하고 빼거나 뜻을 바꾸지 않는다. 꼭 바꿔야 하면 새 주소(예: `.../app-data/v2/`)에 내고 앱의 `REMOTE` 를 바꿔 새 판을 낸다.
- **안드로이드 뒤로 가기**: 열린 시트(`<dialog>`)를 닫고(`cancel` 이벤트, 화면이 막으면 그대로), 아니면 이전 화면(웹 방문 기록),
  첫 화면이면 앱을 내린다(`minimizeApp`, 다시 열면 그대로). iOS 는 가장자리 스와이프로 뒤로(`MainViewController`).
- `<html data-platform="android|ios">` 를 붙인다. `window.TTW_APP` 에 빌드·주소·플랫폼.
- **안드로이드 상태 바 글자색**: 기본은 기기 테마를 따른다(`capacitor.config.json` 의 `SystemBars.style: "DEFAULT"`). 그런데 SystemBars 플러그인(8.5.2)은
  `DEFAULT` 를 받은 순간의 기기 테마로 바꿔 기억하고 기기 설정이 바뀔 때 그 값을 다시 입혀서, 앱을 켜 둔 채 기기가 다크로 바뀌면 화면은 어두워지는데
  시계·아이콘이 어두운 글자로 남는다. 그래서 기기 테마가 바뀔 때(`prefers-color-scheme`)와 앱으로 돌아올 때 `DEFAULT` 를 다시 요청한다.
  이벤트 테마가 켜져 있으면(`<html data-theme>`) 화면이 정한 글자색(`app.js` `applyTheme` 의 `setStyle("DARK")`)을 건드리지 않는다. iOS 는 스스로 따라간다.
- **기기 브라우저로 여는 링크**(10/5, 디자인 규칙 '강의평'): 화면은 바깥 링크(`<a target="_blank">`)를 앱 안 브라우저로 여는데, iOS 인앱 Safari 는
  Safari 의 로그인을 이어받지 않는다. 로그인해야 보이는 에브리타임 강의평은 거기서 열면 다시 로그인해야 해서 기기의 기본 브라우저로 보낸다.
  대상은 주소의 호스트가 `everytime.kr`(하위 주소 포함)이거나 화면이 `data-browser="system"` 을 붙인 http(s) 링크다.
  `native.js` 가 문서의 `click` 을 capture 단계에서 먼저 받아 전파만 끊고 기본 동작은 둔다. 웹뷰가 앱 밖 주소로 가려 하면 Capacitor 가 기기에 넘긴다
  (안드로이드 `Bridge.launchIntent` 의 `ACTION_VIEW`, iOS `WebViewDelegationHandler` 의 `UIApplication.open`. 8.5.2 소스로 확인). 그 주소를 맡은 앱이 기기에 있으면
  그 앱이 열릴 수 있다. `capacitor.config.json` 의 `server.allowNavigation` 에 그 호스트를 넣으면 웹뷰 안에서 열리게 되니 넣지 않는다.
- **앱으로 연 주소**(10/30, 아래 '시간표 링크로 앱 열기'): `TTW_APP.launchUrl` 은 켤 때 연 주소(글)나 `null` 로 풀리는 Promise(`App.getLaunchUrl`),
  켜 둔 동안 링크로 다시 열리면 `window` 에 `ttw:open-url` 이벤트(`detail.url`, `App` 의 `appUrlOpen`). 켤 때의 주소는 둘로 다 온다
  (안드로이드 `BridgeActivity.load` 가 켤 때의 intent 를 `onNewIntent` 로 한 번 더 넘긴다). 화면은 같은 링크를 10초 안에 두 번 넣지 않는다.
- **링크 공유·앱 설정**(10/30): `TTW_APP.shareLink({url, title})` 는 공유 시트로 주소를 보낸다(안드로이드 웹뷰에는 `navigator.share` 가 없다.
  안드로이드 `ACTION_SEND` `text/plain`·`EXTRA_TEXT`, 선택 창 제목 `title`. iOS `UIActivityViewController` 에 URL). `TTW_APP.openSettings()` 는 이 앱의 설정 화면
  (안드로이드 앱 정보 `ACTION_APPLICATION_DETAILS_SETTINGS`, iOS 설정 앱). 플러그인이 없는 옛 앱에는 두 함수가 없고, 메서드가 없으면 `UNSUPPORTED` 로 거절한다.

화면 쪽(`web/js/app.js`, 프론트엔드)은 `window.Capacitor` 가 있으면 셸을 `ios` 로 판별해 서비스 워커·설치 안내·새 버전 알림을 끄고,
외부 링크는 Capacitor Browser(안드로이드는 Custom Tab, iOS 는 인앱 Safari), 완료 때 햅틱을 쓴다. 에브리타임으로 나가는 `강의평`만
기기의 기본 브라우저로 간다(위 '기기 브라우저로 여는 링크'. `native.js` 가 맡아서 `app.js` 는 여느 바깥 링크처럼 두면 된다). 안드로이드도 Capacitor 가 되면서
`ios` 라는 이름이 맞지 않아 프론트엔드에 플랫폼별로 나눠 달라고 요청했다(공유 폴더 `요청_프론트엔드.md`).

## 앱에서만 다른 것

| 항목 | 어디서 |
| --- | --- |
| 글꼴 Pretendard 내장(웹은 CDN) | `build_app.py` 가 `node_modules/pretendard` 의 가변 동적 서브셋(CSS + woff2 92개, 3 MB)과 OFL 라이선스를 넣고 `<link>` 를 바꾼다 |
| 시작 화면: bg 단색(라이트 `#EEF0FF`, 다크 `#16171B`), 로고 없음 | 안드로이드 `values(-night)/colors.xml` `launch_background`·`styles.xml`(12 이상은 시스템 스플래시 = 아이콘 + 바탕색), iOS `LaunchScreen.storyboard` + 색 에셋 `LaunchBackground` |
| 첫 화면 전 흰 화면 번쩍임 막기 | 웹뷰 바탕을 같은 색으로: `MainActivity.java`, iOS `MainViewController`(`SceneDelegate.swift`) |
| 시스템 바·안전 영역 | Capacitor 8 SystemBars(`insetsHandling: css`): 안드로이드 15 의 edge-to-edge 에서 `env(safe-area-inset-*)` 가 맞게 나온다. 옛 웹뷰(140 미만)는 `--safe-area-inset-*` 변수로 준다 |
| 예측 뒤로 가기(안드로이드 13+) | `AndroidManifest.xml` `enableOnBackInvokedCallback` |
| 지도 바탕 | 타일을 쓰지 않고 우리 자료(`data/basemap.json`)로 그린다(10/1, `docs/basemap.md`). 앱은 앱에 넣은 것만 쓴다(`native.js` `BUNDLED_ONLY`). OSM 타일용 User-Agent 꼬리표(`appendUserAgent`)는 뗐다 |
| iOS 개인정보 매니페스트 | `PrivacyInfo.xcprivacy`: 추적·수집 없음, UserDefaults `CA92.1` |
| iOS 수출 규정 질문 생략 | `Info.plist` `ITSAppUsesNonExemptEncryption = false`(HTTPS 만 쓴다) |
| 한국어 시스템 문구(인앱 Safari 의 '완료' 등) | `CFBundleDevelopmentRegion = ko` |

## 권한·기기 백업·오픈소스 고지 (10/22, 법무 검토의 질문)

- **권한**: 앱 매니페스트는 `INTERNET` 과 `WRITE_EXTERNAL_STORAGE`(`maxSdkVersion="28"`: 안드로이드 9 이하에서 시간표 이미지를 사진에 저장할 때만 묻는다, 10/30.
  10 이상 기기에는 이 권한이 아예 없다)다. iOS 는 사진 추가 권한(`NSPhotoLibraryAddUsageDescription`, 저장할 때만 묻는다). 둘 다 거절해도 공유 시트로는 내보낼 수 있다.
  홈 화면 위젯(10/30)은 권한을 더하지 않는다(부정확 알람이라 정확한 알람·부팅 권한 없음. 아래 '홈 화면 위젯').
  병합 매니페스트에는 플러그인과 라이브러리가 더한 것이 들어간다. 소스로 보면
  `VIBRATE`(@capacitor/haptics, 설치할 때 주는 보통 권한)와 AndroidX core 가 앱 안에서만 쓰려고 만드는 서명 권한
  `com.ttwizard.app.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION` 이고, 위치·카메라처럼 묻는 권한은 없다(묻는 것은 위의 9 이하 저장소 하나).
  @capacitor/browser 는 권한이 아니라 Custom Tab 을 찾는 `<queries>` 를 더한다. 빌드한 APK 의 실제 목록은 `app` 워크플로 실행 화면의
  요약(Summary)에 적힌다(`aapt2 dump permissions`. 앱에 들어가는 라이브러리 목록도 같이).
- **기기 백업**: `android:allowBackup="true"` 를 둔다. 안드로이드 자동 백업(Google 계정)과 새 폰으로 옮기기에 앱 자료(웹뷰의 localStorage·IndexedDB,
  앞으로 Preferences)가 들어가서, 담은 과목·저장한 시간표·출발 지점이 새 폰에서 이어질 수 있다(웹뷰 저장 공간보다 Preferences 가 확실해서
  출시 전에 Preferences 에도 둔다). 백업은 사용자의 계정에 있고 개발자는 볼 수 없다.
  끄면 새 폰에서 처음부터다(안드로이드 12 이상은 끄더라도 기기끼리 옮기기는 된다). iOS 도 앱 자료가 iCloud·기기 백업에 들어간다.
  받아 둔 편람 JSON(IndexedDB, 많아야 10 MB 남짓)도 같이 들어가지만 앱 빌드가 다르면 쓰지 않는다. 안드로이드 백업 한도(앱마다 25 MB) 안이다.
  처리방침에 적을 사실: '기기 백업을 켜 두었다면 앱에 저장한 내용이 그 기기 백업(Google 계정·iCloud)에 함께 들어갈 수 있어요. 개발자는 볼 수 없어요.'
- **오픈소스 고지**: 앱에만 들어가는 다른 사람 코드의 고지문은 저장소 `licenses/` 에 두고 `build_app.py` 가 앱 묶음의 `licenses/` 로 넣는다:
  `capacitor.txt`(MIT, 그 안의 Apache-2.0·BSD·MIT 파일), `androidx.txt`(Apache-2.0), `cordova.txt`(Apache-2.0 와 NOTICE).
  웹에도 쓰는 `snutt.txt`·`pretendard.txt`(SIL OFL 1.1)·`fredoka.txt`(로고 글꼴, OFL)와 지도 자료의 `odbl.txt`(OSM, ODbL 1.0 원문)·`kogl-type1.txt`(수치지형도 출처 표시와
  공공누리 제1유형 조건 요약·원문 링크, 법무 문안)는 `web/licenses/` 에 있어 웹은 그대로, 앱은 `web/` 을 옮길 때 같은 `licenses/` 로 들어간다(10/22·23).
  Apache-2.0 전문은 앞의 세 파일 끝에 각각 넣었다(파일 하나만 읽어도 되게. 10/22 밤부터 화면은 고지문 전문을 차례로 다 보여서 세 번 나온다).
  지도는 `vendor/leaflet/LICENSE`, 앱 글꼴 파일 옆에는 `vendor/pretendard/LICENSE.txt` 도 있다. 화면(정보 > 오픈소스 라이선스)이 이 파일들을 읽는다.

## 시간표 이미지 (공유·저장, 10/23)

사용자 10/23 "시간표 이미지로 내보내는 기능". 그림에 시간표 자료를 넣는 것은 `web/js/timetables.js`(`docs/timetables.md` '이미지 파일에 담기'),
앱에서 나누고 저장하는 것은 이 앱 안의 플러그인 `TTWImage`(안드로이드 `app/android/app/src/main/java/com/ttwizard/app/ImagePlugin.java`, iOS `app/ios/App/App/ImagePlugin.swift`).
화면은 `native.js` 의 `TTW_APP.shareImage({bytes, name, title})`·`TTW_APP.saveImage({bytes, name})` 를 부른다. 그림은 늘 1080×1920 RGB PNG(알파 없음, 100~200 KB 남짓)다.
메뉴에 줄을 둘지는 `TTW_APP.canSaveImage`(사진에 저장되는 기기)·`TTW_APP.canShareImage`(공유 시트) 로 본다(디자인 10/23).
`native.js` 가 켤 때 플러그인의 `info` 에 한 번 묻고 답이 오면 `true` 가 된다(처음엔 `false`, 보통 몇 ms 안). 기다려야 하면 `await TTW_APP.imageInfo`(`{save, share}`).
10/30 부터 모든 기기가 저장한다(디자인 79판 '모든 기기에 둔다', 사용자 "어느 플랫폼에서나 항상 같은 이미지"). 옛 앱(플러그인이 없는 iOS 판)은 둘 다 `false` 이고, 웹에는 `TTW_APP` 이 없다(웹은 내려받기).

- **공유**: 앱 캐시(안드로이드 `cache/share/`, iOS `tmp/share/`. 지난번 것은 지운다)에 쓰고 공유 시트에 넘긴다(안드로이드는 템플릿에 있던 `FileProvider`
  `${applicationId}.fileprovider`, iOS 는 `UIActivityViewController` 에 파일 주소). 권한이 없다.
- **저장**(`Pictures/TT Wizard`, iOS 는 사진 앱): 안드로이드 10(API 29) 이상은 `MediaStore` 에 제 파일을 더한다(권한 없음, 이름이 겹치면 MediaStore 가 번호를 붙인다).
  9 이하는 처음 저장할 때 저장소 쓰기 권한(`WRITE_EXTERNAL_STORAGE`, 매니페스트 `maxSdkVersion="28"`)을 묻고 파일로 쓴 뒤 미디어 스캔을 건다(이름이 겹치면 ` (2)`부터).
  iOS 는 사진 추가 전용 권한(`PHPhotoLibrary` `.addOnly`, 목적 문구 `시간표 이미지를 사진에 저장할 때 필요해요.`)을 묻고 `PHAssetCreationRequest` 에 받은 바이트를 그대로 넣는다.
- **거절 code**(화면 `saveFailed`, 디자인 79판 '문구'): `DENIED` 는 사진 접근을 허락하지 않은 것(이번에 거절, 전에 거절해 다시 묻지 않음, iOS 제한) → `사진 접근이 꺼져 있어요` [설정]
  (`TTW_APP.openSettings()`), `UNSUPPORTED` 는 이 앱 연결이 못 하는 것(옛 앱) → 공유 시트로, `FAILED`·그 밖은 `사진에 저장하지 못했어요` [다시 시도].
  메서드가 없는 옛 플러그인(Capacitor 의 `UNIMPLEMENTED`)은 `native.js` 가 `UNSUPPORTED` 로 바꾼다.
- 공식 플러그인(`@capacitor/share` + `@capacitor/filesystem`)을 쓰지 않은 까닭: 파일을 쓰려면 `@capacitor/filesystem` 이 있어야 하는데, 그것이 `ionfilesystem-android`·
  `kotlinx-coroutines`·iOS `ion-ios-filesystem` 을 더 끌고 온다(고지문이 늘고 네이티브 의존이 커진다). 필요한 일은 파일 하나 쓰고 넘기는 것뿐이라 앱 안에 40줄 남짓으로 뒀다.
  클라우드에서는 안드로이드 빌드를 못 해서, 고친 뒤에는 Actions `app` 이 컴파일하는지 본다(이 세션은 가짜 android·Capacitor 클래스로 `javac` 만 돌려 봤다).
- 파일은 받은 바이트 그대로 쓴다(안의 시간표 자료가 남는다). 받는 앱이 다시 압축하면 자료는 빠진다(카카오톡 '사진' 등).
- iOS 플러그인(10/30)은 Mac 이 없어 Actions 의 시뮬레이터 빌드로만 컴파일을 본다. 공유 시트의 '이미지 저장'에도 `NSPhotoLibraryAddUsageDescription` 이 있어야
  해서 같이 넣었다(없으면 그 자리에서 앱이 꺼진다). 사용자가 사진 권한을 거부해도 공유 시트의 다른 길(파일·메신저)로는 내보낼 수 있다(법무 10/23: 선택 권한을
  거부했다고 기능을 막지 않기). 웹뷰의 파일 고르기도 iOS 에서는 '사진 찍기'를 같이 보여서 `NSCameraUsageDescription` 이 필요할 수 있고, 사진 앱에서 고른 그림을
  JPEG 로 바꿔 넘기면 안의 자료가 빠진다(둘 다 iOS 기기에서 볼 것).

## 시간표 링크로 앱 열기 (10/30)

사용자 10/23 저녁: "링크로 공유 했을 때 어플이 있으면 어플 켜서 시간표 추가, 어플 없으면 웹으로 시간표 띄우는 기능". 링크 꼴은 `docs/timetables.md` '링크에 담기'.
앱이 깔린 폰에서 `https://archi142857.github.io/tt-wizard/#t=…` 를 누르면 앱이 열리고(`native.js` 의 `launchUrl`·`ttw:open-url` 로 화면에 넘긴다),
앱이 없으면 웹 앱이 열려 '공유받은 시간표' 시트를 보인다.

- **안드로이드 App Links**: `MainActivity` 의 `autoVerify` intent-filter(`https`, 호스트 `archi142857.github.io`, `path="/tt-wizard/"`). 경로는 웹 앱 첫 주소 하나만이다:
  같은 사이트의 실측 페이지(`field/`)·고지문·처리방침 같은 다른 페이지는 앱이 깔려 있어도 브라우저로 열려야 한다. `#` 뒤는 맞춰 보지 않는다.
- **iOS Universal Links**: 권한 파일 `app/ios/App/App/App.entitlements` 의 `applinks:archi142857.github.io`(앱 타깃의 `CODE_SIGN_ENTITLEMENTS`).
  Apple 쪽 확인 파일에는 경로와 `#` 뒤를 함께 적을 수 있어서 `#t=` 가 있는 주소만 앱으로 보낸다(아래). 무료 개인 팀(Personal Team)은 이 권한을 서명할 수 없어서
  그때 기기에 깔려면 권한 파일의 줄을 잠시 뺀다.
- **확인 파일은 도메인 맨 위에 있어야 한다**: `https://archi142857.github.io/.well-known/assetlinks.json`(안드로이드)과
  `https://archi142857.github.io/.well-known/apple-app-site-association`(iOS). 이 레포는 `/tt-wizard/` 아래에 올라가서 거기에 둘 수 없다.
  **사용자 사이트 저장소가 따로 있어야 한다**: GitHub 에 `archi142857.github.io` 라는 이름의 공개 저장소를 만들고 Pages 를 켠다(이 레포의 Pages 는 그대로다).
  그 저장소 맨 위에 빈 `.nojekyll` 파일을 둔다(없으면 Jekyll 이 점으로 시작하는 `.well-known` 폴더를 올리지 않는다).
- `assetlinks.json` 에 넣을 지문은 앱을 서명한 인증서의 SHA-256 이다. Play 에 올리면 Play Console > 앱 무결성 > 앱 서명 에 'Play 앱 서명 키'와 '업로드 키'의
  SHA-256 이 보인다(같은 화면에 이 파일 견본도 있다). 둘 다 넣는다(Play 에서 받은 앱은 앱 서명 키, 직접 깐 출시 APK 는 업로드 키로 서명돼 있다):
  ```json
  [{
    "relation": ["delegate_permission/common.handle_all_urls"],
    "target": {
      "namespace": "android_app",
      "package_name": "com.ttwizard.app",
      "sha256_cert_fingerprints": ["<Play 앱 서명 키 SHA-256>", "<업로드 키 SHA-256>"]
    }
  }]
  ```
- `apple-app-site-association`(확장자 없음)은 Apple 개발자 팀 ID 가 생긴 뒤에:
  ```json
  {"applinks": {"details": [{"appIDs": ["<팀 ID>.com.ttwizard.app"], "components": [{"/": "/tt-wizard/", "#": "t=*"}]}]}}
  ```
  Apple 은 이 파일을 자기 CDN 으로 받아 간다. GitHub Pages 가 확장자 없는 파일을 어떤 형식(Content-Type)으로 내는지와 Apple 이 받아 가는지는 iOS 를 낼 때 기기로 본다.
- Actions 의 디버그 APK 는 실행마다 다른 디버그 키로 서명돼 확인 파일과 맞지 않는다. 그 APK 로 보려면 설정 > 앱 > TT Wizard > 기본으로 열기 >
  `지원되는 링크 열기`·링크 추가에서 `archi142857.github.io` 를 손으로 켠다(안드로이드 12 이상. 그 전 판은 링크를 누를 때 앱을 고르는 창이 뜬다).
- 확인 파일이 없거나 지문이 틀리면 안드로이드 12 이상은 링크를 브라우저로 연다(웹 앱의 '공유받은 시간표' → `내 시간표에 넣기`). 기능이 막히지는 않는다.

## 홈 화면 위젯 (안드로이드, 10/30)

사용자 10/30 "위젯 설계하자" → 목록(다음 수업·오늘 수업·주간 시간표) → "셋 다 만들고". 위젯은 안드로이드 Java(`RemoteViews`, Glance·Compose 없이)로 짰다.
iOS 위젯(WidgetKit)은 iOS 를 낼 때 붙인다(App Group 을 쓰면 개인정보 매니페스트의 사유 코드를 본다, 법무).

| 위젯 | 크기 | 보이는 것 |
| --- | --- | --- |
| 다음 수업 | 2×2 | 다음 수업(지금 수업 중이면 그다음)의 과목명·시각·강의실과, 그날 첫 수업이면 `10:18 출발 · 걷기 12분`, 앞 수업에서 오면 `걷기 8분`(늦으면 빨간 `5분 늦음`). 오늘 마지막 수업 중이면 `지금 수업` · `오늘 마지막 수업`. 오늘이 끝났으면 다음 수업 날의 첫 수업(`내일`·`월요일`·`11월 9일 (월)`), 개강 전이면 `개강 · 9월 1일 (화)` |
| 오늘 수업 | 4×2, 4×4 까지 늘린다 | `오늘 · 10월 30일 (금)` 과 시간표 이름, 오늘 수업 행(항목 색 막대, 과목명, 강의실·걷기, 시각, 지금 수업에 `지금`, 끝난 수업은 흐리게). 위젯 높이만큼 안 끝난 수업부터, 넘치면 `외 n개`. 수업이 없는 날은 `오늘은 수업이 없어요`(개강 전이면 `아직 개강 전이에요`)와 `다음 · 월요일 09:00 과목명` |
| 주간 시간표 | 4×4 | 학기·시간표 이름과 한 주 격자(월~금, 토·일은 수업이 있을 때만, 수업이 있는 시간만. 오늘 열은 옅은 파랑, 칸은 시간표 칸 색에 과목명과 남는 자리에 강의실) |

- **자료**: 앱 연결(`native.js`)이 앱을 켜고 조금 뒤(2.5초)와 앱을 내릴 때(`visibilitychange` 가 `hidden`, `pagehide`) 기기에 둔 값(localStorage `ttw.timetables@학기` 의 대표 시간표,
  `ttw.home`·`ttw.mode`·`ttw.timetableColor`)으로 `T.widgetDataFromStore` 를 돌려(걷는 분은 `engine.js` 의 이동 행렬과 앱에 넣은 `data/campus.json`) JSON(`docs/timetables.md` '홈 화면 위젯')을
  `WidgetPlugin` 에 넘기고, 플러그인이 이 앱의 SharedPreferences(`ttw_widgets`)에 둔다. 화면 코드는 고칠 것이 없다(10/30 처음 판은 화면이 넘기길 기다려서 위젯이 비어 있었다).
  대표 시간표는 적어 둔 수업(`own`·`base`)이라 편람이 바뀐 것은 그 항목을 앱에서 열어 '편람 바뀜'을 본 뒤에 따라온다. 화면이 `TTW_APP.updateWidgets(T.widgetData(...))` 로
  편람과 맞춘 값을 직접 넘기면 그 뒤로는 앱 연결이 넘기지 않는다(그때도 같은 꼴). 서버로 보내지 않는다(데이터 보안 '수집 없음' 그대로). 앱을 깔고 한 번도 안 열었으면
  `앱을 열면 대표 시간표가 보여요`. 안드로이드 기기 백업에 같이 들어갈 수 있다(위 '기기 백업').
- **무엇을 보일지**(`WidgetData.java`, 화면 코드 없는 순수 셈): 그날이 든 학기, 없으면 가장 먼저 시작하는 앞으로의 학기. 다음 수업·다시 그릴 때·오늘 행 고르기·
  주간 격자의 요일·시간·겹친 칸 줄. `tests/test_widgets.py` 가 화면이 만든 자료를 이 클래스로 읽혀 본다(JDK 가 있을 때).
- **다시 그리는 때**(`WidgetUpdater.java`): 오늘 남은 수업의 시작·끝과 다음 날 0시. 부정확 알람(`AlarmManager.setWindow`, `RTC`: 기기를 깨우지 않고 화면이 켜질 때 온다)이라
  정확한 알람 권한이 없다(법무: `USE_EXACT_ALARM` 은 쓰지 않는다). 창이 10분(안드로이드 12 이상의 가장 짧은 창)이라 수업이 시작해도 10분쯤 늦게 바뀔 수 있다.
  그래서 '몇 분 남음' 대신 시각(`10:18 출발`)을 보인다. 받침: 위젯 정보의 `updatePeriodMillis` 3시간, 기기 시각·시간대가 바뀔 때, 앱을 업데이트했을 때
  (`WidgetUpdater` 의 intent-filter). 기기를 다시 켜면 위젯 서비스가 위젯을 새로 그리게 해서 부팅 권한도 없다.
- **색**: 웹 화면 기본 테마 토큰과 같은 값(`values(-night)/colors.xml` 의 `widget_*`, 시험이 `web/style.css` 와 견준다). 위젯은 앱의 테마(라이트·다크·크리스마스)가 아니라
  기기의 라이트·다크를 따른다. 글자색은 XML 이 정해서 기기 테마가 바뀌면 런처가 다시 펼칠 때 맞는다. 주간 격자는 그림이라 라이트·다크 두 장을 늘 넣고
  `layout(-night)/widget_week.xml` 이 한 장을 보인다. 글꼴은 기기 기본(Pretendard 를 넣지 않았다), 크기는 sp 라 기기 글자 크기를 따른다(격자 그림은 1.3배에서 멈춘다).
- **누르면**: 앱의 내 시간표. `MainActivity` 에 `https://archi142857.github.io/tt-wizard/#tab=mine&sem=<학기>` 를 넘기고 `native.js` 의 `launchUrl`·`ttw:open-url` 로 화면에 간다
  (화면이 `#tab=mine` 을 읽어 내 시간표로, `sem` 이 있으면 그 학기로. 프론트엔드가 0e822ff 에 넣었다).
- **글과 자리**(디자인 89판 '홈 화면 위젯', update69): 여러 줄이 되는 글(다음 수업 과목명·출발 줄, 빈 상태 글)은 안드로이드 13 이상에서
  `lineBreakWordStyle="phrase"`(`widget_styles.xml` 의 `TTWWidget`), 격자 그림은 `LineBreakConfig` phrase 로 낱말(어절) 가운데서 끊지 않는다.
  과목명 끝 번호(`대학 글쓰기 1` 의 `1`)는 앱 화면처럼 앞 낱말과 한 줄에 들어가면 U+00A0 으로 붙인다(`WidgetData.glueTail`, `app.js` 의 `glueTail` 과 같은 규칙).
  다음 수업 위젯이 낮으면 130dp 아래에서 과목명을 한 줄로, 116dp 아래(옛 런처 2×2 는 110dp)에서 강의실 줄도 뺀다(머리 줄·출발 줄은 남김. 글자 크기를 따라 기준도 커진다).
  `지금` 태그는 12sp(타입 표의 가장 작은 글), 끝난 수업 행은 글과 막대 모두 흐리게(막대 40%). 굵기는 bold 그대로(`sans-serif-medium` 은 안드로이드 11 아래에서 한글이 보통 굵기로 나올 수 있다).
- **다시 그릴 때 처음 모양부터**(update69): 런처는 같은 레이아웃이면 전에 펼친 화면을 버리지 않고 새 `RemoteViews` 의 바꿈만 다시 얹는다(`AppWidgetHostView` 의 재사용).
  그래서 `WidgetViews` 는 그릴 때마다 바뀔 수 있는 보이기를 먼저 레이아웃의 처음 모양으로 되돌린다(`NEXT_SHOWN`·`NEXT_HIDDEN` 등, 시험이 XML 과 견준다).
  update66~68 은 이걸 안 해서 `앱을 열면 대표 시간표가 보여요` 가 뜬 위젯은 자료가 들어온 뒤에도 그 글이 남을 수 있었다(위젯을 지우고 다시 놓으면 보였다).
- **위젯 고르는 화면**: 이름·설명은 `strings.xml`, 안드로이드 12 이상은 미리 보기 레이아웃(`widget_*_preview.xml`, 지어낸 보기), 그 아래는 앱 아이콘.
- 클라우드에서는 가짜 android 클래스로 `javac` 만 돌려 봤다. Actions `app` 의 APK 로 폰에서 본다(아래 '폰에서 볼 것' 8).

## 앞으로 기능을 만들 때 (법무 10/22)

- GitHub Pages 에서 받는 JSON 으로 기능을 켜고 끄거나(원격 플래그) 웹 묶음을 바꾸는 구조는 만들지 않는다. 자료로 쓰는 JSON(편람 등)은 괜찮다
  (Apple 2.5.19 는 숨긴 기능을 앱 삭제 사유로 넣었고, Play 도 스토어 업데이트가 아닌 방법으로 앱을 바꾸는 것을 막는다).
- 강의 변경 알림·수업 알림: FCM 대신 기기가 JSON 을 보고 로컬로 알린다(WorkManager). 수업 알림은 부정확 알람으로(`USE_EXACT_ALARM` 은 정확한 알람이 핵심인 앱만).
- 스크린샷 가져오기: 사진 선택 도구(Android Photo Picker, iOS 시스템 피커)로 고른 그림만 받아 기기 안에서 읽는다. 캘린더 내보내기: `.ics`·공유 시트.
  그러면 사진·캘린더 권한과 Play 신고가 필요 없고 '수집 없음'이 그대로다. FCM·클라우드 OCR 을 쓰면 처리방침(국외 처리위탁)과 iOS 개인정보 라벨이 바뀐다.
- ML Kit 처럼 `.so` 가 든 라이브러리를 넣으면 16 KB 페이지 크기와 데이터 보안(진단 전송)을 같이 본다.
- 로고·아이콘 원본 폴더를 저장소로 옮길 일이 생기면 MIT 코드와 다른 폴더에 두고 그 폴더 README 에 'MIT 대상 아님'을 적는다
  (GitHub 약관 D.6: 라이선스가 있는 저장소에 보탠 것은 같은 조건으로 본다).

## 아이콘

디자인 세션 판(규칙 '로고' > '앱 아이콘 파일')을 `app/assets/icons/` 에 두고 `python scripts/app_icons.py` 로 만든다(Pillow).

- 안드로이드 적응형 아이콘: 앞면·단색(Android 13 테마 아이콘)은 108dp 층 가운데 72dp(사방 16.7 % 여백), 뒷면은 층 전체.
  다크 테마는 `mipmap-night-*`(파랑 바탕·흰 심볼). 안드로이드 7.x(API 24·25)는 `ic_launcher.png`(웹 `icon-512.png`)·`ic_launcher_round.png`.
- iOS: `AppIcon` 1024 한 장(알파 없음) + Dark 모양(`app-icon-1024-dark.png`).
- Play 등록 아이콘(`play-icon-512.png`)과 App Store 등록 아이콘은 콘솔에 따로 올린다.
- 디자인 세션이 아이콘을 다시 내면 `design\v3\app-icons` 의 같은 이름 파일로 덮어쓰고(`legacy-icon-512.png` 는 거기의 `icon-512.png`) 스크립트를 다시 돌린다.
  바뀐 층에서 나오는 파일만 달라져야 한다(전부 달라지면 Pillow 판이 달라 PNG 가 다르게 써진 것이니 화소로 견줘 본다).
  지금은 10/5 판이다: 모자의 옅은 띠를 뚫린 띠로 바꿨고(작은 아이콘에서 모자 모양이 잘 안 보여서) 뒷면 층 둘은 10/1 판 그대로라 거기서 나오는 10장은 그대로였다.

## 판(버전)

- 웹 `APP_VERSION`(`web/js/app.js`) = 안드로이드 `versionName`(`app/android/app/build.gradle`) = iOS `MARKETING_VERSION`(pbxproj 두 곳)
  = `app/package.json`·`package-lock.json` 의 `version`. `tests/test_app.py` 가 확인한다. 웹 판을 올리면 나머지도 같이 올린다(한 zip 에서).
- 기능이 크게 바뀌면 판을 올리고, 올라간 커밋에 `v<판>-alpha` 태그를 붙인다(GitHub Desktop: History 에서 커밋 오른쪽 클릭 → Create Tag → 푸시).
  태그를 보고 도는 워크플로는 없다. 0.7.0(10/22): 내 시간표·아래 탭·탐색 결과 저장.
  `v0.8.0-alpha`(10/23, a3a1a9a): 테마 탭·시간표 이미지·폰 과목 추가 시트. 사용자가 태그만 붙여서 그 커밋의 판 숫자는 0.7.0 이다(고치지 않고 그대로 둔다).
  0.9.0(10/30, 사용자 "이번에 위젯 들어갔으니까 0.9.0"): 안드로이드 홈 화면 위젯 셋, 시간표 링크로 앱 열기·링크 공유, 모든 기기 사진 저장, 테마 기본·라이트·다크, 학기 묶음 시간표 목록.
  여기서부터 판 숫자와 태그가 맞는다(이 판을 올린 커밋에 `v0.9.0-alpha`).
- 스토어에 올릴 때마다 안드로이드 `versionCode`, iOS `CURRENT_PROJECT_VERSION` 을 1씩 올린다.

## 아직 안 한 것 (출시 전에)

1. 서명: 안드로이드 업로드 키(keystore)를 만들어 저장소 비밀값으로 넣고(`TTW_KEYSTORE_FILE`·`TTW_KEYSTORE_PASSWORD`·`TTW_KEY_ALIAS`·`TTW_KEY_PASSWORD`,
   `build.gradle` 이 읽는다) Actions 에 서명한 AAB(`bundleRelease`) 단계를 더한다. iOS 는 Apple 개발자 계정의 인증서·프로비저닝(또는 Mac 의 Xcode 자동 서명).
2. 앱에서만 되는 쓸모(심사 4.2·Play 최소 기능): 시간표 저장(10/22)과 시간표 이미지 저장·보내기(10/23, 10/30 iOS·모든 안드로이드), 시간표 링크로 앱 열기,
   안드로이드 홈 화면 위젯 셋(10/30)이 들어갔다. iOS 위젯은 iOS 를 낼 때.
   링크로 앱이 바로 열리려면 사용자 사이트 저장소에 확인 파일을 올려야 한다(위 '시간표 링크로 앱 열기').
   더 넣는다면 캘린더 내보내기, 위젯, 수강편람 알림(`앱_확장_계획.md`, 위 '앞으로 기능을 만들 때').
3. 개인정보 처리방침 문안과 공개 주소(앱의 `PRIVACY_URL`). 보호책임자·문의는 정보 탭 개발자 정보와 같은 이름·메일이다(사용자·법무 10/23).
   스토어 등록 자료(디자인: 글·그래픽 이미지는 됐고 휴대전화 스크린샷이 남았다), 콘솔의 데이터 보안·개인정보 라벨.
   오픈소스 라이선스 화면과 고지문은 됐다(10/22·23, 위 '권한·기기 백업·오픈소스 고지').
4. 저장한 시간표를 Capacitor Preferences 에도 두기(웹뷰 저장 공간은 OS 가 비울 수 있다. `docs/timetables.md` '기기에 두기').
   iOS 개인정보 매니페스트의 UserDefaults(사유 `CA92.1`)는 이미 들어 있다.
5. iPad 지원 여부, 캠퍼스 마법 지도 자료의 스토어 배포 허락(신용범 님).
6. Google Play: 개인 계정이면 테스터 12명이 14일 동안 비공개 테스트를 한 뒤 프로덕션 신청.

## 폰에서 볼 것 (아직 안 봤다)

클라우드에서는 네이티브 빌드를 못 해서 아래는 코드와 가짜 Capacitor 로만 확인했다. Actions 의 디버그 APK 를 안드로이드 폰에 깔아 본다.

1. 비행기 모드로 처음 켜도 과목 검색과 시간표 만들기가 된다(앱에 넣은 자료). 켤 때 흰 화면이 번쩍이지 않는다.
2. 뒤로 가기: 열린 시트 닫기 → 이전 화면 → 첫 화면에서는 앱이 내려간다(다시 열면 그대로).
3. 상태 바의 시계·아이콘이 라이트·다크 기기 모두에서 보인다. 앱을 켜 둔 채 기기 테마를 바꾸고 돌아와도 보인다(위 '안드로이드 상태 바 글자색').
4. 이벤트 테마: 기기 날짜를 12월(1~31일, 디자인 75판)로 옮기면 크리스마스 테마가 켜진다(앱은 주소로 켤 수 없다). 짙은 초록 바탕 위에서 상태 바 글자가 밝게 나오고,
   `테마` 탭에서 `기본`을 고르면 기기 테마에 맞게 돌아온다. 코드로는 `DARK` = 밝은 글자(안드로이드 `setAppearanceLightStatusBars(false)`, iOS `.lightContent`)다.
5. 정보 화면의 바깥 링크가 앱 안 브라우저(Custom Tab)로 열린다. 과목 시트의 `강의평`(프론트엔드가 넣은 뒤)은 기기의 기본 브라우저나 에브리타임 앱으로 열리고,
   돌아오면 앱 화면이 그대로다.
6. 시간표 이미지: 목록 시트의 `이미지로 저장`이 사진 앱의 `TT Wizard` 앨범에 들어가고, 머리 줄 공유 버튼의 `이미지로 공유`가 공유 시트를 연다. 저장한 이미지를
   항목 목록 맨 아래의 `이미지로 추가`로 고르면 같은 시간표가 돌아온다. 카카오톡 '사진'으로 받은 것은 `jpeg` 오류, '파일'로 받은 것은 불러와진다.
   안드로이드 9 이하 폰이 있으면: 처음 저장할 때 저장소 권한을 묻고, 거절하면 `사진 접근이 꺼져 있어요` [설정] 이 앱 정보 화면을 연다.
7. 시간표 링크: 공유 버튼의 `링크로 공유`가 공유 시트를 연다(카카오톡 등). 받은 링크를 앱이 깔린 폰에서 누르면 앱이 열리고 시간표가 들어간다
   (디버그 APK 는 설정의 '기본으로 열기'에서 링크를 손으로 켠 뒤. 위 '시간표 링크로 앱 열기'). 앱을 켜 둔 채 다른 링크를 눌러도 들어간다.
8. 홈 화면 위젯: 홈 화면을 길게 눌러 위젯 > TT Wizard 에서 셋을 놓고 앱을 한 번 열었다 내린다(10/30 첫 판은 비어 있었다). 대표 시간표가 보이고, 수업 시작·끝 뒤
   (늦어도 10분쯤) 다음 수업이 바뀐다. 오늘 수업을 4×4 로 늘리면 행이 늘고, 기기 테마를 바꾸면 위젯 색이 따라간다(주간 격자 그림도). 누르면 앱의 내 시간표가 열린다.
   대표 시간표·출발 지점을 바꾸고 앱을 내리면 위젯이 바뀐다. 위젯을 먼저 놓아 `앱을 열면 대표 시간표가 보여요` 가 뜬 뒤에 앱을 열었다 내려도
   (지우고 다시 놓지 않아도) 수업이 보여야 한다(update69). 다음 수업 위젯을 가장 낮게 줄이면 과목명이 한 줄, 더 낮으면 강의실 줄이 빠진다.

## 확인한 것 (10/1)

- 클라우드 세션은 안드로이드 SDK·Gradle·Maven 서버에 닿지 않아 네이티브 빌드는 Actions 에서만 한다.
- 앱 묶음을 가짜 Capacitor(안드로이드)로 브라우저에 띄워: 원격 자료 사용·저장, 실패 시 저장본, 저장본이 없으면 스냅샷,
  3초 넘게 늦으면 스냅샷으로 먼저 열고 늦은 응답은 다음에 사용, 뒤로 가기(시트 닫기 → 이전 화면 → 앱 내리기), 내장 글꼴(CDN 요청 없음).
  같은 것을 `tests/native_runner.mjs`(node)가 확인한다.
- 10/4: 화면 코드와 `native.js` 를 가짜 안드로이드 Capacitor 로 함께 띄워, 기본 테마에서는 기기 테마를 바꿀 때마다 `SystemBars.setStyle("DEFAULT")` 가 가고
  크리스마스 테마에서는 처음 `DARK` 한 번뿐인 것을 봤다. 플러그인 쪽 동작은 `@capacitor/android`·`@capacitor/ios` 8.5.2 소스로 읽었다
  (`Capacitor.Plugins.SystemBars` 는 번들러 없이도 네이티브가 만들어 준다).
