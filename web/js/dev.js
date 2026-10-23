// TT Wizard 개발자 메뉴(웹만). 10/24 사용자: "차라리 개발자 루트 같은 걸 만들어놓자", "21년도 1학기에서 저 과목 하나만을 시간표에 추가하고 동선 확인하기를 눌렀을 때
// 개발자 메뉴로 들어갈 수 있게 만들어줘. 테마라던지 이런 거 제한 없고 기능 같은 거 테스트 해볼 수 있는 메뉴로".
// 2021년 1학기 시간표에 '신경계질환의 병인기작 및 약물 개발 전략' 001 하나만 넣고 동선 확인하기를 누르면 app.js 가 이 파일을 불러 open(api, opener) 를 부른다.
// 스토어 앱에서는 열지 않고 앱 묶음에도 넣지 않는다(scripts/build_app.py. 법무: 바이너리에 숨긴 기능은 Apple 2.5.19 의 앱 삭제·계정 해지 사유).
// 디자인 규칙 밖의 도구라 있는 모양(시트, 세그먼트, 메뉴 행, 정보 행)만 쓴다. 그리기와 스타일은 모두 이 파일 안이다(app.js 에는 여는 고리와 api 만 있다).
//   테마: 기본 · 라이트 · 다크 · 크리스마스를 기간과 상관없이(크리스마스는 시험으로 켜고 고른 것은 따로 기억한다: app.js pickDevTheme)
//   시험: 묻는 팝업, 새 버전 알림, 시간표 이미지(지금 보는 시간표를 그려 시트 안에 보인다), 테마 기억 지우기(묻는 팝업을 처음부터)
//   이 기기: 버전·실행 환경·화면·글자 크기·기기 설정·기기 날짜·편람·서비스 워커·저장한 기록, 기록 모두 지우기(두 번 눌러야 지운다)

let api = null, sheet = null, body = null, opener0 = null, imageUrl = "", wipeTimer = 0;

// 시트 안의 모양. 색·간격은 style.css 의 토큰으로만 칠한다
const CSS = `
.dev-sheet .dev-field { min-width: 0; margin: 0; padding: 0; border: 0; }
.dev-sheet .dev-label { margin: var(--space-6) 0 var(--space-1); }
.dev-sheet .seg label { padding: 0 var(--space-1); }
.dev-sheet .menu-row[aria-busy="true"] { color: var(--text3); }
.dev-sheet .dev-info .info-row { min-height: var(--touch); padding: var(--space-2) var(--space-5); font-size: 0.9375rem; line-height: 1.375rem; }
.dev-sheet .dev-info .info-row .v { min-width: 0; text-align: right; overflow-wrap: anywhere; font-variant-numeric: tabular-nums; }
.dev-sheet .dev-wipe { margin-top: 0; border-top: 1px solid var(--line); }
.dev-sheet .dev-image { margin: var(--space-3) 0 0; text-align: center; }
.dev-sheet .dev-image img { display: block; width: min(100%, 15rem); height: auto; margin: 0 auto; border-radius: var(--radius-md); box-shadow: 0 0 0 1px var(--line); }
.dev-sheet .dev-image p { margin: var(--space-2) 0 0; font-size: 0.8125rem; line-height: 1.125rem; color: var(--text3); font-variant-numeric: tabular-nums; }
`;

const SHELL_NAME = { web: "브라우저", pwa: "설치한 웹 앱", android: "안드로이드 앱", ios: "iOS 앱" };
const ROWS = [["ask", "묻는 팝업"], ["update", "새 버전 알림"], ["image", "시간표 이미지"], ["forget", "테마 기억 지우기"]];

/** 개발자 메뉴를 연다. a: app.js 의 devApi(), opener: 연 버튼(닫으면 초점이 돌아간다) */
export function open(a, opener) {
  api = a;
  opener0 = opener;
  if (!sheet) build();
  render();
  api.openSheet(sheet, opener);
}

function build() {
  const { h } = api;
  document.head.append(h("style", {}, CSS));
  body = h("div", { class: "sheet-body" });
  sheet = h("dialog", { class: "sheet dev-sheet", id: "dev-sheet", "aria-labelledby": "dev-title" },
    h("div", { class: "sheet-head" },
      h("div", { class: "h" }, h("h2", { class: "sheet-title", id: "dev-title" }, "개발자 메뉴")),
      h("button", { type: "button", class: "btn-text", "data-close": true }, "닫기")),
    body,
    h("div", { class: "sr-only", role: "status", "data-live": "status" }));
  document.body.append(sheet);
  api.wireSheet(sheet);
  sheet.addEventListener("change", (e) => {
    if (e.target.name !== "dev-theme") return;
    api.pickTheme(e.target.value); // 바로 바뀐다(시트도 새 테마의 색으로)
  });
  sheet.addEventListener("click", (e) => {
    const b = e.target.closest("[data-dev]");
    if (b) act(b.dataset.dev, b);
  });
  sheet.addEventListener("close", () => {
    clearTimeout(wipeTimer);
    if (imageUrl) { URL.revokeObjectURL(imageUrl); imageUrl = ""; }
  });
}

