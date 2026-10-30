"""스토어 앱(Capacitor, app/): 웹 화면 묶기(scripts/build_app.py), 앱 연결 스크립트(app/src/native.js), 네이티브 프로젝트 설정.
안드로이드·iOS 빌드 자체는 GitHub Actions(app.yml)가 한다. node 가 없으면 연결 스크립트 확인은 건너뛴다."""

import json
import plistlib
import re
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
import build_app  # noqa: E402

APP = ROOT / "app"
RES = APP / "android" / "app" / "src" / "main" / "res"
IOS = APP / "ios" / "App"


def fake_web(tmp_path: Path) -> Path:
    """진짜 화면 파일 + 가짜 자료, 그리고 빠져야 할 것들(sw.js, model/, field/, vendor/three/, js/package.json, js/dev.js)."""
    web = tmp_path / "web"
    web.mkdir()
    for name in ("index.html", "style.css", "sw.js", "manifest.webmanifest"):
        shutil.copy2(ROOT / "web" / name, web / name)
    shutil.copytree(ROOT / "web" / "js", web / "js")
    shutil.copytree(ROOT / "web" / "icons", web / "icons")
    shutil.copytree(ROOT / "web" / "vendor" / "leaflet", web / "vendor" / "leaflet")
    shutil.copytree(ROOT / "web" / "licenses", web / "licenses")
    for extra in ("model/index.html", "field/index.html", "vendor/three/three.min.js"):
        (web / extra).parent.mkdir(parents=True, exist_ok=True)
        (web / extra).write_text("x", encoding="utf-8")
    (web / "data" / "semesters").mkdir(parents=True)
    for name in ("campus.json", "courses.json", "routes.json", "semesters.json", "semesters/2025-1.json"):
        (web / "data" / name).write_text("{}", encoding="utf-8")
    return web


def test_build_app_bundle(tmp_path, monkeypatch):
    web = fake_web(tmp_path)
    font = tmp_path / "pretendard"
    sub = font / "dist" / "web" / "variable"
    (sub / "woff2-dynamic-subset").mkdir(parents=True)
    (sub / build_app.FONT_CSS).write_text("@font-face{}", encoding="utf-8")
    (sub / "woff2-dynamic-subset" / "PretendardVariable.subset.0.woff2").write_bytes(b"w")
    (font / "dist" / "LICENSE.txt").write_text("SIL Open Font License", encoding="utf-8")
    monkeypatch.setattr(build_app, "FONT", font)
    out = tmp_path / "www"
    info = build_app.build(web=web, out=out, remote="https://example.org/tt", tag="T1")

    files = {p.relative_to(out).as_posix() for p in out.rglob("*") if p.is_file()}
    assert {"index.html", "js/app.js", "js/engine.js", "js/search-worker.js", "js/search.js", "js/timetables.js", "js/native.js", "data/courses.json",
            "data/semesters/2025-1.json", "vendor/leaflet/leaflet.js", "vendor/pretendard/LICENSE.txt",
            "vendor/pretendard/woff2-dynamic-subset/PretendardVariable.subset.0.woff2", "app-build.json",
            "licenses/capacitor.txt", "licenses/androidx.txt", "licenses/cordova.txt", "licenses/snutt.txt", "licenses/pretendard.txt",
            "licenses/fredoka.txt", "licenses/odbl.txt", "licenses/kogl-type1.txt"} <= files
    assert not [f for f in files if f == "sw.js" or f.startswith(("model/", "field/", "vendor/three/")) or f.endswith("package.json")]
    assert (web / "js" / "dev.js").exists() and "js/dev.js" not in files  # 웹에만 둔 개발자 메뉴는 앱 묶음에 넣지 않는다(법무 10/24)
    html = (out / "index.html").read_text(encoding="utf-8")
    assert "cdn.jsdelivr.net" not in html and 'href="vendor/pretendard/' in html
    assert html.index('<script src="js/native.js"></script>') < html.index("</head>") < html.index('src="js/app.js"')
    native = (out / "js" / "native.js").read_text(encoding="utf-8")
    assert 'var BUILD = "T1"' in native and 'var REMOTE = "https://example.org/tt/"' in native and "__" not in native.split("var BUILD")[1][:40]
    assert info["font"] == "앱에 넣음" and info["files"] == len(files) - 1  # app-build.json 은 센 뒤에 쓴다
    assert json.loads((out / "app-build.json").read_text(encoding="utf-8"))["build"] == "T1"

    # npm ci 전(글꼴 없음): CDN 그대로, 나머지는 같다
    monkeypatch.setattr(build_app, "FONT", tmp_path / "none")
    info = build_app.build(web=web, out=out, tag="T2")
    assert info["font"] == "CDN" and "cdn.jsdelivr.net" in (out / "index.html").read_text(encoding="utf-8")

    # 앱에만 넣는 고지문(licenses/)이 web/licenses/ 의 것과 이름이 겹치면 덮어쓰지 않고 멈춘다
    (web / "licenses" / "capacitor.txt").write_text("x", encoding="utf-8")
    with pytest.raises(SystemExit):
        build_app.build(web=web, out=out, tag="T3")


