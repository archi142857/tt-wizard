// TT Wizard 앱(Capacitor) 연결 — 백엔드 세션.
// scripts/build_app.py 가 www/js/native.js 로 넣고, index.html <head> 에서 app.js(모듈)보다 먼저 부른다.
// 웹(브라우저·설치한 PWA)에서는 아무것도 하지 않는다. 화면 코드(web/js/app.js)는 그대로 두고 앱에서만 다른 것을 여기서 맞춘다.
//
// 1) 자료(data/*.json): 웹 서버(GitHub Pages)에서 새로 받는다(네이티브 HTTP, 없으면 fetch). 3초 안에 안 오거나 끊겼으면 지난번에 받아 둔 것,
//    그것도 없으면 앱에 넣은 것(빌드 때의 스냅샷)을 쓴다. 늦게 온 응답은 다음 실행을 위해 저장한다.
//    받아 둔 것은 앱 빌드(BUILD)마다 따로 둔다: 앱을 새로 내면 새 스냅샷이 옛 저장본보다 먼저다.
//    바탕 지도(data/basemap.json)는 크고 거의 안 바뀌어서 앱에 넣은 것만 쓴다(새 판은 앱 업데이트로 온다).
// 2) 안드로이드 뒤로 가기: 열린 시트(<dialog>)를 닫고(cancel 이벤트), 아니면 이전 화면, 첫 화면이면 앱을 내린다.
// 3) <html data-platform="android|ios">
// 4) 안드로이드 상태 바 글자색: 앱을 켜 둔 채 기기가 라이트·다크로 바뀌면 다시 맞춘다(아래 '상태 바 글자색').
// 5) 로그인해 둔 브라우저에서 열려야 하는 바깥 링크(에브리타임 강의평)는 앱 안 브라우저가 아니라 기기의 기본 브라우저로 보낸다(아래 '기기 브라우저로 여는 링크').
// 6) 시간표 이미지 공유·저장: TTW_APP.shareImage·saveImage(앱 안 플러그인 TTWImage. 아래 '시간표 이미지').
// 7) 시간표 링크로 앱 열기: TTW_APP.launchUrl·'ttw:open-url' 이벤트(아래 '앱으로 연 주소').
// 8) 링크 공유·앱 설정 열기: TTW_APP.shareLink·openSettings(앱 안 플러그인 TTWShell. 아래 '링크 공유·앱 설정').
// 9) 홈 화면 위젯(안드로이드): TTW_APP.updateWidgets(앱 안 플러그인 TTWWidget. 아래 '홈 화면 위젯').
(function () {
  "use strict";
  var cap = window.Capacitor;
  if (!cap || typeof cap.isNativePlatform !== "function" || !cap.isNativePlatform()) return;

  var BUILD = "__BUILD__"; // build_app.py 가 바꾼다
  var REMOTE = "__REMOTE__"; // 자료를 새로 받을 곳 (끝에 /)
  var WAIT_MS = 3000;
  var BUNDLED_ONLY = /^data\/basemap\.json$/; // 네트워크로 새로 받지 않는 자료
  var DB_NAME = "ttw-app";
  var STORE = "data";
  var platform = typeof cap.getPlatform === "function" ? cap.getPlatform() : "";
  var plugins = cap.Plugins || {};
  document.documentElement.setAttribute("data-platform", platform);

  var nativeFetch = window.fetch.bind(window);

  // ------------------------------------------------------------ 받아 둔 자료 (IndexedDB, 안 되면 저장 없이)

  var dbPromise = null;
  function db() {
    if (!dbPromise) {
      dbPromise = new Promise(function (resolve) {
        try {
          var req = indexedDB.open(DB_NAME, 1);
          req.onupgradeneeded = function () { req.result.createObjectStore(STORE); };
          req.onsuccess = function () { resolve(req.result); };
          req.onerror = function () { resolve(null); };
          req.onblocked = function () { resolve(null); };
        } catch (e) {
          resolve(null);
        }
      });
    }
    return dbPromise;
  }
  function get(path) {
    return db().then(function (d) {
      if (!d) return null;
      return new Promise(function (resolve) {
        try {
          var req = d.transaction(STORE, "readonly").objectStore(STORE).get(path);
          req.onsuccess = function () {
            var v = req.result;
            resolve(v && v.build === BUILD && typeof v.text === "string" ? v.text : null);
          };
          req.onerror = function () { resolve(null); };
        } catch (e) {
          resolve(null);
        }
      });
    });
  }
  function put(path, text) {
    return db().then(function (d) {
      if (!d) return;
      try {
        d.transaction(STORE, "readwrite").objectStore(STORE).put({ build: BUILD, time: Date.now(), text: text }, path);
      } catch (e) { /* 저장이 안 돼도 화면은 돈다 */ }
    });
  }

  // ------------------------------------------------------------ 자료 받기

  function isJson(text) {
    try { JSON.parse(text); return true; } catch (e) { return false; }
  }
  function respond(text, source) {
    return new Response(text, {
      status: 200,
      headers: { "Content-Type": "application/json; charset=utf-8", "X-TTW-Source": source },
    });
  }
  function dataPath(input) {
    var url;
    try { url = new URL(typeof input === "string" ? input : input.url, document.baseURI); } catch (e) { return null; }
    if (url.origin !== location.origin || !/^\/data\/[^/][^?#]*\.json$/.test(url.pathname)) return null;
    return { path: url.pathname.slice(1), search: url.search, local: url.href };
  }
  /** 웹 서버에서 글자 그대로 받기. 네이티브 HTTP(CapacitorHttp)는 웹뷰의 CORS 를 타지 않는다 */
  function remoteText(url) {
    var http = plugins.CapacitorHttp;
    if (http && typeof http.get === "function") {
      return http.get({ url: url, responseType: "text", headers: { "Cache-Control": "no-cache" } }).then(function (res) {
        if (!res || res.status < 200 || res.status >= 300) return null;
        return typeof res.data === "string" ? res.data : JSON.stringify(res.data);
      });
    }
    return nativeFetch(url, { cache: "no-cache", credentials: "omit" }).then(function (res) { return res.ok ? res.text() : null; });
  }
  function fromNetwork(d) {
    if (navigator.onLine === false) return Promise.resolve(null);
    return remoteText(REMOTE + d.path + d.search)
      .then(function (text) {
        if (text === null || !isJson(text)) return null;
        put(d.path, text);
        return text;
      })
      .catch(function () { return null; });
  }
  function fetchData(d, init) {
    var net = fromNetwork(d);
    var late = new Promise(function (resolve) { setTimeout(function () { resolve(undefined); }, WAIT_MS); });
    return Promise.race([net, late]).then(function (text) {
      if (typeof text === "string") return respond(text, "network");
      // 늦거나(undefined) 실패(null): 받아 둔 것 → 앱에 넣은 것. 늦은 응답은 fromNetwork 가 저장해 둔다
      return get(d.path).then(function (saved) {
        if (saved !== null) return respond(saved, "saved");
        return nativeFetch(d.local, init);
      });
    });
  }

  window.fetch = function (input, init) {
    var method = (init && init.method) || (input && typeof input === "object" && input.method) || "GET";
    var d = String(method).toUpperCase() === "GET" ? dataPath(input) : null;
    return d && !BUNDLED_ONLY.test(d.path) ? fetchData(d, init) : nativeFetch(input, init);
  };

  // ------------------------------------------------------------ 안드로이드 뒤로 가기

  var App = plugins.App;
  if (platform === "android" && App && typeof App.addListener === "function") {
    App.addListener("backButton", function (ev) {
      var open = document.querySelectorAll("dialog[open]");
      if (open.length) {
        var dialog = open[open.length - 1];
        var cancel = new Event("cancel", { cancelable: true });
        if (dialog.dispatchEvent(cancel)) dialog.close();
        return;
      }
      if (ev && ev.canGoBack) {
        history.back();
        return;
      }
      if (typeof App.minimizeApp === "function") App.minimizeApp();
      else if (typeof App.exitApp === "function") App.exitApp();
    });
  }

  // ------------------------------------------------------------ 상태 바 글자색 (안드로이드)

  // SystemBars 플러그인(Capacitor 8.5.2)은 'DEFAULT' 를 받은 순간의 기기 테마로 바꿔(LIGHT·DARK) 기억하고, 기기 설정이 바뀔 때는 그 기억한 값을
  // 다시 입힌다. 그래서 앱을 켜 둔 채 기기가 다크로 바뀌면 화면은 어두워지는데 시계·아이콘은 어두운 글자로 남는다(반대도 같다).
  // 기기 테마가 바뀔 때와 앱으로 돌아올 때 'DEFAULT' 를 다시 요청해 그때의 테마로 맞춘다. 이벤트 테마가 켜져 있으면(<html data-theme>)
  // 화면(app.js)이 정한 글자색이 기억돼 있으니 건드리지 않는다. iOS 는 기본값이 기기 테마를 스스로 따라가서 필요 없다.
  var bars = plugins.SystemBars;
  var scheme = typeof window.matchMedia === "function" ? window.matchMedia("(prefers-color-scheme: dark)") : null;
  if (platform === "android" && bars && typeof bars.setStyle === "function" && scheme) {
    var syncBars = function () {
      if (document.documentElement.hasAttribute("data-theme")) return;
      try {
        var done = bars.setStyle({ style: "DEFAULT" });
        if (done && typeof done.catch === "function") done.catch(function () {});
      } catch (e) {
        // 플러그인이 던지면 그대로 둔다
      }
    };
    if (typeof scheme.addEventListener === "function") scheme.addEventListener("change", syncBars);
    else if (typeof scheme.addListener === "function") scheme.addListener(syncBars);
    // 다른 앱에 가 있는 동안 바뀐 것은 돌아올 때 맞춘다(app.js 보다 먼저 듣는다: 그사이 이벤트 테마가 시작됐으면 app.js 가 이어서 제 글자색을 요청한다)
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "visible") syncBars();
    });
  }

  // ------------------------------------------------------------ 기기 브라우저로 여는 링크

  // 화면(app.js)은 바깥 링크(<a target="_blank">)를 앱 안 브라우저로 연다(Capacitor Browser: 안드로이드 Custom Tab, iOS 인앱 Safari).
  // 그런데 iOS 인앱 Safari 는 Safari 의 로그인을 이어받지 않아서, 로그인해야 보이는 곳(에브리타임 강의평)은 거기서 열면 다시 로그인해야 한다.
  // 그런 링크는 기기의 기본 브라우저로 보낸다(디자인 규칙 '강의평', '스토어 출시'의 링크 표). 처리방침·문의·출처 링크는 그대로 앱 안 브라우저다.
  //   대상: 주소의 호스트가 SYSTEM_HOSTS 이거나, 화면이 data-browser="system" 을 붙인 http(s) 링크.
  //   방법: 화면의 처리(문서의 click)보다 먼저(capture 단계) 전파만 끊고 기본 동작은 그대로 둔다. 웹뷰가 앱 밖 주소로 가려 하면 Capacitor 가
  //   기기에 넘긴다(안드로이드 Bridge.launchIntent 의 ACTION_VIEW, iOS WebViewDelegationHandler 의 UIApplication.open). 그 주소를 맡은 앱이
  //   기기에 있으면 그 앱이 열릴 수 있다.
  var SYSTEM_HOSTS = /(^|\.)everytime\.kr$/i;
  document.addEventListener("click", function (e) {
    var el = e.target;
    var a = el && typeof el.closest === "function" ? el.closest("a[href]") : null;
    if (!a) return;
    var url;
    try { url = new URL(a.getAttribute("href"), document.baseURI); } catch (err) { return; }
    if (url.protocol !== "https:" && url.protocol !== "http:") return;
    if (a.getAttribute("data-browser") !== "system" && !SYSTEM_HOSTS.test(url.hostname)) return;
    e.stopImmediatePropagation(); // preventDefault 는 하지 않는다: 웹뷰의 기본 이동을 Capacitor 가 기기 브라우저로 돌린다
  }, true);

  // ------------------------------------------------------------ 시간표 이미지 (공유·저장)

  // 화면(app.js)은 시간표 그림에 시간표 자료를 넣은 PNG(web/js/timetables.js 의 addTimetableToPng)를 넘긴다.
  //   TTW_APP.shareImage({ bytes, name, title })  공유 시트(카카오톡·드라이브·파일 …). title 은 시트 제목
  //   TTW_APP.saveImage({ bytes, name })          사진에 저장(안드로이드 Pictures/TT Wizard, iOS 사진 앱). → { uri? }
  //   TTW_APP.canSaveImage / canShareImage        이 기기에서 되는지(true/false). 켤 때 플러그인에 한 번 묻고 답이 오면 바뀐다(처음엔 false).
  //   TTW_APP.imageInfo                           그 답을 기다리는 Promise({ save, share }). 메뉴를 그리기 전에 기다릴 때(보통은 켠 지 몇 ms 안에 온다)
  //   bytes: Uint8Array | ArrayBuffer | Blob, name: 파일 이름(.png 는 붙여 준다). 둘 다 Promise.
  // 저장은 모든 기기(10/30, 디자인 79판 '모든 기기에 둔다'): 안드로이드 10 이상은 권한 없이, 9 이하와 iOS 는 처음 저장할 때 사진(저장소) 권한을 묻는다.
  // 거절하는 code(디자인 79판 '문구', 화면의 saveFailed):
  //   "DENIED"       사진 접근을 허락하지 않았다(이번에 거절, 전에 거절해 다시 묻지 않음, iOS 제한). 화면: '사진 접근이 꺼져 있어요' [설정](TTW_APP.openSettings)
  //   "UNSUPPORTED"  이 앱 연결이 못 한다(플러그인이 없는 옛 앱). 화면은 웹과 같은 길(공유 시트가 있으면 그것, 없으면 내려받기)
  //   "FAILED"·그 밖  저장하지 못했다. 화면: '사진에 저장하지 못했어요' [다시 시도]
  function unsupported() {
    var e = new Error("unsupported");
    e.code = "UNSUPPORTED";
    return Promise.reject(e);
  }
  /** 플러그인 호출: 플러그인이 없거나 그 메서드가 없는 판(Capacitor 의 UNIMPLEMENTED)이면 UNSUPPORTED 로 거절한다 */
  function pluginCall(name, method, args) {
    var p = (cap.Plugins || {})[name];
    if (!p || typeof p[method] !== "function") return unsupported();
    return Promise.resolve().then(function () { return p[method](args); }).catch(function (e) {
      if (e && e.code === "UNIMPLEMENTED") return unsupported();
      throw e;
    });
  }
  function imageBytes(data) {
    if (data instanceof Uint8Array) return Promise.resolve(data);
    if (data instanceof ArrayBuffer) return Promise.resolve(new Uint8Array(data));
    if (data && typeof data.arrayBuffer === "function") return data.arrayBuffer().then(function (b) { return new Uint8Array(b); });
    return Promise.reject(new Error("no image data"));
  }
  function base64(bytes) {
    var s = "";
    for (var i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s);
  }
  function imageCall(method, opts) {
    var p = (cap.Plugins || {}).TTWImage;
    if (!p || typeof p[method] !== "function") return unsupported();
    opts = opts || {};
    return imageBytes(opts.bytes).then(function (b) {
      return pluginCall("TTWImage", method, { data: base64(b), name: String(opts.name || ""), title: String(opts.title || "") });
    });
  }

  var app = {
    build: BUILD, remote: REMOTE, platform: platform,
    shareImage: function (opts) { return imageCall("share", opts); },
    saveImage: function (opts) { return imageCall("save", opts); },
    canSaveImage: false,
    canShareImage: false,
  };
  app.imageInfo = (function () {
    var p = (cap.Plugins || {}).TTWImage;
    if (!p || typeof p.info !== "function") return Promise.resolve({ save: false, share: false });
    return Promise.resolve().then(function () { return p.info(); }).then(function (r) {
      app.canSaveImage = !!(r && r.save);
      app.canShareImage = true;
      return { save: app.canSaveImage, share: true };
    }, function () {
      return { save: false, share: false };
    });
  })();

  // ------------------------------------------------------------ 앱으로 연 주소 (시간표 링크)

  // 앱이 깔린 폰에서 시간표 링크(https://archi142857.github.io/tt-wizard/#t=…)를 누르면 이 앱이 열린다(안드로이드 App Links: AndroidManifest.xml
  // 의 intent-filter, iOS Universal Links: App.entitlements. 확인 파일은 docs/app.md '시간표 링크로 앱 열기'). 연 주소를 화면(app.js)에 넘긴다:
  //   TTW_APP.launchUrl  켤 때 연 주소(글) 또는 null 로 풀리는 Promise(App.getLaunchUrl). 그냥 켰으면 null. 늦게 풀려도 된다(화면이 학기 목록을 기다린다)
  //   'ttw:open-url'     켜 둔 동안 링크로 다시 열리면 window 에 보내는 CustomEvent, detail.url = 주소(App 'appUrlOpen')
  // 켤 때의 주소는 둘로 온다: 안드로이드는 BridgeActivity.load 가 켤 때의 intent 를 onNewIntent 로 한 번 더 넘겨 'appUrlOpen' 도 오고
  // (8.5.2 소스), iOS 도 그럴 수 있다. 화면(app.js receiveLink)이 같은 링크를 10초 안에 두 번 넣지 않는다.
  app.launchUrl = App && typeof App.getLaunchUrl === "function"
    ? Promise.resolve().then(function () { return App.getLaunchUrl(); }).then(function (r) {
      return r && typeof r.url === "string" && r.url ? r.url : null;
    }, function () { return null; })
    : Promise.resolve(null);
  if (App && typeof App.addListener === "function") {
    try {
      var listening = App.addListener("appUrlOpen", function (ev) {
        var url = ev && typeof ev.url === "string" ? ev.url : "";
        if (url) window.dispatchEvent(new CustomEvent("ttw:open-url", { detail: { url: url } }));
      });
      if (listening && typeof listening.catch === "function") listening.catch(function () {});
    } catch (e) {
      // 듣지 못해도 켤 때의 주소(launchUrl)는 그대로다
    }
  }

  // ------------------------------------------------------------ 링크 공유·앱 설정 (TTWShell)

  //   TTW_APP.shareLink({ url, title })  기기의 공유 시트로 링크를 보낸다(안드로이드 웹뷰에는 navigator.share 가 없다). title 은 시트 제목.
  //                                      못 하면 code "UNSUPPORTED"(화면은 복사로), 실패는 "FAILED"
  //   TTW_APP.openSettings()             이 앱의 설정 화면(사진 접근을 다시 켤 곳). 거절 스낵바의 [설정]
  // 앱 안 플러그인(ShellPlugin.java·ShellPlugin.swift)이 없는 옛 앱에는 두 함수가 없다(화면은 없으면 웹과 같은 길·버튼 없이).
  if (plugins.TTWShell) {
    app.shareLink = function (opts) {
      opts = opts || {};
      var url = String(opts.url || "");
      if (!/^https?:\/\//i.test(url)) return Promise.reject(new Error("no link"));
      return pluginCall("TTWShell", "shareText", { text: url, title: String(opts.title || "") });
    };
    app.openSettings = function () { return pluginCall("TTWShell", "openSettings", {}); };
  }

  // ------------------------------------------------------------ 홈 화면 위젯 (안드로이드, TTWWidget)

  // 위젯(다음 수업·오늘 수업·주간 시간표)은 앱이 꺼져 있어도 그려서, 대표 시간표를 위젯 자료로 넘겨 기기 안에 둔다(docs/app.md '홈 화면 위젯').
  // 앱 연결이 직접 넘긴다(10/30): 앱을 켜고 조금 뒤와 앱을 내릴 때(visibilitychange 가 hidden, pagehide) 기기에 둔 값(localStorage 'ttw.')으로
  // web/js/timetables.js 의 widgetDataFromStore 를 돌린다(대표 시간표는 적어 둔 수업, 걷는 분은 engine.js 의 이동 행렬과 앱에 넣은 data/campus.json).
  //   TTW_APP.updateWidgets(data)  화면이 직접 넘길 때(widgetData(...) 결과, 편람과 맞춘 값). 한 번이라도 부르면 그 뒤로는 앱 연결이 넘기지 않는다.
  //                                Promise → true(넘겼다)·false(못 넘겼다). 거절하지 않는다. 이번에 켠 뒤 넘긴 것과 같으면 플러그인을 부르지 않는다
  //   TTW_APP.widgetInfo()         Promise → { placed: 홈 화면에 놓인 위젯 수 } 또는 null
  // 플러그인이 없는 곳(iOS·옛 앱)에는 두 함수가 없고 아무것도 넘기지 않는다.
  if (plugins.TTWWidget) {
    var sentWidgets = null, screenSends = false, widgetTools = null, travelCache = {};
    var sendWidgets = function (data) {
      var json;
      try { json = JSON.stringify(data); } catch (e) { return Promise.resolve(false); }
      if (typeof json !== "string") return Promise.resolve(false);
      if (json === sentWidgets) return Promise.resolve(true);
      return pluginCall("TTWWidget", "update", { data: json }).then(function () {
        sentWidgets = json;
        return true;
      }, function () { return false; });
    };
    app.updateWidgets = function (data) {
      screenSends = true;
      return sendWidgets(data);
    };
    app.widgetInfo = function () {
      return pluginCall("TTWWidget", "info", {}).then(function (r) { return r && typeof r.placed === "number" ? { placed: r.placed } : null; }, function () { return null; });
    };
    // 기기에 둔 값('ttw.' 를 뗀 열쇠)
    var storeKeys = function () {
      var out = [];
      try {
        for (var i = 0; i < localStorage.length; i++) {
          var k = localStorage.key(i);
          if (k && k.indexOf("ttw.") === 0) out.push(k.slice(4));
        }
      } catch (e) { /* 못 읽으면 없는 것으로 */ }
      return out;
    };
    var storeGet = function (k) {
      try {
        var v = localStorage.getItem("ttw." + k);
        return v === null ? undefined : JSON.parse(v);
      } catch (e) {
        return undefined;
      }
    };
    // 모듈 둘과 캠퍼스 자료는 한 번만 부른다(앱에 넣은 것. 실패하면 다음에 다시)
    var loadWidgetTools = function () {
      if (!widgetTools) {
        widgetTools = Promise.all([
          import("./timetables.js"),
          import("./engine.js"),
          nativeFetch("data/campus.json").then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }),
        ]);
        widgetTools.catch(function () { widgetTools = null; });
      }
      return widgetTools;
    };
    var refreshWidgets = function () {
      if (screenSends) return Promise.resolve(false);
      return loadWidgetTools().then(function (m) {
        if (screenSends) return false;
        var data = m[0].widgetDataFromStore({
          get: storeGet, keys: storeKeys(), campus: m[2],
          travel: function (campus, mode) { return travelCache[mode] || (travelCache[mode] = m[1].TravelMatrix.fromCampus(campus, mode)); },
        });
        return sendWidgets(data);
      }).catch(function () { return false; });
    };
    app.refreshWidgets = refreshWidgets; // 시험·개발용(화면은 부르지 않아도 된다)
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "hidden") refreshWidgets();
    });
    window.addEventListener("pagehide", function () { refreshWidgets(); });
    setTimeout(refreshWidgets, 2500); // 켤 때: 화면이 뜬 뒤(앱을 새로 깔았거나 업데이트한 뒤 첫 자료)
  }

  window.TTW_APP = app;
})();