function render() {
  const { h } = api;
  const cur = api.theme(), info = api.info();
  const mq = (q) => matchMedia(q).matches;
  const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
  const settings = [mq("(prefers-color-scheme: dark)") ? "다크" : "라이트", mq("(prefers-reduced-motion: reduce)") ? "동작 줄이기" : "",
    mq("(prefers-contrast: more)") ? "대비 높임" : "", mq("(forced-colors: active)") ? "강제 색" : ""].filter(Boolean).join(" · ");
  const now = new Date(), two = (n) => String(n).padStart(2, "0");
  const rows = [
    ["버전", info.version],
    ["실행 환경", SHELL_NAME[info.shell] || info.shell],
    ["화면", `${innerWidth}×${innerHeight} · 배율 ${Math.round(devicePixelRatio * 100) / 100}`],
    ["글자 크기", `${Math.round(rem * 10) / 10}px`],
    ["기기 설정", settings],
    ["기기 날짜", `${now.getFullYear()}년 ${now.getMonth() + 1}월 ${now.getDate()}일 ${two(now.getHours())}:${two(now.getMinutes())}`],
    ["편람", info.sem ? `${info.sem} · ${info.courses.toLocaleString("ko-KR")}과목` : "받는 중"],
    ["서비스 워커", info.sw ? "켜짐" : "꺼짐"],
    ["저장한 기록", `${info.keys}개 · ${Math.max(1, Math.round(info.bytes / 1024))}KB`],
  ];
  if (imageUrl) { URL.revokeObjectURL(imageUrl); imageUrl = ""; }
  body.replaceChildren(
    h("fieldset", { class: "dev-field" }, h("legend", { class: "field-label" }, "테마"),
      h("div", { class: "seg" }, api.themes.map(([id, name]) => h("label", {}, h("input", { type: "radio", name: "dev-theme", value: id, checked: id === cur }), name)))),
    h("h3", { class: "field-label dev-label" }, "시험"),
    h("ul", { class: "sheet-list" }, ROWS.map(([k, text]) => h("li", {}, h("button", { type: "button", class: "menu-row", "data-dev": k }, text)))),
    h("div", { class: "dev-image", id: "dev-image", hidden: true }),
    h("h3", { class: "field-label dev-label" }, "이 기기"),
    h("ul", { class: "sheet-list dev-info" }, rows.map(([k, v]) => h("li", { class: "info-row" }, h("span", {}, k), h("span", { class: "v" }, v)))),
    h("ul", { class: "sheet-list dev-wipe" }, h("li", {}, h("button", { type: "button", class: "menu-row danger", "data-dev": "wipe" }, "기록 모두 지우기"))));
}

async function act(k, b) {
  if (k === "ask") { api.ask(opener0); return; } // 시트를 바꿔 연다(시트 위에 시트를 띄우지 않는다). 닫으면 초점은 동선 확인하기로
  if (k === "update") { api.closeSheet(sheet); api.update(); return; }
  if (k === "forget") { api.forgetTheme(); api.closeSheet(sheet); api.showSnackbar("테마 기억을 지웠어요"); return; }
  if (k === "image") { await showImage(b); return; }
  if (k === "wipe") {
    if (b.dataset.armed) { clearTimeout(wipeTimer); api.wipe(); return; }
    b.dataset.armed = "1";
    b.textContent = "정말 지우기";
    wipeTimer = setTimeout(() => { delete b.dataset.armed; b.textContent = "기록 모두 지우기"; }, 4000);
  }
}

/** 지금 보는 시간표를 저장할 때와 같은 그림으로 그려 시트 안에 보인다(1080×1920, 화면 테마·칸 색 그대로) */
async function showImage(b) {
  if (b.getAttribute("aria-busy") === "true") return;
  const { h } = api, box = sheet.querySelector("#dev-image");
  b.setAttribute("aria-busy", "true");
  let png = null;
  try { png = await api.image(); } catch { png = null; }
  b.removeAttribute("aria-busy");
  if (!sheet.open) return;
  if (!png) { api.showSnackbar("시간표 이미지를 만들지 못했어요"); return; }
  if (imageUrl) URL.revokeObjectURL(imageUrl);
  imageUrl = URL.createObjectURL(new Blob([png], { type: "image/png" }));
  box.replaceChildren(h("img", { src: imageUrl, alt: "지금 보는 시간표의 이미지", width: "1080", height: "1920" }),
    h("p", {}, `1080×1920 · ${Math.round(png.byteLength / 1024)}KB`));
  box.hidden = false;
  sheet.querySelector('[data-live="status"]').textContent = "시간표 이미지를 만들었어요";
  box.scrollIntoView({ block: "nearest" });
}