def test_license_notices_match_app():
    """앱에 넣는 고지문(licenses/)이 지금 쓰는 판과 맞고 전문이 들어 있다. 판을 올리면 고지문의 숫자도 고친다."""
    lic = ROOT / "licenses"
    pkg = json.loads((APP / "package.json").read_text(encoding="utf-8"))["dependencies"]
    cap = (lic / "capacitor.txt").read_text(encoding="utf-8")
    assert f"@capacitor/core, @capacitor/android, @capacitor/ios {pkg['@capacitor/core']}" in cap
    assert pkg["@capacitor/core"] == pkg["@capacitor/android"] == pkg["@capacitor/ios"]
    for name in ("app", "browser", "haptics"):
        assert f"@capacitor/{name} {pkg['@capacitor/' + name]}" in cap
    assert "Copyright (c) 2017-present Drifty Co." in cap and "Copyright 2020-present Ionic" in cap and cap.count("MIT License") >= 3
    gradle = dict(re.findall(r"(\w+) = '([^']+)'", (APP / "android" / "variables.gradle").read_text(encoding="utf-8")))
    ax = (lic / "androidx.txt").read_text(encoding="utf-8")
    for key, art in (("androidxAppCompatVersion", "appcompat:appcompat"), ("androidxCoreVersion", "core:core"),
                     ("androidxActivityVersion", "activity:activity"), ("androidxFragmentVersion", "fragment:fragment"),
                     ("androidxCoordinatorLayoutVersion", "coordinatorlayout:coordinatorlayout"),
                     ("androidxWebkitVersion", "webkit:webkit"), ("coreSplashScreenVersion", "core:core-splashscreen")):
        assert f"androidx.{art} {gradle[key]}" in ax, key
    cordova = (lic / "cordova.txt").read_text(encoding="utf-8")
    assert f"cordova-android {gradle['cordovaAndroidVersion']}" in cordova and "The Apache Software Foundation" in cordova
    apache = cordova[cordova.index("Apache License\n"):]  # 전문(파일 끝)
    assert "Version 2.0, January 2004" in apache and "END OF TERMS AND CONDITIONS" in apache
    # 화면은 줄마다 파일 하나를 연다: Apache-2.0 이 걸리는 세 파일 모두 전문을 품고, 따로 둔 파일을 가리키지 않는다
    assert apache in ax and apache in cap and "apache-2.0.txt" not in cap + ax + cordova
    # 웹에도 쓰는 고지문(web/licenses/): 웹은 그대로, 앱은 web/ 을 옮길 때 같은 licenses/ 로. 앱에만 넣는 것과 이름이 겹치지 않는다
    web_lic = ROOT / "web" / "licenses"
    assert {p.name for p in web_lic.glob("*.txt")} == {"snutt.txt", "pretendard.txt", "fredoka.txt", "odbl.txt", "kogl-type1.txt"}
    assert not {p.name for p in web_lic.glob("*.txt")} & {p.name for p in lic.glob("*.txt")}
    assert "Copyright (c) 2025 Wafflestudio" in (web_lic / "snutt.txt").read_text(encoding="utf-8")
    font = (web_lic / "pretendard.txt").read_text(encoding="utf-8")
    font_version = json.loads((APP / "package.json").read_text(encoding="utf-8"))["devDependencies"]["pretendard"]
    assert font.startswith(f"Pretendard {font_version} ") and f"pretendard@v{font_version}/" in (ROOT / "web" / "index.html").read_text(encoding="utf-8")
    assert "Copyright (c) 2021, Kil Hyung-jin" in font and "SIL OPEN FONT LICENSE Version 1.1" in font and font.rstrip().endswith("OTHER DEALINGS IN THE FONT SOFTWARE.")
    # 로고 글꼴(google/fonts ofl/fredoka/OFL.txt 그대로), 지도 자료의 두 조건(ODbL 1.0 원문, 공공누리 제1유형 출처 표시와 조건 요약·원문 링크)
    fredoka = (web_lic / "fredoka.txt").read_text(encoding="utf-8")
    assert "Copyright 2016 The Fredoka Project Authors" in fredoka and fredoka.rstrip().endswith("OTHER DEALINGS IN THE FONT SOFTWARE.")
    odbl = (web_lic / "odbl.txt").read_text(encoding="utf-8")
    assert "© OpenStreetMap contributors" in odbl and "Open Data Commons Open Database License (ODbL)" in odbl
    assert "4.3 Notice for using output (Contents)" in odbl and odbl.rstrip().endswith("in order to meet the\nterms of this License.")  # 원문 끝까지
    kogl = (web_lic / "kogl-type1.txt").read_text(encoding="utf-8")
    assert "공공누리 제1유형으로 개방한 '수치지형도" in kogl and "https://map.ngii.go.kr" in kogl  # 공공누리가 권하는 출처 문장(법무 문안)
    assert "https://www.kogl.or.kr/info/licenseType1.do" in kogl and "/etc/clause.do" not in kogl  # clause.do 는 누리집 회원 약관이다
    # 바탕 지도 자료의 출처 표기(basemap.json src_layers)와 같은 두 조건이 고지문에도 있다
    srcs = " ".join(g["src"] for g in json.loads((ROOT / "data" / "basemap.json").read_text(encoding="utf-8"))["src_layers"])
    assert "ODbL" in srcs and "공공누리 제1유형" in srcs


