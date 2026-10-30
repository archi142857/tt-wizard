// tests/test_app.py 가 부른다: 앱 연결 스크립트(app/src/native.js)를 가짜 Capacitor·브라우저 위에서 돌리고 결과를 JSON으로 출력한다.
// 자료 받기(네트워크 → 받아 둔 것 → 앱에 넣은 것, 늦은 응답 저장), 바탕 지도(앱에 넣은 것만), 자료가 아닌 요청, 안드로이드 뒤로 가기,
// 안드로이드 상태 바 글자색(기기 테마가 바뀔 때), 기기 브라우저로 여는 링크(에브리타임), 시간표 이미지(공유·저장·거절 code),
// 앱으로 연 주소(launchUrl·'ttw:open-url'), 링크 공유·앱 설정(TTWShell), 웹에서는 아무것도 안 함.
import { readFileSync } from "node:fs";
import vm from "node:vm";

const SRC = readFileSync(new URL("../app/src/native.js", import.meta.url), "utf8")
  .replace("__BUILD__", "B1").replace("__REMOTE__", "https://remote.example/tt/");

/** 아주 작은 IndexedDB: open → onupgradeneeded/onsuccess, transaction().objectStore().get/put */
function fakeIndexedDB() {
  const rows = new Map();
  const later = (fn) => setTimeout(fn, 0);
  const store = {
    get(key) { const req = {}; later(() => { req.result = rows.get(key); req.onsuccess && req.onsuccess(); }); return req; },
    put(value, key) { rows.set(key, structuredClone(value)); return {}; },
  };
  const db = { createObjectStore() { return store; }, transaction() { return { objectStore: () => store }; } };
  return {
    rows,
    open() { const req = { result: db }; later(() => { req.onupgradeneeded && req.onupgradeneeded(); req.onsuccess && req.onsuccess(); }); return req; },
  };
}

function setup({ native = true, http = null, online = true, platform = "android", bars = true, image = true, sdk = 34, imageInfo = null,
  saveError = null, shell = true, shellError = null, launch, launchFails = false, appUrl = true, widget = true, widgetError = null } = {}) {
  const calls = { local: [], remote: [], back: 0, minimized: 0, bars: [], image: [], shell: [], opened: [], widget: [] };
  const scheme = []; // 기기 테마(prefers-color-scheme)가 바뀔 때 부를 것들
  const visible = []; // 앱으로 돌아올 때(visibilitychange) 부를 것들
  const clicks = []; // 문서의 click 을 듣는 것들 [{fn, capture}]
  const listeners = {};
  const dialogs = [];
  const idb = fakeIndexedDB();
  const localFetch = async (input) => {
    const url = typeof input === "string" ? input : input.url;
    calls.local.push(url);
    return new Response(JSON.stringify({ from: "bundle", url }), { status: 200 });
  };
  const reject = (code) => { const e = new Error(code.toLowerCase()); e.code = code; return Promise.reject(e); };
  const win = Object.assign(new EventTarget(), {
    fetch: localFetch,
    Capacitor: native ? {
      isNativePlatform: () => true,
      getPlatform: () => platform,
      Plugins: {
        App: {
          addListener: (ev, fn) => { if (ev !== "appUrlOpen" || appUrl) listeners[ev] = fn; return Promise.resolve({ remove() {} }); },
          minimizeApp: () => { calls.minimized += 1; },
          getLaunchUrl: () => (launchFails ? reject("UNIMPLEMENTED") : Promise.resolve(launch === undefined ? undefined : { url: launch })),
        },
        ...(bars ? { SystemBars: { setStyle: (opts) => { calls.bars.push(opts.style); return Promise.resolve(); } } } : {}),
        ...(http ? { CapacitorHttp: { get: (opts) => { calls.remote.push(opts.url); return http(opts.url); } } } : {}),
        ...(image ? { TTWImage: {
          share: (opts) => { calls.image.push(["share", opts]); return Promise.resolve(); },
          save: (opts) => { calls.image.push(["save", opts]); return saveError ? reject(saveError) : Promise.resolve({ uri: "content://media/1" }); },
          info: () => Promise.resolve(imageInfo || { save: true, sdk }),
        } } : {}),
        ...(widget ? { TTWWidget: {
          update: (opts) => { calls.widget.push(opts.data); return widgetError ? reject(widgetError) : Promise.resolve({ placed: 2, changed: true }); },
          info: () => (widgetError ? reject(widgetError) : Promise.resolve({ placed: 2 })),
        } } : {}),
        ...(shell ? { TTWShell: {
          shareText: (opts) => { calls.shell.push(["shareText", opts]); return shellError ? reject(shellError) : Promise.resolve(); },
          openSettings: (opts) => { calls.shell.push(["openSettings", opts]); return shellError ? reject(shellError) : Promise.resolve(); },
        } } : {}),
      },
    } : undefined,
    matchMedia: (query) => ({ matches: false, addEventListener: (ev, fn) => { if (ev === "change" && /prefers-color-scheme/.test(query)) scheme.push(fn); } }),
  });
  win.addEventListener("ttw:open-url", (e) => calls.opened.push(e.detail && e.detail.url));
  const attrs = {};
  const context = {
    window: win,
    document: {
      baseURI: "https://localhost/",
      documentElement: { setAttribute: (k, v) => { attrs[k] = v; }, hasAttribute: (k) => k in attrs },
      visibilityState: "visible",
      addEventListener: (ev, fn, opts) => {
        if (ev === "visibilitychange") visible.push(fn);
        if (ev === "click") clicks.push({ fn, capture: opts === true || Boolean(opts && opts.capture) });
      },
      querySelectorAll: (sel) => (sel === "dialog[open]" ? dialogs.filter((d) => d.open) : []),
    },
    location: { origin: "https://localhost" },
    navigator: { onLine: online },
    indexedDB: idb,
    history: { back: () => { calls.back += 1; } },
    Event, CustomEvent, Response, URL, JSON, Promise, setTimeout, clearTimeout, String, structuredClone, Uint8Array, ArrayBuffer, Blob, btoa,
  };
  vm.createContext(context);
  vm.runInContext(SRC, context);
  return { win, calls, listeners, dialogs, idb, attrs, scheme, visible, clicks };
}

