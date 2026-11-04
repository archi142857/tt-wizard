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
  `TTWShell`(링크 공유·앱 설정 열기, `ShellPlugin.java`·`ShellPlugin.swift`), `TTWWidget`(홈 화면 위젯 자료, 안드로이드 `WidgetPlugin.java`. 아래 '홈 화면 위젯'),
  `TTWShare`(공유 카드의 바로 보내기: 카카오톡·인스타·문자, 안드로이드 `SharePlugin.java`. 아래 '공유 카드의 바로 보내기').
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

### 출시 빌드 (서명한 AAB, update86)

Play 에 올리는 파일은 업로드 키로 서명한 AAB 다. `release` 워크플로(`.github/workflows/release.yml`, Actions 화면 → release → Run workflow)가 만든다.
서명은 '이 앱을 누가 만들었고 그 뒤로 바뀌지 않았다'는 도장이다. 폰은 같은 키로 서명한 판만 업데이트로 깔고, Play 는 올린 파일이 개발자의 업로드 키로
서명됐는지 본다(Play 앱 서명: 사용자 폰에 가는 앱은 Google 이 보관하는 앱 서명 키로 다시 서명한다). 처음 한 번만 1·2 를 한다.

1. **업로드 키 만들기**(사용자, PC 에서 한 번). 저장소 폴더 밖(예: `문서\TT Wizard 서명\`)에서 cmd 로:
   ```
   "C:\Program Files\Android\Android Studio\jbr\bin\keytool.exe" -genkeypair -v -keystore upload-key.jks -storetype PKCS12 -keyalg RSA -keysize 2048 -validity 10000 -alias upload
   ```
   (Android Studio 가 없으면 JDK 의 `keytool`.) 비밀번호를 두 번 묻고, 이름·조직 같은 칸은 채우거나 비워 두고 마지막에 `y`. PKCS12 라 키 비밀번호도 같은 것이다.
   키 파일과 비밀번호는 따로 백업한다(USB·비밀번호 관리자). 잃어버리면 Play Console 에서 업로드 키 재설정을 요청해야 한다(며칠 걸린다).
   저장소에는 올리지 않는다(`.gitignore` 의 `*.jks`). 백엔드(Claude)는 키 파일·비밀번호를 받지도 넣지도 않는다.
2. **저장소 비밀값 넷**(사용자): GitHub 저장소 → Settings → Secrets and variables → Actions → New repository secret.
   - `TTW_KEYSTORE_BASE64`: 키 파일이 있는 폴더의 PowerShell 에서 `[Convert]::ToBase64String([IO.File]::ReadAllBytes("$PWD\upload-key.jks")) | Set-Clipboard` 한 뒤 붙여 넣는다
     (한 줄 글이어야 한다. `certutil -encode` 는 머리·꼬리 줄이 붙어 안 된다)
   - `TTW_KEYSTORE_PASSWORD`, `TTW_KEY_PASSWORD`: 1의 비밀번호(둘 다 같은 것), `TTW_KEY_ALIAS`: `upload`
   비밀값은 넣은 뒤 아무도(저장소 주인도) 다시 볼 수 없고 Actions 가 돌 때만 읽는다. 워크플로는 그것을 단계의 환경 변수로만 넘기고 로그에 찍지 않는다.
3. **빌드**: Actions → release → Run workflow. 끝나면 실행 화면 아래 **Artifacts > tt-wizard-android-release**(압축 안에 `app-release.aab`, 14일).
   요약(Summary)에 versionCode·versionName, 서명 확인, 업로드 인증서 지문(SHA-256)이 적힌다. 비밀값이 없으면 첫 단계에서 어느 것이 없는지 알리고 멈춘다.
4. **Play Console**: Test and release → Testing → 내부 테스트(테스터를 직접 고름, 심사 없이 바로) 또는 비공개 테스트 → Create new release → AAB 를 올린다.
   처음 올릴 때 Play 앱 서명(Google 이 앱 서명 키를 만들어 보관)을 쓴다(새 앱은 기본). 그 뒤 Protected with Play > Play Store protection > Manage Play app signing 에
   앱 서명 키 인증서와 업로드 키 인증서(3의 지문과 같아야 한다)의 SHA-256 이 나온다(11/4 기준. 예전 '앱 무결성' 화면에는 옮겼다는 안내만 있다).
5. **링크로 앱 열기**: `archi142857.github.io` 저장소의 `.well-known/assetlinks.json` 에 앱 서명 키 SHA-256(Play 로 깐 앱). 직접 깐 출시 빌드도 열리게 하려면 업로드 키 SHA-256 도
   (위 '시간표 링크로 앱 열기').

- versionCode = release 실행 번호 + 100(Play 는 올릴 때마다 커져야 한다. 올리지 않은 실행이 번호를 건너뛰어도 된다). 디버그·PC 빌드는 1. versionName 은 아래 '판'.
- 디버그 APK(app 워크플로)는 안드로이드 기본 디버그 키로 서명돼 Play 에 올릴 수 없고, Play 로 받은 앱과 서명이 달라 서로 덮어 깔리지 않는다.
  비공개 테스트 앱을 깔기 전에 디버그 앱을 지워야 하고, 그러면 그 앱에 저장한 시간표가 없어진다(링크로 공유나 이미지로 저장해 두었다가 새 앱에 넣는다).
- 무엇을 바꾸면 다시 올리나: 앱 화면·기능(`web/` 의 화면 파일, 위젯·안드로이드 코드, 아이콘)은 앱 묶음에 들어가서 바뀌면 새 AAB 를 올려야 폰 앱에 들어간다.
  웹에서만 도는 것(카톡 인앱 브라우저 스크립트처럼 앱 안에서는 하는 일이 없는 것)과 과목 자료(JSON)는 푸시만 하면 된다. 고칠 때마다가 아니라 모아서 올린다.
  화면을 웹에서 받아 오게 하지 않는다(법무: 스토어 업데이트가 아닌 길로 앱을 바꾸지 않기, 아래 '앞으로 기능을 만들 때').

**올린 기록**

- 11/4 0시 43분: 내부 테스트 102 (0.10.0)(release 두 번째 실행, 새로 깔 때 8.74MB, 테스터는 사용자 한 명, 기기 종류는 기본값 휴대전화·태블릿·Chrome OS·Android XR).
  출시 노트(ko-KR)는 공유 폴더 인수인계 6-1. 검토 화면의 경고 둘(테스터 없음, 난독화 파일 없음: `minifyEnabled false` 라 올릴 파일이 없다)은 그대로.
- 앱 서명 키(Google 이 만듦) SHA-256 `D0:52:8D:BB:0E:CC:D9:B7:CD:11:DE:3F:0B:69:D0:DF:06:34:C2:A4:58:76:0C:64:D6:AE:77:87:4A:48:4A:EF`,
  업로드 키 SHA-256 `7A:E8:89:11:2C:2E:34:18:1D:BF:2B:35:F5:62:53:A7:78:C2:D6:F0:27:5C:BE:56:4D:3D:D7:2E:DA:E3:9A:47`(release 요약과 같다). 둘 다 공개해도 되는 값이다.
- Play 자동 보호(Automatic protection, Protected with Play 맨 위)가 처음부터 켜져 있다: Play 가 내보내는 APK 에 실행 때 설치 출처 검사를 넣어
  Play 밖에서 깐 사본에 'Google Play 에서 받으라'는 창을 띄우고, 고친 APK 를 앱 서명 키로 다시 서명한다(내부·비공개·공개 테스트·프로덕션. 디버그 APK·직접 깐 출시 빌드에는 없다).
  'Share app telemetry with Google'(익명 실행 환경·성능 정보) 설정이 따로 있다. 법무 11/4: 자동 보호는 켜 둔다(설치 확인·변조 검사는 기기의 Play 스토어가 기기 안에서 한다,
  오픈소스 라이선스에도 안 걸림). 텔레메트리 나눔은 끈다(켜면 앱 안 코드가 Google 목적으로 실행 환경 자료를 보내 처리방침 '앱이 보내는 것 없음'·데이터 보안 '수집 없음'과 맞추는 일이 생김).
- 첫 심사 전에는 Play 스토어에 임시 이름(패키지 이름 + `(unreviewed)`)과 기본 아이콘, `Rated for 17+`(한국의 일반 앱 등급 3+·7+·12+·16+·19+ 에 없는 값)가 보인다.
  깔린 앱은 TT Wizard 이름·아이콘이다. 카테고리는 콘솔에 `생산성`(Productivity).

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
- **바로 보내기**(update80, 안드로이드. 아래 '공유 카드의 바로 보내기'): `TTW_APP.shareTargets()` 는 이 폰에서 바로 보낼 수 있는 곳
  `[{id, app, icon, text, image}]`(거절하지 않는다, 못 물으면 `[]`), `TTW_APP.shareTo({target, text})`·`({target, bytes, name})` 는 링크·시간표 이미지를 그 앱의
  공유 화면으로 바로 넘긴다. iOS·옛 앱에는 두 함수가 없다.

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
  @capacitor/browser 는 권한이 아니라 Custom Tab 을 찾는 `<queries>` 를 더한다. 앱 매니페스트도 바로 보내기(update80)용 `<queries>` 를 둔다:
  카카오톡(`com.kakao.talk`)·인스타그램(`com.instagram.android`) 패키지와 `smsto:` 를 받는 문자 앱. 권한이 아니고 묻지도 않으며, 모든 앱을 보는
  `QUERY_ALL_PACKAGES` 는 쓰지 않는다(Play 의 패키지 공개 범위 정책에서 따로 신고할 것이 없는 길). 빌드한 APK 의 실제 목록은 `app` 워크플로 실행 화면의
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
  지도(Leaflet)는 `web/licenses/leaflet.txt`(`vendor/leaflet/LICENSE` 와 같은 글, update92), 앱 글꼴 파일 옆에는 `vendor/pretendard/LICENSE.txt` 도 있다. 화면(정보 > 오픈소스 라이선스)이 `licenses/` 파일들을 읽는다.
  화면이 읽는 파일은 이름 끝에 확장자가 있어야 한다: 앱 안 서버는 마지막 조각에 '.' 이 없는 주소에 `index.html` 을 준다(Capacitor 8.5.2 안드로이드
  `WebViewLocalServer` 의 html5mode, iOS `Router` 도 확장자가 없으면 `index.html`). 그래서 11/4 사용자 폰(0.10.0)의 Leaflet 칸에 고지문 대신 `index.html` 소스가 보였다
  (웹은 파일을 그대로 줘서 괜찮았다). update92 가 `web/licenses/leaflet.txt` 를 넣고, 프론트엔드가 그 줄의 파일을 바꾸고 HTML 이 오면 고지문으로 쓰지 않는다(요청 11/4).
  `tests/test_app.py` 의 확장자 시험은 프론트엔드가 바꿀 때까지 xfail 이다(바꾸면 표시를 뗀다).

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

## 공유 카드의 바로 보내기 (안드로이드, update80)

사용자 11/3(구글 공유 창 캡처: `공유` 제목과 닫기, 주소 칸과 `링크 복사`, 아래 동그란 앱 단추와 이름): "공유 탭은 이런 형태로 바꿔줘. 카카오톡, 인스타(스토리, DM),
메세지 등등 넣어주고". 카드 모양은 디자인, 화면은 프론트엔드가 하고, 앱 단추가 부를 기기 기능을 앱 안 플러그인 `TTWShare`
(`app/android/app/src/main/java/com/ttwizard/app/SharePlugin.java`)가 맡는다. 화면은 `native.js` 의 `TTW_APP.shareTargets()`·`TTW_APP.shareTo(...)` 로 쓴다.

- **곳**(이 순서): `kakao` 카카오톡, `instagram-story` 인스타 스토리, `instagram-dm` 인스타 DM, `sms` 기기의 기본 문자 앱(`Telephony.Sms.getDefaultSmsPackage`).
  깔려 있지 않거나 그 내용을 받지 않는 곳은 목록에서 빠진다. `text`·`image` 는 링크·시간표 이미지를 받는지. 인스타 스토리는 이미지만이다
  (스토리에 링크를 붙여 보낼 길이 없다. 링크는 화면이 복사해 두면 스토리의 링크 스티커에 붙여 넣을 수 있다).
- **어떻게**: SDK·키·계정 없이 안드로이드 공유 인텐트를 그 앱으로 좁힌다. 링크는 `ACTION_SEND` `text/plain`(`EXTRA_TEXT`), 문자는 받는 사람 없이 글만 채운 새 메시지
  (`ACTION_SENDTO` `smsto:`, `sms_body`), 이미지는 `ACTION_SEND` `image/png`(`TTWImage` 공유와 같은 `cache/share/`·FileProvider, 이번 한 번 읽기 허락).
  앱이 받는 화면이 여럿이면(인스타의 피드·스토리·채팅) 화면 이름의 낱말로 고른다(스토리 `story`, DM `direct`). 못 고르면 그 앱의 받는 화면만 든 기기 선택 창이 뜬다
  (인스타가 화면 이름을 바꿔도 막히지 않고 한 번 더 고르게 될 뿐이다).
- **인스타 스토리의 공식 길을 쓰지 않는 까닭**: Meta 문서의 'Sharing to Stories'(`com.instagram.share.ADD_TO_STORY`)는 2023년 1월부터 Facebook 앱 ID 가 있어야 하고
  (없으면 인스타가 '공유한 앱이 스토리 공유를 지원하지 않는다'는 오류를 띄운다), 앱 ID 는 Meta 개발자 계정과 앱 등록이 필요하다(다른 서비스라 법무 먼저).
  그래서 기기 공유 창에서 사용자가 인스타의 '스토리'를 고를 때와 같은 받는 화면을 연다.
- **아이콘·이름**: `app` 은 그 앱이 기기에 알리는 이름(카카오톡, Instagram, 메시지 …), `icon` 은 그 앱 아이콘을 기기에서 받아 144px PNG 로 그린 것(data URL. 적응형 아이콘은
  기기의 아이콘 모양 그대로). 기기 공유 창이 보여 주는 것과 같고, 우리가 로고를 그리거나 저장소에 두지 않는다. 단추 이름은 화면(디자인)이 정한다.
- **보이는 범위**: 안드로이드 11 이상은 매니페스트 `<queries>` 에 적은 앱만 보인다(위 '권한'). 곳을 더하면 `SharePlugin.TARGETS` 와 `<queries>` 를 함께 고친다.
  무엇이 깔렸는지는 기기 안에서만 보고 밖으로 보내지 않는다(Play 데이터 보안의 '설치된 앱'은 기기 밖으로 보낼 때 적는 것).
- **거절 code**: `UNSUPPORTED`(앱 연결에 없음: iOS·옛 앱, 메서드가 없는 판), `MISSING`(그 앱이 지워졌거나 그 내용을 받지 않음), `FAILED`(그 밖). 화면은 `MISSING` 이면
  목록을 다시 묻고, 그 밖에는 기기 공유 시트(`shareLink`·`shareImage`)로 돌린다(프론트엔드).
- **웹·iOS**: 웹은 앱을 골라 보낼 길이 없다(카카오톡은 카카오 JavaScript SDK·앱 키·사이트 등록, 인스타는 길이 없다). 웹과 iOS 는 링크 복사, 문자(폰 브라우저의
  `sms:` 주소), 기기 공유 시트(`navigator.share`·`shareLink`. 거기에 카카오톡·인스타가 나온다)로 둔다. 카카오 SDK·Meta 앱 ID 를 쓰려면 사용자가 계정을 만들고
  법무가 먼저 본다(정하지 않았다).
- 클라우드에서는 가짜 android·Capacitor 클래스로 `javac` 만 돌려 봤다. Actions `app` 이 컴파일하는지와 폰에서 아래 '폰에서 볼 것' 9 를 본다.

## 시간표 링크로 앱 열기 (10/30)

사용자 10/23 저녁: "링크로 공유 했을 때 어플이 있으면 어플 켜서 시간표 추가, 어플 없으면 웹으로 시간표 띄우는 기능". 링크 꼴은 `docs/timetables.md` '링크에 담기'.
앱이 깔린 폰에서 `https://archi142857.github.io/tt-wizard/#t=…` 를 누르면 앱이 열리고(`native.js` 의 `launchUrl`·`ttw:open-url` 로 화면에 넘긴다),
앱이 없으면 웹 앱이 열려 '공유받은 시간표' 시트를 보인다. 11/4 부터는 앱도 같은 시트를 띄우고 `내 시간표에 넣기`를 누를 때만 넣는다
(프론트엔드 ui103b, 디자인 118판. 그 전에는 앱이 보여 주지 않고 바로 넣었다. `docs/timetables.md` '링크에 담기'의 받기).

- **안드로이드 App Links**: `MainActivity` 의 `autoVerify` intent-filter(`https`, 호스트 `archi142857.github.io`, `path="/tt-wizard/"`). 경로는 웹 앱 첫 주소 하나만이다:
  같은 사이트의 실측 페이지(`field/`)·고지문·처리방침 같은 다른 페이지는 앱이 깔려 있어도 브라우저로 열려야 한다. `#` 뒤는 맞춰 보지 않는다.
- **iOS Universal Links**: 권한 파일 `app/ios/App/App/App.entitlements` 의 `applinks:archi142857.github.io`(앱 타깃의 `CODE_SIGN_ENTITLEMENTS`).
  Apple 쪽 확인 파일에는 경로와 `#` 뒤를 함께 적을 수 있어서 `#t=` 가 있는 주소만 앱으로 보낸다(아래). 무료 개인 팀(Personal Team)은 이 권한을 서명할 수 없어서
  그때 기기에 깔려면 권한 파일의 줄을 잠시 뺀다.
- **확인 파일은 도메인 맨 위에 있어야 한다**: `https://archi142857.github.io/.well-known/assetlinks.json`(안드로이드)과
  `https://archi142857.github.io/.well-known/apple-app-site-association`(iOS). 이 레포는 `/tt-wizard/` 아래에 올라가서 거기에 둘 수 없다.
  **사용자 사이트 저장소가 따로 있어야 한다**: GitHub 에 `archi142857.github.io` 라는 이름의 공개 저장소를 만들고 Pages 를 켠다(이 레포의 Pages 는 그대로다).
  그 저장소 맨 위에 빈 `.nojekyll` 파일을 둔다(없으면 Jekyll 이 점으로 시작하는 `.well-known` 폴더를 올리지 않는다).
  **11/4 만들었다**(사용자, 공개, Pages 는 main 루트): 앱마다 `apps/<링크 경로>/assetlinks.json`(TT Wizard 는 `apps/tt-wizard/`, 지문 차례 1 앱 서명 키·2 업로드 키)과
  `README.md` 를 두고, `scripts/build.py` 가 폴더 이름 순서로 합쳐 `.well-known/assetlinks.json` 을 만든다(안드로이드는 이 한 자리만 읽는다). 푸시하면 `check` 워크플로가
  `build.py --check` 로 합친 파일이 조각과 같은지·지문 꼴을 본다. 앱 폴더를 `apps/` 아래에 두는 것은 맨 위에 다른 저장소 이름과 같은 폴더(`tt-wizard/`)를 두면
  그 프로젝트 사이트 주소(이 레포의 Pages)와 겹쳐서다. 그 저장소에 사용자 지정 도메인을 걸면 이 레포의 Pages 도 그 도메인으로 옮겨 가 앱 링크 확인이 깨진다.
  Google Digital Asset Links API(`statements:list`, `source.web.site=https://archi142857.github.io`)로 두 지문이 읽히는 것을 확인했다(11/4).
- `assetlinks.json` 에 넣을 지문은 앱을 서명한 인증서의 SHA-256 이다. Play 에 올리면 Play Console > Protected with Play > Play Store protection >
  Manage Play app signing 에 'Play 앱 서명 키'와 '업로드 키'의 SHA-256 이 보인다(11/4 올린 값은 위 '출시 빌드'의 '올린 기록').
  둘 다 넣는다(Play 에서 받은 앱은 앱 서명 키, 직접 깐 출시 APK 는 업로드 키로 서명돼 있다):
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
- **메신저 인앱 브라우저**(11/4 사용자 폰): 카카오톡처럼 링크를 자기 웹뷰로 여는 앱은 안드로이드에 링크를 넘기지 않아 앱 링크가 걸리지 않는다(카톡 웹뷰에
  웹 시트가 뜨고, 카톡 메뉴 '다른 브라우저로 열기' → 크롬이면 앱이 열린다). 카카오톡은 프론트엔드 ui102a 가 `index.html` 머리 스크립트로 페이지를 다 읽은 뒤 한 번
  `kakaotalk://web/openExternal?url=<그 주소>` 를 연다(카카오 공식 문서에 없는 관례. 카톡의 '다른 브라우저로 열기'와 같은 일): 앱이 있으면 앱이, 없으면 기본 브라우저가
  열어서 시간표도 카톡 웹뷰가 아니라 자기 브라우저에 남는다. 안 먹히는 카톡이면 지금처럼 시트. 폰의 카톡(안드로이드·아이폰)에서 `#t=` 링크만, 같은 창의 같은 주소는
  한 번만(`sessionStorage` `ttw.kakaoOut`). 11/4 사용자 폰에서 카톡 링크로 앱이 열리는 것을 봤다. 앱 안에서는 사용자 에이전트에 `kakaotalk` 이 없어 하는 일이 없다.
  인스타그램 인앱 브라우저는 공식 탈출 길이 없어 그대로다(필요하면 안드로이드 `intent://` 를 기기에서 시험).

## 홈 화면 위젯 (안드로이드, 10/30)

사용자 10/30 "위젯 설계하자" → 목록(다음 수업·오늘 수업·주간 시간표) → "셋 다 만들고", 오후 "그 날의 동선 지도 위젯도 하나 만들자"(update71).
위젯은 안드로이드 Java(`RemoteViews`, Glance·Compose 없이)로 짰다.
iOS 위젯(WidgetKit)은 iOS 를 낼 때 붙인다(App Group 을 쓰면 개인정보 매니페스트의 사유 코드를 본다, 법무).

위젯 넷 모두 맨 위에 머리 띠(update78, 디자인 106판: 앱 테마의 바탕색 `bg` 단색, 제목 13 굵게 `on-bg-heading`, 오른쪽 흐린 글 12 `on-bg-text3`, 아래 '색과 테마'),
그 아래 몸(`card`)이다.

| 위젯 | 크기 | 보이는 것 |
| --- | --- | --- |
| 다음 수업 | 2×2 | 머리 띠에 항목 색 점(`card` 1 테두리)과 `다음 수업`. 다음 수업(지금 수업 중이면 그다음)의 과목명·시각·강의실과, 아래쪽 옅은 파랑 블록 가운데에 크게(시각·분 32 굵게·낱말은 반, update77. update70 은 20) 그날 첫 수업이면 `10:18 출발`(그 아래 `걷기 12분`), 앞 수업에서 오면 `걷기 8분`(그 아래 `25동에서`, 늦으면 빨간 `5분 지각`). 오늘 마지막 수업 중이면 `지금 수업`과 `16:50 끝`·`오늘 마지막 수업`, 걷기를 모르면 `15:00 시작`. 오늘이 끝났으면 다음 수업 날의 첫 수업(`내일`·`월요일`·`11월 9일 (월)`), 개강 전이면 `개강 · 9월 1일 (화)` |
| 오늘 수업 | 4×2, 4×4 까지 늘린다 | 머리 띠에 `오늘 · 10월 30일 (금)` 과 시간표 이름, 오늘 수업 행(항목 색 막대, 과목명, 강의실·걷기, 시각, 지금 수업에 `지금`, 끝난 수업은 흐리게). 위젯 높이만큼 안 끝난 수업부터, 넘치면 `외 n개`. 수업이 없는 날은 `오늘은 수업이 없어요`(개강 전이면 `아직 개강 전이에요`)와 `다음 · 월요일 09:00 과목명` |
| 주간 시간표 | 4×4 | 머리 띠에 학기·시간표 이름, 한 주 격자(월~금, 토·일은 수업이 있을 때만, 수업이 있는 시간만. 오늘 열은 `accent-weak`, 칸은 시간표 칸 색에 과목명과 남는 자리에 강의실, 칸 글자는 칸마다의 글자색 `item-N-fg`·`fg2`) |
| 동선 지도 | 4×2, 4×4 까지 늘린다 | 머리 띠에 `오늘 · 10월 30일 (금)`(오늘 수업이 다 끝났으면 `내일 · 10월 31일 (토)`·`월요일 · 11월 2일`, 개강 전 `개강 · …`)과 오른쪽 그날 걷기 합(`걷기 31분`, 가는 길 + 돌아가는 길), 그날 지도: 바탕 지도 위에 수업 가는 길(파랑 실선), 마지막 수업 뒤 출발·도착 자리로 돌아가는 길(남색 파선, 오른쪽으로 비킴), 선 끝과 핀을 잇는 점, 수업 핀(번호 = 그날 차례, 같은 건물·가까운 핀은 `2·3`), 출발·도착 자리 핀(집). 오른쪽 아래 `© 국토지리정보원 · © OpenStreetMap`. 강의실이 정해진 수업도 출발 자리도 지도에 없으면 `강의실이 정해진 수업이 없어요` |

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
- **색과 테마**(update78, 11/2 사용자가 폰 위젯 머리 줄에 빨간 동그라미를 치고: "색깔이 테마에 맞춰서 바뀌게 색을 넣어줘. 나머지 위젯들도 마찬가지임", 프론트엔드가 물어
  '위젯 전체가 앱 테마'. 디자인 106판 '테마'·'머리 띠'·'크리스마스 한 벌'): 위젯 넷은 앱에서 고른 테마로 그린다(`WidgetData.theme`).
  - 기본(기기 설정): 기기의 라이트·다크. 손으로 쓴 `layout(-night)/widget_*.xml`·`values(-night)/colors.xml` 의 `widget_*` 이라 기기 설정을 바꾸면 런처가 다시 펼칠 때 바로 맞는다.
    주간 격자·동선 지도는 그림이라 라이트·다크 두 장을 늘 넣고 `layout(-night)` 판이 한 장을 보인다.
  - 라이트·다크를 골랐으면 그 한 벌(기기가 다크여도 라이트), 이벤트 테마가 켜져 있으면(크리스마스 12월 1~31일, 그 해에 끄지 않았으면) 고른 것과 상관없이 그 한 벌.
    `scripts/widget_themes.py` 가 손으로 쓴 판(`widget_next`·`widget_today`·`widget_today_row(_past)`·`widget_week`·`widget_map`·`widget_empty`와 색을 쓰는 그림)을 옮겨
    색만 그 한 벌로 바꾼 `widget_*_light`·`_dark`·`_xmas` 와 그 색·스타일(`values/widget_themes.xml`, 값은 `web/style.css` 의 그 테마 토큰. 크리스마스에 없는 토큰은 라이트 값)을
    만든다(`--check` 를 시험이 돌린다. 손으로 쓴 판을 고치면 다시 만든다). 그림은 그 한 벌로 한 장만(`WeekBitmap.XMAS`·`DayMapBitmap.XMAS`: 크리스마스 지도는 앱처럼 라이트 바탕
    지도에 초록 길·핀).
  - 한 벌마다 레이아웃이 따로라 테마를 바꾸면 런처가 새로 펼친다(같은 레이아웃이면 전 화면 위에 바꿈만 얹어서 코드로 넣은 색이 남는다: 아래 '다시 그릴 때 처음 모양부터').
    코드는 색을 숫자로 넣지 않는다.
  - 고른 것은 앱 화면이 기기에 둔 `ttw.scheme`("light"·"dark", 기본이면 없음)·`ttw.themeOff`(그 해에 끈 이벤트 테마 `xmas-2026`)이고 앱 연결이 위젯 자료(`scheme`·`themeOff`,
    `docs/timetables.md`)로 넘긴다: 테마 탭에서 바꾸고 앱을 내리면 바뀐다. 기간(`WidgetData.THEMES`)은 `app.js` 의 `THEMES`·`index.html` 머리 스크립트와 같고(시험이 견준다)
    위젯이 그릴 때의 기기 날짜로 정한다: 다음 날 0시에 다시 그리므로 앱을 열지 않아도 12월 1일 0시에 크리스마스가 되고 1월 1일 0시에 돌아온다. `ttw.devTheme`(웹 개발자 메뉴)는 보지 않는다.
  - 위젯 고르는 화면의 미리 보기(`widget_*_preview.xml`)는 앱 테마를 모르니 기기 라이트·다크 그대로다(머리 띠·블록은 지금 모양).
  - 글꼴은 기기 기본(Pretendard 를 넣지 않았다), 크기는 sp 라 기기 글자 크기를 따른다(격자 그림은 1.3배에서 멈춘다).
- **누르면**: `MainActivity` 에 `https://archi142857.github.io/tt-wizard/#tab=mine&sem=<학기>` 를 넘기고 `native.js` 의 `launchUrl`·`ttw:open-url` 로 화면에 간다
  (화면이 `#tab=mine` 을 읽어 내 시간표로, `sem` 이 있으면 그 학기로. 프론트엔드가 0e822ff 에 넣었다). 다음 수업·오늘 수업은 뒤에 `&route=<요일>`(월 0 … 일 6)을
  붙인다(update70, 사용자: "동선탐색에서 해당하는 요일의 지도 화면으로 바로 연결되면 좋을 듯"): 다음 수업은 그 수업의 요일, 오늘 수업은 오늘(수업이 없는 날은 다음 수업 날).
  동선 지도 위젯은 그 지도의 요일. 주간 시간표는 `route` 없이(내 시간표).
  수업을 누르면(update77, 사용자 11/2: "위젯은 강의를 눌렀을 때 그 강의 정보가 뜨도록, 시간표에 저장해놓은 강의 정보가 뜨도록") 그 수업의 항목 시트:
  `…#tab=mine&sem=<학기>&tt=<대표 시간표 id>&item=<항목 열쇠>`(`WidgetData.itemUrl`, 열쇠는 `T.itemKey`: `교과목번호-강좌번호`, 직접 넣은 일정은 그 id). 누르는 곳은
  다음 수업의 수업 줄(과목명·시각·강의실, `w_lecture`. 블록과 나머지는 그 요일 동선 지도), 오늘 수업의 행(행 밖은 동선 지도), 주간 시간표의 칸(안드로이드 12 이상:
  격자 그림 위에 투명한 누르는 칸 `widget_week_hit` 을 그림과 같은 셈 `WidgetData.WeekGrid` 로 dp 자리에 놓는다. 12 아래는 격자 전체가 내 시간표). 동선 지도 위젯은 그대로(지도).
  누르는 곳(`w_lecture`·`r_root`·`w_hit`)은 눌린 동안 기기 기본 물결이다(`?android:attr/selectableItemBackground`, update78 디자인 106판: 한 위젯에 누르는 곳이 여럿이라 어디가 눌렸는지 보이게).
  화면(`app.js` `navOf` 의 `tt`·`item` → `goNav` → `itemNav`): 그 학기 편람을 받는 중이면 5초까지 기다려(다른 분반·편람 바뀜이 보이게) 내 시간표에 그 시간표(없으면 대표)를
  띄우고 `openItem` 으로 항목 시트(넣은 분반, 바꾼 시간·장소. 직접 넣은 일정은 일정 시트). 시간표에 그 항목이 없으면(위젯 자료가 옛것) 내 시간표. 위젯 자료에 시간표 `id`·수업 `k` 를 더했다
  (옛 자료는 열쇠가 없어 전처럼 지도·내 시간표).
  화면(`web/js/app.js`, update72. 사용자: "위젯 눌렀을 때 딱 지도 화면이 떴으면 좋겠다니깐?"): `navOf` 가 `route` 를 읽고 `goNav` → `routeDay` 가
  그 학기 편람을 받은 뒤 대표 시간표를 '동선 확인하기'(`routeTt`)처럼 동선 탐색으로 보내고, 결과가 뜨면 그 요일을 골라 전체 화면 지도(`go("map")`)를 연다.
  어느 탭에 있었든 내 시간표를 거치고(`goMine`), 가는 동안 화면은 밀지 않고 바로 바꾼다(`snapUntil`: 내 시간표 → 탐색 → 결과 → 지도가 0.3초 안팎, 초점도
  옮기지 않는다). 뒤로 가면 결과 화면 → 입력 화면. 탐색에 다른 과목을 담아 두었으면 '담은 과목을 이 시간표로 바꿨어요 · 되돌리기'를 지도에서 결과 화면으로
  돌아왔을 때 띄운다(전체 화면 지도가 스낵바를 덮는다). 그날 걷는 수업이 없으면 결과 화면의 그 요일까지, 대표 시간표가 없거나 편람에 그 분반이 없으면
  내 시간표. 켤 때 같은 주소가 `launchUrl`·`ttw:open-url` 로 두 번 와도 3초 안의 같은 주소는 한 번만 연다(`lastNav`). 웹에서 같은 주소를 열어도 같다.
- **빈 상태**(update70, 사용자: "대표 시간표가 없을 때 위젯이 너무 날 것 느낌"): 머리 띠 아래 남는 자리 가운데에 시간표 아이콘(아래 탭 '시간표'와 같은 모양, text3),
  지금 상태 한 문장(글은 그대로), 그 아래 한 줄: 오늘 수업이 없는 날은 `다음 · 월요일 09:00 과목명`, 대표 시간표가 없거나 비었으면 `내 시간표 열기`(accent 굵게.
  위젯 전체가 앱을 연다). 자료가 아직 없을 때(`앱을 열면 대표 시간표가 보여요`)는 문장이 할 일을 말해서 둘 다 없다. 레이아웃은 `widget_empty.xml`(위젯 넷이 `include`,
  동선 지도는 아이콘을 아래 탭 '동선 탐색' 모양으로 바꾼다).
- **동선 지도 그리기**(update71, `RouteMap.java`·`DayMapBitmap.java`): 앱 화면의 요일 동선 지도(`app.js` 의 `renderMap`·`drawBasemap`)를 위젯 크기로 옮겼다.
  자료는 앱에 넣은 `data/basemap.json`·`routes.json`·`campus.json`(앱 묶음 `public/data/`)을 한 번 읽어 둔다(앱이 켤 때 새로 받는 자료는 화면만 쓴다).
  구간은 `engine.evaluate` 와 같은 차례(출발 지점 → 위치 확정 수업들 → 출발 지점, 강의실 미정 수업은 자리를 옮기지 않고 번호만 센다: `WidgetData.legs`),
  길은 `routes.json` 의 건물 사이 길(한쪽 방향만 있으면 거꾸로, 없으면 곧게). 바탕은 `drawBasemap` 과 같은 차례·색이고 보행로 점선·계단은 뺀다(등고선은 update88 에서 그리는 코드까지 뺐다).
  그날 경로 전체가 들어오게 맞추고(배율 17 까지, 길 없이 핀 하나면 16) 핀이 잘리지 않게 가장자리 18·아래 26(출처 글)을 비운다. 색은 웹 토큰 값(시험이 견준다),
  라이트·다크 두 장을 늘 넣고 `layout(-night)/widget_map.xml` 이 한 장을 보인다(주간 격자와 같다). 위젯 자료에 건물 id(`b`)·출발 지점(`home`)·돌아가는 분(`back`)을 더했다
  (`docs/timetables.md` '홈 화면 위젯'). 지도 자료 조건은 앱 화면과 같다: 수치지형도에서 온 바탕이 들어가니 바탕 지도를 정하는 일(`법무_검토.md` 2절)을 따른다.
  update73(디자인 93판 요청 셋): ① 머리에서 일주일 안의 요일 이름 뒤에는 날짜의 (요일)을 붙이지 않는다(`월요일 · 11월 2일`. `오늘`·`내일`·일주일 넘는 날·`개강`은 그대로)
  ② 길은 건물 문 앞에서 끝나고 핀은 건물 자리라, 그린 선의 양 끝에서 핀 가운데까지 그 선 색 둥근 점으로 잇는다(`app.js` 의 `dayStubs`·`drawStubs`: 수업 가는 길 4·간격 7,
  돌아가는 길 3·간격 6, 점마다 card 1 테두리를 맨 아래 층에. 선 끝이 핀에서 2 안이면 긋지 않고, 한 핀(묶인 핀이면 그 묶음)에 닿는 선 끝이 서로 10 안이면 수업 가는 길 먼저 하나만.
  `RouteMap.Plan.stubs`) ③ 돌아가는 길은 진행 방향 오른쪽으로 7 비켜(`RouteMap.offset` = `app.js offsetPoints`) 수업 가는 길 아래 층에, 테두리도 앱처럼 같은 파선이다
  (전에는 비키지 않고 테두리가 실선이었다). 값은 CSS px 이고 그림에서는 × dp.
- **다음 수업의 자리**(update70, update77 출발 시각 블록): 높이가 모자라면 과목명 두 줄 → 한 줄 → 강의실 줄 → 블록 안 아래 줄 → 시각 줄 차례로 빼고, 그래도 모자라면
  블록을 줄인다(시각 26, 블록 안 위아래 여백 5). 머리 줄·과목명 한 줄·블록은 늘. 기준(`WidgetData.nextRows`)은 위아래 여백 24 + 블록 위 띄움 8 + 블록 안 여백 16 에 줄 높이 ×
  기기 글자 크기(머리 16, 과목명 23씩, 시각·강의실 19씩, 큰 시각 38, 블록 안 아래 줄 19 + 사이 2): 글자 크기 1 에서 208·185·166·145dp, 126dp 아래가 작은 블록.
  블록 아래 끝은 늘 위젯 끝에서 좌우와 같은 12dp(사용자 11/2: "밑 부분 패딩도 좌우랑 동일하게"). 블록은 `accent-weak` 바탕·모서리 12(`widget_block`),
  큰 줄은 한 글에 크기를 나눠 넣는다(`WidgetViews.bigLine`: 수만 32, `출발`·`걷기`·`분` 같은 낱말은 `RelativeSizeSpan` 0.5). 후보 셋(ㄱ 옅은 블록 아래, ㄴ 옅은 블록 가운데,
  ㄷ 채운 블록)을 그림으로 보고 사용자가 ㄱ을 골랐다(공유 폴더 `위젯_시안\1102 출발 시각 블록 후보.png`). 디자인 89판의 130·116, update70 의 181·158·139·118 은 옛 값.
  머리 띠(update78)는 그전 위 여백 12 + 머리 줄 16 자리라 기준이 그대로다. 띠는 16 × 글자 크기 + 12(글자 크기 1 에서 28dp)로 둔다(update79, 디자인 108판):
  안드로이드 13 이상은 한글 띠 글이 대체 글꼴 줄 높이(19 안팎)로 잡혀 그대로면 띠가 31 이 되므로, 띠 글 한 줄을 기기 글꼴로 재어(`WidgetViews.lineDp`) 위아래 여백을
  (띠 − 줄)/2 로 줄인다(`WidgetData.bandPad`, 3 아래로는 안 줄인다. 글자 위아래로 보이는 틈은 8~9 로 그대로). 그래도 띠가 높아지면(아주 큰 글꼴) 그만큼만 기준을 올린다.
  오늘 수업 행 수, 주간 격자·동선 지도 그림 높이도 그 띠 높이로 센다. 띠 바로 아래가 과목명 줄(그 위 4)이다.
  update78(디자인 106판 '말줄임하지 않는다'): 큰 줄은 말줄임하지 않고 블록 안 폭(위젯 폭 − 24 − 16)에 맞춘다: 32(작은 블록 26)가 안 들면 26, 그래도 안 들면 0.5씩 줄여
  드는 크기(`WidgetData.heroSize`, 폭은 기기 글꼴로 잰다. 좁은 2×2·큰 글자 크기에서 `10:1…` 처럼 잘린 시각은 틀린 시각으로 읽혔다). 작은 블록은 높이에도 맞춘다(update79,
  디자인 108판): 블록 아래가 좌우와 같은 12 로 남는 데까지 26 에서 줄이고(띠·과목명 한 줄·띄움·블록 안 여백을 빼고 남는 높이, 기본 글꼴 굵게의 줄 높이로 나눈다) 폭으로 맞춘
  크기와 둘 중 작은 쪽이다(옛 런처 2×2 의 110dp 에서 블록 아래가 7~8 이던 것이 12). 낱말은 수의 반이되 12 아래로는 안 내린다(`wordScale`: 수가 24 아래면 낱말은 12). 블록 아래 줄이 넘치면 `25동에서` 를 빼고 `5분 지각` 만,
  그래도 넘치면 줄째 뺀다(`heroLine`). 오늘 수업 행의 아래 줄도 수가 든 덩이가 말줄임으로 잘리지 않게 `걷기 n분` → `10:18 출발` 차례로 덩이째 뺀다(`rowSub`, 강의실은 남기고
  넘치면 끝이 줄어든다).
- **글과 자리**(디자인 89판 '홈 화면 위젯', update69): 여러 줄이 되는 글(다음 수업 과목명·출발 줄, 빈 상태 글)은 안드로이드 13 이상에서
  `lineBreakWordStyle="phrase"`(`widget_styles.xml` 의 `TTWWidget`), 격자 그림은 `LineBreakConfig` phrase 로 낱말(어절) 가운데서 끊지 않는다.
  과목명 끝 번호(`대학 글쓰기 1` 의 `1`)는 앱 화면처럼 앞 낱말과 한 줄에 들어가면 U+00A0 으로 붙인다(`WidgetData.glueTail`, `app.js` 의 `glueTail` 과 같은 규칙).
  다음 수업 위젯이 낮으면 줄을 뺀다(update69 는 130·116dp, update70 의 큰 출발 줄 뒤로는 아래 '다음 수업의 자리').
  `지금` 태그는 12sp(타입 표의 가장 작은 글), 끝난 수업 행은 글과 막대 모두 흐리게(막대 40%). 굵기는 bold 그대로(`sans-serif-medium` 은 안드로이드 11 아래에서 한글이 보통 굵기로 나올 수 있다).
- **다시 그릴 때 처음 모양부터**(update69): 런처는 같은 레이아웃이면 전에 펼친 화면을 버리지 않고 새 `RemoteViews` 의 바꿈만 다시 얹는다(`AppWidgetHostView` 의 재사용).
  그래서 `WidgetViews` 는 그릴 때마다 바뀔 수 있는 보이기를 먼저 레이아웃의 처음 모양으로 되돌린다(`NEXT_SHOWN`·`NEXT_HIDDEN` 등, 시험이 XML 과 견준다).
  update66~68 은 이걸 안 해서 `앱을 열면 대표 시간표가 보여요` 가 뜬 위젯은 자료가 들어온 뒤에도 그 글이 남을 수 있었다(위젯을 지우고 다시 놓으면 보였다).
- **위젯 고르는 화면**: 이름·설명은 `strings.xml`, 안드로이드 12 이상은 미리 보기 레이아웃(`widget_*_preview.xml`, 지어낸 보기), 그 아래는 앱 아이콘.
  동선 지도 미리 보기 그림(`widget_map_preview_art`)은 update79 부터 Play 그래픽 이미지와 같은 길(집 → 1 → 2, 기둥과 왼팔 끝 5, 가로대 둘 끝 4·3. 사용자 11/2 "그 지도 위젯
  미리보기 화면도 '샤' 모양으로 만들어 줘", 디자인 108판이 그린 벡터)이다. 지어낸 지도에 경로 선과 핀으로만, 그림은 스크린리더에 읽히지 않고 글·파일 이름에서 학교의 장소
  이름으로 부르지 않는다. 광고·유료 테마 전에는 바꾸거나 허락을 받는다(법무 10/22 조건): 그때 쓸 지어낸 길 판(update71 그림)을 `widget_map_preview_art_plain` 으로 남겨 두었다.
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
  0.10.0(11/3, update87): 동선 지도 위젯, 위젯이 앱 테마를 따름·위젯에서 강의 정보, 의견 보내기, 공유 카드의 바로 보내기(카카오톡·인스타그램·문자),
  등고선을 빼고 확대하면 건물 이름, 서명한 출시 AAB(release 워크플로). 태그 `v0.10.0-alpha` 는 사용자가 판 숫자를 올리기 전 커밋 f720637(update86)에
  먼저 붙여 그 커밋의 판 숫자는 0.9.0 이다(`v0.8.0-alpha` 처럼 그대로 둔다). Play 내부 테스트 102 가 0.10.0 이다(11/4).
  0.10.1(11/4, update90): 앱도 받은 시간표 링크를 '공유받은 시간표' 시트로 보여 주고 누를 때만 넣기(ui103b), 카톡 인앱 브라우저에서 시간표 링크를 밖으로 다시 열기
  (ui102a, 웹), 오픈소스 라이선스의 Leaflet 전문(update92·프론트엔드). Play 에 새로 올릴 판이라 숫자만 올렸다(작은 판이라 태그는 붙여도 되고 안 붙여도 된다).
- 안드로이드 `versionCode` 는 release 워크플로가 실행 번호 + 100 으로 넣는다(손으로 올리지 않는다, update86). iOS `CURRENT_PROJECT_VERSION` 은 iOS 를 낼 때 올릴 때마다 1씩.

## 아직 안 한 것 (출시 전에)

1. 서명: 안드로이드는 update86 의 release 워크플로(위 '출시 빌드 (서명한 AAB)'). 업로드 키와 저장소 비밀값 넷은 사용자가 11/3 에 넣었다.
   11/4 내부 테스트에 올렸다(위 '출시 빌드'의 '올린 기록'). 남은 것: 비공개 테스트(신용범 님 허락 뒤, 배포 국가 대한민국만), Play 자동 보호(법무 답).
   iOS 는 Apple 개발자 계정의 인증서·프로비저닝(또는 Mac 의 Xcode 자동 서명).
2. 앱에서만 되는 쓸모(심사 4.2·Play 최소 기능): 시간표 저장(10/22)과 시간표 이미지 저장·보내기(10/23, 10/30 iOS·모든 안드로이드), 시간표 링크로 앱 열기,
   안드로이드 홈 화면 위젯 셋(10/30)이 들어갔다. iOS 위젯은 iOS 를 낼 때.
   링크로 앱이 바로 열리게 하는 확인 파일은 11/4 사용자 사이트 저장소에 올렸다(위 '시간표 링크로 앱 열기').
   더 넣는다면 캘린더 내보내기, 위젯, 수강편람 알림(`앱_확장_계획.md`, 위 '앞으로 기능을 만들 때').
3. 개인정보 처리방침과 문의 페이지(update74, 11/1): 문서·법무가 쓴 문안(공유 폴더 `개인정보_처리방침.md` 2·3절)을 `docs/legal/privacy.md`·`support.md` 로 옮기고
   `scripts/legal_pages.py` 가 `web/privacy/index.html`(https://archi142857.github.io/tt-wizard/privacy/)·`web/support/index.html`(…/support/)로 만든다
   (처음 시행일 2026년 11월 1일, 의견 보내기 줄은 앱에 들어가서(프론트엔드 e9a70a9) update76 에서 `FEEDBACK_IN_APP` 를 켰다, 앱 묶음에는 넣지 않는다. 시험 `tests/test_legal_pages.py`).
   **바꿀 때**(update81, 11/3 법무·문서가 비공개 테스트 신청·오픈채팅방·테스트 의견을 더한 판): 17절 '바꾸면 시행일 7일 전에 이 페이지에 알려요 … 이전 판도 볼 수 있게 둬요'
   (사용자 11/1). 그래서 올리는 날 + 7일을 `REVISED`(지금 2026년 11월 10일)로 두고 맨 위 시행일과 17절 기록에 쓰며(원문의 `【이 판 시행일】`), 지난 판은 풀어 둔 채로
   `docs/legal/privacy-2026-11-01.md` → `web/privacy/2026-11-01/` 에 남긴다(17절 '처음 시행' 줄에서 링크). 다시 바꾸면 그 판을 새 이전 판으로 남기고 `REVISED`·`PAGES` 를 고친다.
   `【앱에 들어간 뒤에 넣음】` 은 기능마다 따로 켠다(`LATER_FEATURES`: 의견 보내기 `FEEDBACK_IN_APP`, 공유 화면의 앱 단추 `SHARE_APPS_IN_APP`).
   공유 카드는 프론트엔드 ui100a(eab3a92, 11/3 15:35)로 앱에 들어가서 update83 에서 켰다: 11/3 에 올린 11/10 시행 판에 같이 넣어 7일 전 알림을 지키고,
   17절 바뀐 줄에도 적었다. **11/4(update91)**: 테스트 방이 오픈채팅에서 카카오톡 팀채팅으로 바뀌어(사용자 11/4) 법무가 1·2·3·4·5·9·12·17절을 고쳤다
   (카카오톡 프로필 이름·사진이 보이고 친구 추가가 될 수 있음, 이틀 안의 글만 가릴 수 있음, 방을 닫으면 대화·사진·파일이 지워짐). 11/10 판이 시행되기 전에 고쳐서
   `REVISED` 를 올린 날 + 7일(2026년 11월 11일)로 미뤘고, 그때까지는 11/1 판이 시행 중이다(이전 판은 그대로 11/1 판 하나). 처리방침을 또 바꾸면 그때는 새 시행일·이전 판(11/11 판)을 남긴다.
   다음에 바꿀 것: 베타 테스터 닉네임(법무 11/4, 문서가 문안), 닉네임 설문을 열기 7일 전에 올린다.
   모양은 디자인 규칙 '처리방침·문의 웹 페이지'(update78 에 11/2 디자인 요청대로: 머리는 앱 상단 바와 같은 워드마크 그림(다크는 `wordmark-dark`), 제목 20/28·절 제목 17/24 `heading`,
   본문 16/24, 카드 모서리 20, 폰 좌우 여백 20).
   앱의 `PRIVACY_URL` 은 프론트엔드가 넣는다. Play 처리방침 칸과 App Store 처리방침·지원 주소에 이 둘을 적는다.
   보호책임자·문의는 정보 탭 개발자 정보와 같은 이름·메일이다(사용자·법무 10/23).
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
   (늦어도 10분쯤) 다음 수업이 바뀐다. 오늘 수업을 4×4 로 늘리면 행이 늘고, 기기 테마를 바꾸면 위젯 색이 따라간다(주간 격자 그림도). 주간 시간표를 누르면 앱의 내 시간표가 열린다.
   대표 시간표·출발 지점을 바꾸고 앱을 내리면 위젯이 바뀐다. 위젯을 먼저 놓아 `앱을 열면 대표 시간표가 보여요` 가 뜬 뒤에 앱을 열었다 내려도
   (지우고 다시 놓지 않아도) 수업이 보여야 한다(update69). 다음 수업 위젯의 큰 출발 줄(update70)이 크기를 줄여도 남는지, 빈 상태가 가운데에 모이는지,
   위젯을 누르면(update72) 그 요일 동선 지도가 바로 뜨는지(앱을 끈 채로 눌러도, 켜 둔 채 다른 탭에 있다가 눌러도), 뒤로 가면 추천 시간표인지.
   update77: 다음 수업 위젯의 출발 시각 블록(가운데 큰 시각, 블록 아래 여백이 좌우와 같은지, 2×2 를 낮게 줄였을 때), `5분 지각`, 수업을 누르면 그 항목 시트가 뜨는지
   (다음 수업의 과목명 줄·오늘 수업의 행·주간 시간표의 칸. 앱을 끈 채로·켜 둔 채로, 대표가 아닌 시간표를 보고 있을 때. 주간 칸은 안드로이드 12 이상). 동선 지도 위젯(update71): 그날 길·번호 핀·집 핀·파선이 앱의 동선 지도와 같은지,
   4×4 로 늘리면 지도도 커지는지, 기기 다크에서 지도가 다크인지, 수업이 끝난 저녁에는 다음 수업 날 지도로 넘어가는지, 오른쪽 아래 출처가 보이는지.
   update78: 위젯 넷 맨 위의 머리 띠(위 모서리가 위젯 모서리와 맞는지), 테마 탭에서 라이트·다크를 고르고 앱을 내리면 위젯이 그 한 벌이 되는지(기기 다크 모드와 반대로 골라서),
   기본으로 돌리면 다시 기기를 따르는지, 기기 날짜를 12월로 옮기고 다음 날 0시(또는 앱을 열었다 내리기) 뒤 크리스마스 한 벌(흰 카드·초록 띠, 격자의 짙은 칸은 흰 글자, 초록 길·핀)이 되는지,
   그 해 크리스마스를 끄면 고른 것으로 돌아오는지. 좁은 2×2·큰 글자 크기에서 큰 시각이 `…` 없이 줄어드는지, 수업 줄·행·칸을 누를 때 물결이 보이는지.
9. 공유 카드의 바로 보내기(update80, 프론트엔드가 카드를 넣은 뒤): 카카오톡·인스타·문자가 깔린 앱만 단추로 나오고 아이콘이 폰의 앱 아이콘과 같은지.
   카카오톡 → 친구·채팅 고르는 화면에 링크, 인스타 DM → 받는 사람 고르는 화면, 인스타 스토리 → 시간표 이미지가 든 스토리 편집 화면, 문자 → 글이 채워진 새 메시지가 바로 뜨는지
   (한 번 더 고르는 창이 뜨면 그 앱이 받는 화면 이름을 바꾼 것: 동작은 하지만 `SharePlugin.TARGETS` 의 낱말을 고친다). 카카오톡을 지운 뒤 카드를 다시 열면 단추가 없어지는지.

## 확인한 것 (10/1)

- 클라우드 세션은 안드로이드 SDK·Gradle·Maven 서버에 닿지 않아 네이티브 빌드는 Actions 에서만 한다.
- 앱 묶음을 가짜 Capacitor(안드로이드)로 브라우저에 띄워: 원격 자료 사용·저장, 실패 시 저장본, 저장본이 없으면 스냅샷,
  3초 넘게 늦으면 스냅샷으로 먼저 열고 늦은 응답은 다음에 사용, 뒤로 가기(시트 닫기 → 이전 화면 → 앱 내리기), 내장 글꼴(CDN 요청 없음).
  같은 것을 `tests/native_runner.mjs`(node)가 확인한다.
- 10/4: 화면 코드와 `native.js` 를 가짜 안드로이드 Capacitor 로 함께 띄워, 기본 테마에서는 기기 테마를 바꿀 때마다 `SystemBars.setStyle("DEFAULT")` 가 가고
  크리스마스 테마에서는 처음 `DARK` 한 번뿐인 것을 봤다. 플러그인 쪽 동작은 `@capacitor/android`·`@capacitor/ios` 8.5.2 소스로 읽었다
  (`Capacitor.Plugins.SystemBars` 는 번들러 없이도 네이티브가 만들어 준다).