def test_patch_index_stops_on_unknown_markup():
    with pytest.raises(SystemExit):
        build_app.patch_index("<html><head></head><body><script type=module src=\"js/app.js\"></script></body></html>", True)
    with pytest.raises(SystemExit):
        build_app.patch_index("<html><body>no head</body></html>", False)


@pytest.mark.skipif(shutil.which("node") is None, reason="node 없음")
def test_native_shim():
    run = subprocess.run(["node", str(ROOT / "tests" / "native_runner.mjs")], capture_output=True, text=True, timeout=60)
    assert run.returncode == 0, run.stderr
    r = json.loads(run.stdout)
    assert r["webUntouched"]
    n = r["network"]
    assert (n["source"], n["from"], n["url"]) == ("network", "remote", "https://remote.example/tt/data/campus.json")
    assert n["saved"] and n["savedBuild"] == "B1" and n["other"] == n["post"] == "bundle" and n["platform"] == "android"
    f = r["fallback"]
    assert f["saved"] == ["saved", "remote"] and f["bundled"] == [None, "bundle"]
    assert f["oldBuild"] == "bundle" and f["notFound"] == "bundle"  # 빌드가 다른 저장본, 404 HTML 은 쓰지 않는다
    assert r["offline"] == {"from": "bundle", "remoteCalls": 0}
    assert r["slow"]["first"] == "bundle" and r["slow"]["waitedMs"] == 3000 and '"late"' in r["slow"]["savedLate"]
    assert r["back"] == {"closed": True, "kept": True, "historyBack": 1, "minimized": 1}
    assert r["basemap"] == {"from": "bundle", "remoteCalls": 0}  # 바탕 지도는 앱에 넣은 것만
    # 안드로이드 상태 바 글자색: 기기 테마가 바뀌거나 앱으로 돌아오면 DEFAULT 를 다시 요청, 이벤트 테마 중에는 그대로, iOS·플러그인 없음은 듣지 않는다
    assert r["bars"] == {"listening": [1, 1], "start": 0, "afterChange": ["DEFAULT"], "withTheme": 1,
                         "afterThemeOff": ["DEFAULT", "DEFAULT"], "ios": 0, "noPlugin": 0, "threw": False}
    # 기기 브라우저로 여는 링크: 에브리타임(하위 주소 포함)과 data-browser="system" 링크만, 화면의 처리보다 먼저(capture) 전파를 끊고 기본 동작은 둔다
    assert r["links"] == {"capture": [True], "everytime": ["system", "system"], "subdomain": "system", "marked": "system",
                          "others": ["app"] * 6, "notLink": ["app", "app"], "web": 0}
    # 시간표 이미지: 바이트를 base64 로 앱 안 플러그인(TTWImage)에 넘긴다. 플러그인이 없으면(iOS·옛 앱) UNSUPPORTED → 화면은 웹과 같은 길
    i = r["image"]
    assert i["calls"] == [["share", "iVBORwD/", "시간표 1", "시간표 보내기"], ["save", "AQID", "a.png", ""]] and i["big"]
    assert i["saved"] == {"uri": "content://media/1"} and i["unsupported"] == "UNSUPPORTED" and i["bad"] == "no image data" and i["count"] == 3
    # 메뉴에 '이미지로 저장' 줄을 둘지(디자인 10/23): 켤 때 한 번 묻고 답이 오면 canSaveImage·canShareImage 가 바뀐다
    n = r["imageInfo"]
    assert n["before"] == [False, False] and n["info"] == {"save": True, "share": True} and n["after"] == [True, True]
    assert n["ios"] == [{"save": True, "share": True}, True]  # iOS 도 사진에 저장한다(10/30)
    assert n["old"] == [{"save": False, "share": True}, False, True] and n["none"] == [{"save": False, "share": False}, False]
    # 저장 거절 code 는 플러그인 그대로(DENIED → 화면 '사진 접근이 꺼져 있어요' [설정]), 메서드가 없는 옛 플러그인은 UNSUPPORTED(화면은 공유로)
    assert r["saveCodes"] == ["DENIED", "FAILED", "UNSUPPORTED", "ok"]
    # 시간표 링크로 앱 열기: 켤 때 연 주소(launchUrl, 없거나 못 물으면 null)와 켜 둔 동안 연 주소('ttw:open-url'). 빈 주소는 보내지 않는다
    link = "https://archi142857.github.io/tt-wizard/#t=jWzEsIjIwMjYtMiJd"
    assert r["launch"] == {"launched": [link, None, None], "opened": [link + "x"], "ios": [link], "web": True}
    # 링크 공유·앱 설정(TTWShell): 링크만 글 공유로, 플러그인이 없는 옛 앱에는 함수가 없고, 메서드가 없으면 UNSUPPORTED
    sh = r["shell"]
    assert sh["calls"] == [["shareText", "https://archi142857.github.io/tt-wizard/#t=jAA", "2026년 2학기 시간표 1"], ["openSettings", "", ""]]
    assert sh["notLink"] == "no link" and sh["none"] == ["undefined", "undefined"]
    assert (sh["old"], sh["oldSettings"], sh["failed"]) == ("UNSUPPORTED", "UNSUPPORTED", "FAILED")
    # 홈 화면 위젯(TTWWidget): 자료를 JSON 글로 넘기고 같은 자료는 다시 부르지 않는다. 못 넘기면 false(다음에 다시), iOS·옛 앱에는 함수가 없다
    w = r["widgets"]
    assert w["sent"] == [True, True, True] and w["calls"] == ["item", "cls"] and w["text"] == "string"
    assert w["cyclic"] is False and w["failed"] == [False, 1] and w["retry"] == [False, 2]
    assert w["info"] == [{"placed": 2}, None] and w["none"] == ["undefined", "undefined"]