const read = async (res) => ({ source: res.headers.get("X-TTW-Source"), body: await res.json() });
const out = {};

// 1) 웹(Capacitor 없음): fetch 를 건드리지 않는다
{
  const s = setup({ native: false });
  out.webUntouched = s.win.TTW_APP === undefined && s.attrs["data-platform"] === undefined;
}

// 2) 네트워크로 받으면 그것을 쓰고 저장한다. 자료가 아닌 요청은 그대로
{
  const s = setup({ http: async (url) => ({ status: 200, data: JSON.stringify({ from: "remote", url }) }) });
  const r = await read(await s.win.fetch("data/campus.json"));
  await new Promise((r2) => setTimeout(r2, 10));
  const other = await read(await s.win.fetch("vendor/leaflet/leaflet.css"));
  const post = await read(await s.win.fetch("data/campus.json", { method: "POST" }));
  out.network = { source: r.source, from: r.body.from, url: r.body.url, saved: s.idb.rows.has("data/campus.json"),
    savedBuild: s.idb.rows.get("data/campus.json")?.build, other: other.body.from, post: post.body.from,
    platform: s.attrs["data-platform"] };
}

// 3) 네트워크 실패 → 받아 둔 것, 그것도 없으면 앱에 넣은 것. 빌드가 다른 저장본은 쓰지 않는다
{
  let fail = false;
  const s = setup({ http: async () => { if (fail) throw new Error("offline"); return { status: 200, data: '{"from":"remote"}' }; } });
  await s.win.fetch("data/courses.json");
  await new Promise((r) => setTimeout(r, 10));
  fail = true;
  const saved = await read(await s.win.fetch("data/courses.json"));
  const bundled = await read(await s.win.fetch("data/routes.json"));
  s.idb.rows.set("data/routes.json", { build: "OLD", text: '{"from":"old"}' });
  const oldBuild = await read(await s.win.fetch("data/routes.json"));
  const notOk = setup({ http: async () => ({ status: 404, data: "<html>" }) });
  const html = await read(await notOk.win.fetch("data/semesters/2025-1.json"));
  out.fallback = { saved: [saved.source, saved.body.from], bundled: [bundled.source, bundled.body.from],
    oldBuild: oldBuild.body.from, notFound: html.body.from };
}

// 4) 오프라인이면 네트워크를 부르지 않는다
{
  const s = setup({ online: false, http: async () => ({ status: 200, data: '{"from":"remote"}' }) });
  const r = await read(await s.win.fetch("data/campus.json"));
  out.offline = { from: r.body.from, remoteCalls: s.calls.remote.length };
}