def test_android_plugins_permissions_and_links():
    """앱 안 플러그인(TTWImage 이미지 공유·저장, TTWShell 링크 공유·설정)이 등록돼 있고, 권한은 인터넷과 안드로이드 9 이하의 사진 저장뿐이다.
    시간표 링크(웹 앱 첫 주소)는 App Links 로 앱이 연다."""
    java = APP / "android" / "app" / "src" / "main" / "java" / "com" / "ttwizard" / "app"
    plugin = (java / "ImagePlugin.java").read_text(encoding="utf-8")
    assert "name = \"TTWImage\"" in plugin and "public void share(PluginCall call)" in plugin and "public void save(PluginCall call)" in plugin
    assert "public void info(PluginCall call)" in plugin and 'ret.put("save", true)' in plugin
    # 저장: 10 이상 MediaStore(권한 없음), 9 이하는 저장소 권한을 물어서. 거절은 DENIED, 그 밖은 FAILED
    assert "Build.VERSION_CODES.Q" in plugin and "MediaStore" in plugin and "getExternalStoragePublicDirectory" in plugin
    assert "Manifest.permission.WRITE_EXTERNAL_STORAGE" in plugin and "@PermissionCallback" in plugin and '"DENIED"' in plugin and '"FAILED"' in plugin
    assert "getCacheDir()" in plugin and ".fileprovider" in plugin
    shell = (java / "ShellPlugin.java").read_text(encoding="utf-8")
    assert '@CapacitorPlugin(name = "TTWShell")' in shell and "public void shareText(PluginCall call)" in shell and "public void openSettings(PluginCall call)" in shell
    assert '"text/plain"' in shell and "Intent.EXTRA_TEXT" in shell and "Settings.ACTION_APPLICATION_DETAILS_SETTINGS" in shell
    main = (java / "MainActivity.java").read_text(encoding="utf-8")
    for name in ("ImagePlugin", "ShellPlugin"):
        assert main.index(f"registerPlugin({name}.class)") < main.index("super.onCreate(savedInstanceState)")
    manifest = (APP / "android" / "app" / "src" / "main" / "AndroidManifest.xml").read_text(encoding="utf-8")
    assert re.findall(r'<uses-permission android:name="([^"]+)"', manifest) == ["android.permission.INTERNET", "android.permission.WRITE_EXTERNAL_STORAGE"]
    assert '<uses-permission android:name="android.permission.WRITE_EXTERNAL_STORAGE" android:maxSdkVersion="28" />' in manifest
    paths = (APP / "android" / "app" / "src" / "main" / "res" / "xml" / "file_paths.xml").read_text(encoding="utf-8")
    assert '<cache-path name="my_cache_images" path="." />' in paths and 'android:authorities="${applicationId}.fileprovider"' in manifest
    # App Links: 웹 앱 첫 주소(path 하나)만. 같은 사이트의 다른 페이지(실측·고지문·처리방침)는 브라우저로 열려야 한다
    link = re.search(r'<intent-filter android:autoVerify="true">(.*?)</intent-filter>', manifest, re.S).group(1)
    assert 'android.intent.action.VIEW' in link and 'android.intent.category.BROWSABLE' in link and 'android.intent.category.DEFAULT' in link
    assert re.findall(r"<data ([^>]*)/>", link) == ['android:scheme="https" android:host="archi142857.github.io" android:path="/tt-wizard/" ']
    assert build_app.REMOTE == "https://archi142857.github.io/tt-wizard/"  # 화면이 만드는 링크의 주소(TTW_APP.remote)와 같은 곳