// 5) 늦으면(3초) 먼저 앱에 넣은 것으로 답하고, 늦게 온 응답은 저장해 다음에 쓴다
{
  const s = setup({ http: () => new Promise((resolve) => setTimeout(() => resolve({ status: 200, data: '{"from":"late"}' }), 3300)) });
  const t0 = Date.now();
  const first = await read(await s.win.fetch("data/campus.json"));
  const waited = Date.now() - t0;
  await new Promise((r) => setTimeout(r, 600));
  out.slow = { first: first.body.from, waitedMs: Math.round(waited / 100) * 100, savedLate: s.idb.rows.get("data/campus.json")?.text };
}

// 6) 안드로이드 뒤로 가기: 열린 시트 → 이전 화면 → 앱 내리기. 시트가 cancel 을 막으면 닫지 않는다
{
  const s = setup({ http: async () => ({ status: 200, data: "{}" }) });
  const mk = (prevent) => {
    const d = new EventTarget();
    d.open = true;
    d.close = () => { d.open = false; };
    if (prevent) d.addEventListener("cancel", (e) => e.preventDefault());
    s.dialogs.push(d);
    return d;
  };
  const sheet = mk(false);
  s.listeners.backButton({ canGoBack: true });
  const closed = !sheet.open && s.calls.back === 0;
  const guarded = mk(true);
  s.listeners.backButton({ canGoBack: true });
  const kept = guarded.open;
  guarded.open = false;
  s.listeners.backButton({ canGoBack: true });
  s.listeners.backButton({ canGoBack: false });
  out.back = { closed, kept, historyBack: s.calls.back, minimized: s.calls.minimized };
}

// 7) 바탕 지도는 앱에 넣은 것만(네트워크로 받지 않는다)
{
  const s = setup({ http: async () => ({ status: 200, data: '{"from":"remote"}' }) });
  const r = await read(await s.win.fetch("data/basemap.json"));
  out.basemap = { from: r.body.from, remoteCalls: s.calls.remote.length };
}

// 8) 안드로이드 상태 바 글자색: 기기 테마가 바뀌거나 앱으로 돌아오면 'DEFAULT' 를 다시 요청한다. 이벤트 테마가 켜져 있으면(<html data-theme>)
//    건드리지 않는다. iOS 에서는 듣지 않고, 플러그인이 없거나 던져도 멈추지 않는다
{
  const s = setup();
  const start = s.calls.bars.length; // 켤 때는 부르지 않는다(처음 값은 capacitor.config.json 의 style)
  s.scheme.forEach((fn) => fn({ matches: true }));
  const afterChange = [...s.calls.bars];
  s.attrs["data-theme"] = "xmas";
  s.scheme.forEach((fn) => fn({ matches: false }));
  s.visible.forEach((fn) => fn());
  const withTheme = s.calls.bars.length;
  delete s.attrs["data-theme"];
  s.visible.forEach((fn) => fn());
  const ios = setup({ platform: "ios" });
  const none = setup({ bars: false });
  const throwing = setup();
  throwing.win.Capacitor.Plugins.SystemBars.setStyle = () => { throw new Error("no"); };
  let threw = false;
  try { throwing.scheme.forEach((fn) => fn({ matches: true })); } catch { threw = true; }
  out.bars = { listening: [s.scheme.length, s.visible.length], start, afterChange, withTheme, afterThemeOff: [...s.calls.bars],
    ios: ios.scheme.length + ios.visible.length, noPlugin: none.scheme.length + none.visible.length, threw };
}