def test_native_projects_match_config():
    """앱 아이디·판·시작 화면 색·아이콘·개인정보 매니페스트가 서로 맞다(네이티브 파일을 손으로 고칠 때 깨지기 쉬운 것)."""
    config = json.loads((APP / "capacitor.config.json").read_text(encoding="utf-8"))
    app_id = config["appId"]
    gradle = (APP / "android" / "app" / "build.gradle").read_text(encoding="utf-8")
    pbx = (IOS / "App.xcodeproj" / "project.pbxproj").read_text(encoding="utf-8")
    assert f'applicationId "{app_id}"' in gradle and f'namespace = "{app_id}"' in gradle
    assert pbx.count(f"PRODUCT_BUNDLE_IDENTIFIER = {app_id};") == 2
    activity = APP / "android" / "app" / "src" / "main" / "java" / Path(*app_id.split(".")) / "MainActivity.java"
    assert activity.exists() and activity.read_text(encoding="utf-8").startswith(f"package {app_id};")

    web_version = re.search(r'const APP_VERSION = "([^"]+)"', (ROOT / "web" / "js" / "app.js").read_text(encoding="utf-8")).group(1)
    android_version = re.search(r'versionName "([^"]+)"', gradle).group(1)
    ios_versions = set(re.findall(r"MARKETING_VERSION = ([^;]+);", pbx))
    lock = json.loads((APP / "package-lock.json").read_text(encoding="utf-8"))
    npm_versions = {json.loads((APP / "package.json").read_text(encoding="utf-8"))["version"], lock["version"], lock["packages"][""]["version"]}
    assert android_version == web_version and ios_versions == {web_version} and npm_versions == {web_version}, (
        f"웹 APP_VERSION {web_version} 에 맞춰 app/android/app/build.gradle versionName, iOS MARKETING_VERSION, "
        "app/package.json·package-lock.json 의 version 을 올리세요")
    assert int(re.search(r"targetSdkVersion = (\d+)", (APP / "android" / "variables.gradle").read_text(encoding="utf-8")).group(1)) >= 36
    assert pbx.count("TARGETED_DEVICE_FAMILY = 1;") == 2  # 처음에는 iPhone 만 (디자인 규칙 '스토어 등록 자료')

    colors = {d: re.search(r"#[0-9A-Fa-f]{6}", (RES / d / "colors.xml").read_text(encoding="utf-8")).group(0).upper()
              for d in ("values", "values-night")}
    assert colors == {"values": "#EEF0FF", "values-night": "#16171B"}
    launch = json.loads((IOS / "App" / "Assets.xcassets" / "LaunchBackground.colorset" / "Contents.json").read_text(encoding="utf-8"))
    assert [c.get("appearances", [{}])[0].get("value", "any") for c in launch["colors"]] == ["any", "dark"]
    assert 'name="LaunchBackground"' in (IOS / "App" / "Base.lproj" / "LaunchScreen.storyboard").read_text(encoding="utf-8")

    for density in ("mdpi", "hdpi", "xhdpi", "xxhdpi", "xxxhdpi"):
        for name in ("ic_launcher", "ic_launcher_round", "ic_launcher_foreground", "ic_launcher_background", "ic_launcher_monochrome"):
            assert (RES / f"mipmap-{density}" / f"{name}.png").exists(), (density, name)
        for name in ("ic_launcher_foreground", "ic_launcher_background"):
            assert (RES / f"mipmap-night-{density}" / f"{name}.png").exists(), (density, name)
    assert "<monochrome" in (RES / "mipmap-anydpi-v26" / "ic_launcher.xml").read_text(encoding="utf-8")
    icon = json.loads((IOS / "App" / "Assets.xcassets" / "AppIcon.appiconset" / "Contents.json").read_text(encoding="utf-8"))
    assert [i.get("appearances", [{}])[0].get("value", "any") for i in icon["images"]] == ["any", "dark"]

    info = plistlib.loads((IOS / "App" / "Info.plist").read_bytes())
    assert info["ITSAppUsesNonExemptEncryption"] is False and info["CFBundleDevelopmentRegion"] == "ko"
    # 사진에 저장(TTWImage.save, 공유 시트의 '이미지 저장'): 목적 문구가 없으면 그 자리에서 앱이 꺼진다(디자인 79판 문구)
    assert info["NSPhotoLibraryAddUsageDescription"] == "시간표 이미지를 사진에 저장할 때 필요해요."
    # 시간표 링크로 앱 열기(Universal Links): 권한 파일이 앱 타깃 두 설정(Debug·Release)에 걸려 있다
    ent = plistlib.loads((IOS / "App" / "App.entitlements").read_bytes())
    assert ent == {"com.apple.developer.associated-domains": ["applinks:archi142857.github.io"]}
    assert pbx.count("CODE_SIGN_ENTITLEMENTS = App/App.entitlements;") == 2
    # 앱 안 플러그인(Swift): 컴파일 단계에 들고, 웹 화면이 뜨기 전에 등록하고, 이름이 안드로이드와 같다
    for name, js in (("ImagePlugin", "TTWImage"), ("ShellPlugin", "TTWShell")):
        assert pbx.count(f"{name}.swift in Sources") == 2, name  # 빌드 파일 + Sources 단계
        assert f'public let jsName = "{js}"' in (IOS / "App" / f"{name}.swift").read_text(encoding="utf-8")
    privacy = plistlib.loads((IOS / "App" / "PrivacyInfo.xcprivacy").read_bytes())
    assert privacy["NSPrivacyTracking"] is False and privacy["NSPrivacyCollectedDataTypes"] == []
    assert privacy["NSPrivacyAccessedAPITypes"][0]["NSPrivacyAccessedAPITypeReasons"] == ["CA92.1"]
    assert pbx.count("PrivacyInfo.xcprivacy in Resources") == 2  # 빌드 파일 + Resources 단계
    swift = (IOS / "App" / "SceneDelegate.swift").read_text(encoding="utf-8")
    assert "rootViewController = MainViewController()" in swift and "allowsBackForwardNavigationGestures = true" in swift
    assert "registerPluginInstance(ImagePlugin())" in swift and "registerPluginInstance(ShellPlugin())" in swift
    assert 'customClass="MainViewController"' in (IOS / "App" / "Base.lproj" / "Main.storyboard").read_text(encoding="utf-8")