// 9) 기기 브라우저로 여는 링크: 에브리타임(과 그 하위 주소), data-browser="system" 을 붙인 링크는 화면의 처리(앱 안 브라우저)가 받기 전에
//    전파만 끊는다(기본 동작은 막지 않는다: 웹뷰의 이동을 Capacitor 가 기기 브라우저로 돌린다). 다른 링크와 링크가 아닌 곳은 건드리지 않는다
{
  const press = (s, href, attrs = {}, inside = true) => {
    const a = href === null ? null : { getAttribute: (k) => (k === "href" ? href : k in attrs ? attrs[k] : null) };
    const ev = { stopped: false, prevented: false, target: inside ? { closest: (sel) => (sel === "a[href]" ? a : null) } : {},
      stopImmediatePropagation() { this.stopped = true; }, stopPropagation() { this.stopped = true; }, preventDefault() { this.prevented = true; } };
    s.clicks.forEach((c) => c.fn(ev));
    return ev.stopped && !ev.prevented ? "system" : ev.prevented ? "prevented" : "app";
  };
  const s = setup();
  const ios = setup({ platform: "ios" });
  const web = setup({ native: false });
  out.links = {
    capture: s.clicks.map((c) => c.capture),
    everytime: [press(s, "https://everytime.kr/lecture/search?keyword=%EC%A1%B0%EC%88%98%EB%82%A8&condition=professor"), press(ios, "https://everytime.kr/lecture/view/1")],
    subdomain: press(s, "https://snu.everytime.kr/"),
    marked: press(s, "https://example.com/login", { "data-browser": "system" }),
    others: [press(s, "https://github.com/Archi142857/tt-wizard"), press(s, "https://www.openstreetmap.org/copyright"), press(s, "https://everytime.kr.example.com/"),
      press(s, "https://noteverytime.kr/"), press(s, "#top"), press(s, "mailto:someone@everytime.kr", { "data-browser": "system" })],
    notLink: [press(s, null), press(s, "https://everytime.kr/", {}, false)],
    web: web.clicks.length,
  };
}

// 시간표 이미지: 바이트를 base64 로 바꿔 앱 안 플러그인에 넘긴다(Uint8Array·ArrayBuffer·Blob). 플러그인이 없으면 UNSUPPORTED
{
  const s = setup();
  await s.win.TTW_APP.shareImage({ bytes: new Uint8Array([137, 80, 78, 71, 0, 255]), name: "시간표 1", title: "시간표 보내기" });
  const saved = await s.win.TTW_APP.saveImage({ bytes: new Blob([new Uint8Array([1, 2, 3])]).slice(0), name: "a.png" });
  await s.win.TTW_APP.shareImage({ bytes: new Uint8Array(70000).fill(7).buffer });
  const none = setup({ image: false });
  const err = await none.win.TTW_APP.shareImage({ bytes: new Uint8Array([1]) }).then(() => null, (e) => e.code);
  const bad = await s.win.TTW_APP.saveImage({ bytes: "글자" }).then(() => null, (e) => e.message);
  out.image = {
    calls: s.calls.image.slice(0, 2).map(([m, o]) => [m, o.data, o.name, o.title]),
    big: Buffer.from(s.calls.image[2][1].data, "base64").equals(Buffer.alloc(70000, 7)),
    saved, unsupported: err, bad, count: s.calls.image.length,
  };
  // 사진에 저장되는 기기인지: 켤 때 한 번 묻고(처음엔 false) 답이 오면 바뀐다. 플러그인이 없으면(옛 iOS 앱) 둘 다 false.
  // 10/30 부터 모든 기기가 저장한다(안드로이드 9 이하·iOS 는 권한을 물어서). 저장하지 않는다고 답하는 옛 앱 연결(9 이하)은 false 그대로
  const fresh = setup();
  const before = [fresh.win.TTW_APP.canSaveImage, fresh.win.TTW_APP.canShareImage];
  const info = await fresh.win.TTW_APP.imageInfo;
  const ios = setup({ platform: "ios", imageInfo: { save: true, share: true } });
  const iosInfo = await ios.win.TTW_APP.imageInfo;
  const old = setup({ imageInfo: { save: false, sdk: 28 } });
  const oldInfo = await old.win.TTW_APP.imageInfo;
  const noneInfo = await none.win.TTW_APP.imageInfo;
  out.imageInfo = { before, info, after: [fresh.win.TTW_APP.canSaveImage, fresh.win.TTW_APP.canShareImage], ios: [iosInfo, ios.win.TTW_APP.canSaveImage],
    old: [oldInfo, old.win.TTW_APP.canSaveImage, old.win.TTW_APP.canShareImage], none: [noneInfo, none.win.TTW_APP.canSaveImage] };
  // 저장 거절: 플러그인의 code 를 그대로(DENIED: 사진 접근 거절, FAILED: 그 밖), 그 메서드가 없는 옛 플러그인(UNIMPLEMENTED)은 UNSUPPORTED
  const codeOf = (opts) => setup(opts).win.TTW_APP.saveImage({ bytes: new Uint8Array([1]), name: "a" }).then(() => "ok", (e) => e.code);
  out.saveCodes = [await codeOf({ saveError: "DENIED" }), await codeOf({ saveError: "FAILED" }), await codeOf({ saveError: "UNIMPLEMENTED" }), await codeOf({})];
}

// 앱으로 연 주소: 켤 때 연 주소는 launchUrl(Promise, 없으면 null), 켜 둔 동안 열린 주소는 window 의 'ttw:open-url'(detail.url)
{
  const link = "https://archi142857.github.io/tt-wizard/#t=jWzEsIjIwMjYtMiJd";
  const s = setup({ launch: link });
  const plain = setup();
  const failing = setup({ launchFails: true });
  const web = setup({ native: false });
  const launched = [await s.win.TTW_APP.launchUrl, await plain.win.TTW_APP.launchUrl, await failing.win.TTW_APP.launchUrl];
  s.listeners.appUrlOpen({ url: link + "x" });
  s.listeners.appUrlOpen({});
  s.listeners.appUrlOpen({ url: "" });
  const ios = setup({ platform: "ios" });
  ios.listeners.appUrlOpen({ url: link });
  out.launch = { launched, opened: s.calls.opened, ios: ios.calls.opened, web: web.win.TTW_APP === undefined };
}

// 링크 공유·앱 설정(TTWShell): 링크를 글 공유로 넘긴다. 링크가 아니면 거절, 플러그인이 없는 옛 앱에는 함수가 없다, 메서드가 없으면 UNSUPPORTED
{
  const s = setup();
  await s.win.TTW_APP.shareLink({ url: "https://archi142857.github.io/tt-wizard/#t=jAA", title: "2026년 2학기 시간표 1" });
  const notLink = await s.win.TTW_APP.shareLink({ url: "javascript:alert(1)" }).then(() => "ok", (e) => e.message);
  await s.win.TTW_APP.openSettings();
  const none = setup({ shell: false });
  const old = setup({ shellError: "UNIMPLEMENTED" });
  const failed = setup({ shellError: "FAILED" });
  out.shell = {
    calls: s.calls.shell.map(([m, o]) => [m, o.text || "", o.title || ""]),
    notLink,
    none: [typeof none.win.TTW_APP.shareLink, typeof none.win.TTW_APP.openSettings],
    old: await old.win.TTW_APP.shareLink({ url: "https://a.example/" }).then(() => "ok", (e) => e.code),
    oldSettings: await old.win.TTW_APP.openSettings().then(() => "ok", (e) => e.code),
    failed: await failed.win.TTW_APP.shareLink({ url: "https://a.example/" }).then(() => "ok", (e) => e.code),
  };
}

// 홈 화면 위젯(TTWWidget): 자료를 JSON 글로 넘기고, 이번에 켠 뒤 넘긴 것과 같으면 다시 부르지 않는다. 못 넘기면 false(거절하지 않는다).
// 플러그인이 없는 곳(iOS·옛 앱)에는 함수가 없다
{
  const s = setup();
  const data = { v: 1, colors: "item", terms: [{ sem: "2026-2", days: [[], [], [], [], [], [], []] }] };
  const sent = [await s.win.TTW_APP.updateWidgets(data), await s.win.TTW_APP.updateWidgets(JSON.parse(JSON.stringify(data))),
    await s.win.TTW_APP.updateWidgets({ ...data, colors: "cls" })];
  const cyclic = {};
  cyclic.self = cyclic;
  const failing = setup({ widgetError: "BAD_DATA" });
  const none = setup({ widget: false });
  out.widgets = {
    sent, calls: s.calls.widget.map((x) => JSON.parse(x).colors), text: typeof s.calls.widget[0],
    cyclic: await s.win.TTW_APP.updateWidgets(cyclic), failed: [await failing.win.TTW_APP.updateWidgets(data), failing.calls.widget.length],
    retry: [await failing.win.TTW_APP.updateWidgets(data), failing.calls.widget.length], // 못 넘긴 것은 다음에 다시 부른다
    info: [await s.win.TTW_APP.widgetInfo(), await failing.win.TTW_APP.widgetInfo()],
    none: [typeof none.win.TTW_APP.updateWidgets, typeof none.win.TTW_APP.widgetInfo],
  };
}

console.log(JSON.stringify(out));
