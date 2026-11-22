// TT Wizard 관리자 화면(웹만, update140). 사용자 11/18 '웹에서 내 구글계정으로 로그인한 상황이면 개발자 화면으로 진입하는 버튼을 띄우고,
// 비밀번호를 입력했을 때만 … 나중에 관리자를 추가할 수 있도록 인원추가가 쉽게'. 계정 화면의 '관리자 화면' 줄(관리자 문서가 있는 계정, 웹만)을 누르면 app.js 가
// 이 파일을 불러 open(api, opener) 를 부른다. 서버 일은 admin-core.js, 지키는 것은 서버 규칙(firebase/firestore.rules '관리자')이 한다.
// 스토어 앱 묶음에는 넣지 않는다(scripts/build_app.py). 디자인 규칙 밖의 도구라 있는 모양(시트, 입력 칸, 버튼, 정보 행)만 쓴다.
//   잠금: 처음이면 비밀번호 정하기(두 번), 그다음부터 비밀번호 넣기 → 30분 열림(잠그기·로그아웃하면 바로 잠김)
//   열리면: 개발자 메뉴(js/dev.js) · 번호 바꿔 주기 · 닉네임 신고 · 지운 계정이 남긴 번호·열쇠 · 관리자(주인만: 더하기·비밀번호 처음으로·빼기) · 내 비밀번호 바꾸기
//   개발자 메뉴는 update140 부터 여기로만 연다(11/18 사용자 '원래 있던 개발자 루트는 지워야겠지?': 시간표에 과목 하나 + 동선 확인하기로 열던 길은 없앰)
//   글과 꼴은 디자인 154판(update141): 칸마다 머리(15/22 700 heading)와 칸 사이 선, 칸 오류는 칸 아래 .error-line(alert), 진행은 버튼 안(aria-busy),
//   화면 글 규칙의 '처리' 대신 '남은 신고 보기'·'끝내기', '→' 대신 '…으로 바꿨어요', 도움말 끝 마침표·'님' 빼기
//   디자인 156판(update142): 빈 결과 줄은 자리를 차지하지 않고(:empty, 칸 사이 선 위아래 16), 신고·관리자 줄은 칸 폭 안(글은 칸 머리와 같은 선, 줄 사이 선은 칸 폭,
//   텍스트 버튼 글 끝은 칸 끝), 계정 화면의 '관리자 화면' 카드는 '로그아웃해도 …' 글 아래(app.js renderAccount)

let api = null, sheet = null, body = null, core = null, st = null, timer = 0, found = null;

const CSS = `
.adm-sheet .adm-open { display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); font-size: 0.9375rem; color: var(--text2); }
.adm-sheet .adm-sec { display: grid; gap: var(--space-2); margin-top: var(--space-4); }
.adm-sheet .adm-sec + .adm-sec { padding-top: var(--space-4); border-top: 1px solid var(--line); }
.adm-sheet .adm-label { margin: 0; font-size: 0.9375rem; line-height: 1.375rem; font-weight: 700; color: var(--heading); }
.adm-sheet .adm-label .count { margin-left: var(--space-2); font-weight: 400; color: var(--text3); font-variant-numeric: tabular-nums; }
.adm-sheet .adm-form, .adm-sheet .adm-box { display: grid; gap: var(--space-2); }
.adm-sheet .adm-form .field-label { margin: var(--space-2) 0 0; }
.adm-sheet .adm-form > .field-label:first-child { margin-top: 0; }
.adm-sheet .adm-form > button, .adm-sheet .adm-box > button { justify-self: start; }
.adm-sheet .adm-msg { margin: 0; font-size: 0.875rem; line-height: 1.25rem; color: var(--text2); }
.adm-sheet .adm-msg:empty { display: none; }
.adm-sheet .adm-help { margin: 0; font-size: 0.875rem; line-height: 1.25rem; color: var(--text3); }
.adm-sheet .error-line { margin: 0; }
.adm-sheet .btn-secondary .spinner { margin-right: var(--space-2); }
.adm-sheet .adm-box .sheet-list { margin: 0; }
.adm-sheet .adm-row { padding: var(--space-2) 0; }
.adm-sheet .adm-row > .adm-who { display: grid; min-width: 0; overflow-wrap: anywhere; }
.adm-sheet .adm-row small { font-size: 0.8125rem; line-height: 1.125rem; color: var(--text3); font-variant-numeric: tabular-nums; }
.adm-sheet .adm-row .adm-note { font-size: 0.875rem; line-height: 1.25rem; color: var(--text2); }
.adm-sheet .adm-row > .adm-acts { display: flex; flex-shrink: 0; gap: var(--space-1); margin-left: auto; margin-right: calc(var(--space-3) * -1); }
`;

const ERR = { BAD_HANDLE: "닉네임#번호로 넣어 주세요", BAD_TAG: "새 번호는 숫자 여섯 자리예요", NOT_FOUND: "그 닉네임#번호를 쓰는 계정이 없어요",
  TAKEN: "다른 사람이 쓰거나 거둔 번호예요", LOCKED: "잠겼어요. 비밀번호를 다시 넣어 주세요", SIGNED_OUT: "로그인해 주세요", OFFLINE: "연결되면 다시 해 주세요",
  SHORT: "", WRONG_PASSWORD: "비밀번호가 맞지 않아요(기기 시계가 많이 틀려도 그래요)", NOT_ALLOWED: "비밀번호를 정할 수 없어요. 계정 화면을 새로 열어 주세요",
  SELF: "나는 여기서 바꿀 수 없어요", ALREADY: "이미 관리자예요", NO_CRYPTO: "이 브라우저에서는 열 수 없어요(https 주소로 열어 주세요)" };
// 오류 code 가 어느 칸 탓인지(그 칸에 aria-invalid. 디자인 154판 '칸 오류는 칸 아래 오류 줄')
const FIELD = { set: { SHORT: "adm-pw", WRONG_PASSWORD: "adm-pw" }, unlock: { SHORT: "adm-pw", WRONG_PASSWORD: "adm-pw", TOO_MANY: "adm-pw" },
  retag: { BAD_HANDLE: "adm-retag-from", NOT_FOUND: "adm-retag-from", BAD_TAG: "adm-retag-to", TAKEN: "adm-retag-to" },
  add: { BAD_HANDLE: "adm-add", NOT_FOUND: "adm-add", SELF: "adm-add", ALREADY: "adm-add" }, change: { SHORT: "adm-new" } };
// 버튼 안 진행 글(디자인 154판: '여는 중'·'바꾸는 중' 같은 진행은 버튼 aria-busy 로. 줄 안 텍스트 버튼은 글을 바꾸지 않는다)
const PROGRESS = { set: "여는 중", unlock: "여는 중", retag: "바꾸는 중", add: "더하는 중", change: "바꾸는 중",
  dev: "여는 중", reports: "불러오는 중", orphans: "찾는 중", clean: "정리하는 중" };
const REASON = { nick: "부적절한 닉네임", impersonation: "다른 사람 사칭", stranger: "모르는 사람의 친구 요청", other: "그 밖의 까닭" };
const two = (n) => String(n).padStart(2, "0");
/** 한 시간에 열 번을 넘게 넣어 보면(update143 보안 점검, admin-core TOO_MANY) 다시 넣을 때를 알린다. 글은 디자인 159판(몇 번인지 적고, '~ㄹ 수 있어요' 꼴은 화면 글에 쓰지 않는다) */
const TOO_MANY_HEAD = "비밀번호를 한 시간에 열 번 넘게 넣었어요";
const tooMany = (e) => {
  const d = e && e.retry ? new Date(e.retry) : null;
  return d && !Number.isNaN(d.getTime()) ? `${TOO_MANY_HEAD}. ${two(d.getHours())}:${two(d.getMinutes())}부터 다시 넣어 주세요` : `${TOO_MANY_HEAD}. 한 시간 뒤에 다시 넣어 주세요`;
};
const say = (e, fallback) => (e && e.code === "SHORT" ? `${core.MIN_PASSWORD}자 이상 정해 주세요` : e && e.code === "TOO_MANY" ? tooMany(e) : ERR[e && e.code] || fallback);
const at = (iso) => { const d = new Date(iso); return `${d.getMonth() + 1}월 ${d.getDate()}일 ${two(d.getHours())}:${two(d.getMinutes())}`; };
const clock = (iso) => { const d = new Date(iso); return `${two(d.getHours())}:${two(d.getMinutes())}`; };
/** '…으로'·'…로': 끝 글자에 받침이 있으면 '으로'(ㄹ 받침과 받침 없는 글자는 '로'). 숫자는 읽는 소리로(0 영·3 삼·6 육만 받침, 1 일·7 칠·8 팔은 ㄹ) */
function ro(s) {
  const c = String(s).slice(-1);
  if (/[0-9]/.test(c)) return "036".includes(c) ? "으로" : "로";
  const code = c.charCodeAt(0) - 0xac00;
  if (code < 0 || code > 11171) return "로";
  const jong = code % 28;
  return jong === 0 || jong === 8 ? "로" : "으로";
}

/** 관리자 화면을 연다. a: app.js 의 devApi()(그리기·시트·스낵바), opener: 연 버튼(닫으면 초점이 돌아간다) */
export async function open(a, opener) {
  api = a;
  core = core || await import("./admin-core.js");
  if (!sheet) build();
  body.replaceChildren(api.h("p", { class: "adm-msg", role: "status" }, "확인하는 중"));
  api.openSheet(sheet, opener);
  await refresh();
}

function build() {
  const { h } = api;
  document.head.append(h("style", {}, CSS));
  body = h("div", { class: "sheet-body" });
  // 모달 시트가 열려 있으면 화면의 알림 영역은 읽히지 않는다: 시트 안에 알림 영역 둘(app.js announce 도 열린 시트의 [data-live] 를 쓴다)
  sheet = h("dialog", { class: "sheet adm-sheet", id: "admin-sheet", "aria-labelledby": "admin-title" },
    h("div", { class: "sheet-head" },
      h("div", { class: "h" }, h("h2", { class: "sheet-title", id: "admin-title" }, "관리자 화면")),
      h("button", { type: "button", class: "btn-text", "data-close": true }, "닫기")),
    body,
    h("p", { class: "sr-only", "data-live": "status", role: "status" }),
    h("p", { class: "sr-only", "data-live": "alert", role: "alert" }));
  document.body.append(sheet);
  api.wireSheet(sheet);
  sheet.addEventListener("submit", (e) => { e.preventDefault(); submit(e.target); });
  sheet.addEventListener("click", (e) => { const b = e.target.closest("[data-adm]"); if (b) act(b.dataset.adm, b); });
  sheet.addEventListener("close", () => { found = null; for (const i of sheet.querySelectorAll('input[type="password"]')) i.value = ""; }); // 닫아도 끝나는 때의 잠금은 그대로 건다
}

/** 시트 안 알림 영역에 읽힐 글(지웠다가 조금 뒤에 넣어 같은 글도 다시 읽힌다) */
function tell(kind, text) {
  const el = sheet.querySelector(`[data-live="${kind}"]`);
  el.textContent = "";
  setTimeout(() => { el.textContent = text; }, 60);
}
/** 칸 오류 줄(칸 아래 .error-line, 알림은 alert). field 가 있으면 그 칸에 aria-invalid */
function fail(scope, text, field) {
  const line = scope.querySelector(".error-line");
  for (const i of scope.querySelectorAll("[aria-invalid]")) i.removeAttribute("aria-invalid");
  if (field) scope.querySelector(`#${field}`)?.setAttribute("aria-invalid", "true");
  if (line) { line.textContent = text; line.hidden = false; }
  tell("alert", text);
}
function clear(scope) {
  const line = scope.querySelector(".error-line");
  if (line) { line.hidden = true; line.textContent = ""; }
  for (const i of scope.querySelectorAll("[aria-invalid]")) i.removeAttribute("aria-invalid");
  note(scope, "");
}
/** 결과 한 줄(.adm-msg). 비면 자리를 차지하지 않아서(디자인 156판 ㉠, :empty) 읽어 주는 것은 시트의 알림 영역(status)이 한다 */
function note(scope, text) {
  const m = scope.querySelector(".adm-msg");
  if (m) m.textContent = text;
  if (text) tell("status", text);
}

/** 버튼 안 진행(디자인 규칙 '상태와 피드백'): aria-busy 를 걸고, text 가 있으면 500ms 뒤 작은 스피너와 그 글(한번 뜨면 200ms 이상).
 *  이미 하는 중이면 null, 아니면 끝낼 때 부를 함수 */
function busyOn(b, text) {
  if (b.getAttribute("aria-busy") === "true") return null;
  b.setAttribute("aria-busy", "true");
  const label = b.textContent;
  let shown = 0;
  const t = text ? setTimeout(() => { shown = performance.now(); b.replaceChildren(api.h("span", { class: "spinner small", "aria-hidden": "true" }), text); }, 500) : 0;
  return async () => {
    clearTimeout(t);
    if (shown) {
      const left = 200 - (performance.now() - shown);
      if (left > 0) await new Promise((r) => setTimeout(r, left));
      b.textContent = label;
    }
    b.removeAttribute("aria-busy");
  };
}

/** 서버에 묻고 그에 맞는 화면(정하기·열기·도구)을 그린다 */
async function refresh() {
  clearTimeout(timer);
  try {
    st = await core.state();
  } catch (e) {
    body.replaceChildren(api.h("p", { class: "adm-msg", role: "status" }, say(e, "확인하지 못했어요")));
    return;
  }
  if (!st.role) body.replaceChildren(api.h("p", { class: "adm-msg", role: "status" }, "관리자 계정이 아니에요"));
  else if (st.key === "none") paintGate(true);
  else if (!st.until) paintGate(false);
  else paintTools();
}

/** 잠금: 처음이면 비밀번호 정하기(두 번 넣기), 아니면 비밀번호 넣기. 오류는 칸 아래 오류 줄 */
function paintGate(first) {
  const { h } = api;
  const pw = (id, label, auto, help) => [h("label", { class: "field-label", for: id }, label),
    h("input", { class: "text-input", id, type: "password", autocomplete: auto, spellcheck: "false", required: true,
      "aria-describedby": help ? "adm-gate-help adm-gate-err" : "adm-gate-err" })];
  body.replaceChildren(h("form", { class: "adm-form", "data-form": first ? "set" : "unlock", novalidate: true },
    first ? h("p", { class: "adm-help", id: "adm-gate-help" },
      `처음이라 비밀번호를 정해요. ${core.MIN_PASSWORD}자 이상, 문장처럼 길게 정해 주세요. 비밀번호는 어디에도 저장되지 않아서 잊으면 주인이 처음으로 돌려야 해요`) : null,
    ...pw("adm-pw", "비밀번호", first ? "new-password" : "current-password", first),
    ...(first ? pw("adm-pw2", "한 번 더", "new-password") : []),
    h("p", { class: "error-line", id: "adm-gate-err", hidden: true }),
    h("button", { type: "submit", class: "btn-secondary" }, first ? "정하고 열기" : "열기")));
  body.querySelector("#adm-pw").focus();
}

function paintTools() {
  const { h } = api;
  const owner = st.role === "owner";
  const sec = (title, ...kids) => h("div", { class: "adm-sec" }, h("h3", { class: "adm-label" }, ...[title].flat()), ...kids);
  const err = (id) => h("p", { class: "error-line", id, hidden: true });
  const msg = () => h("p", { class: "adm-msg" }); // 알림은 note() 가 시트의 status 영역으로(빈 줄은 숨어서 그 자리에 role=status 를 두지 않는다)
  const input = (id, attrs) => h("input", { class: "text-input", id, autocomplete: "off", spellcheck: "false", ...attrs });
  body.replaceChildren(
    h("div", { class: "adm-open" }, h("span", { role: "status" }, `${clock(st.until)}까지 열려 있어요`), h("button", { type: "button", class: "btn-text", "data-adm": "lock" }, "잠그기")),
    sec("개발자 메뉴", h("div", { class: "adm-box", "data-box": "dev" },
      h("p", { class: "adm-help" }, "테마·시험·이 기기 정보예요. 이 기기에서만 바뀌어요"),
      h("button", { type: "button", class: "btn-secondary", "data-adm": "dev" }, "열기"),
      err(), msg())),
    sec("번호 바꿔 주기", h("form", { class: "adm-form", "data-form": "retag", novalidate: true },
      h("label", { class: "field-label", for: "adm-retag-from" }, "닉네임#번호"),
      input("adm-retag-from", { type: "text", placeholder: "닉네임#482193", enterkeyhint: "next", "aria-describedby": "adm-retag-err" }),
      h("label", { class: "field-label", for: "adm-retag-to" }, "새 번호"),
      input("adm-retag-to", { type: "text", inputmode: "numeric", maxlength: "6", placeholder: "000000", enterkeyhint: "done", "aria-describedby": "adm-retag-err" }),
      err("adm-retag-err"),
      h("button", { type: "submit", class: "btn-secondary" }, "바꾸기"),
      msg())),
    sec(["닉네임 신고", h("span", { class: "count", hidden: true })], h("div", { class: "adm-box", "data-box": "reports" },
      h("button", { type: "button", class: "btn-secondary", "data-adm": "reports" }, "남은 신고 보기"),
      h("ul", { class: "sheet-list", hidden: true }),
      err(), msg())),
    sec("지운 계정이 남긴 번호·열쇠", h("div", { class: "adm-box", "data-box": "orphans" },
      h("p", { class: "adm-help" }, "옛 판 앱으로 계정을 지우면 남아요. 5일 안에 한 번씩 찾아 정리해 주세요"),
      h("button", { type: "button", class: "btn-secondary", "data-adm": "orphans" }, "찾기"),
      h("button", { type: "button", class: "btn-secondary", "data-adm": "clean", hidden: true }, "정리"),
      err(), msg())),
    owner ? sec("관리자", h("div", { class: "adm-box", "data-box": "admins" }, h("ul", { class: "sheet-list" }), err(), msg())) : null,
    owner ? sec("관리자 더하기", h("form", { class: "adm-form", "data-form": "add", novalidate: true },
      h("label", { class: "field-label", for: "adm-add" }, "닉네임#번호"),
      input("adm-add", { type: "text", placeholder: "닉네임#482193", enterkeyhint: "done", "aria-describedby": "adm-add-help adm-add-err" }),
      h("p", { class: "adm-help", id: "adm-add-help" }, "더한 사람은 처음 들어올 때 자기 비밀번호를 정해요"),
      err("adm-add-err"),
      h("button", { type: "submit", class: "btn-secondary" }, "더하기"),
      msg())) : null,
    sec("내 비밀번호 바꾸기", h("form", { class: "adm-form", "data-form": "change", novalidate: true },
      h("label", { class: "field-label", for: "adm-new" }, "새 비밀번호"),
      input("adm-new", { type: "password", autocomplete: "new-password", "aria-describedby": "adm-change-err" }),
      h("label", { class: "field-label", for: "adm-new2" }, "한 번 더"),
      input("adm-new2", { type: "password", autocomplete: "new-password", "aria-describedby": "adm-change-err" }),
      err("adm-change-err"),
      h("button", { type: "submit", class: "btn-secondary" }, "바꾸기"),
      msg())));
  if (owner) paintAdmins();
  // 열린 시간이 끝나면 연결을 새로 잇고(그동안 맺은 읽기 연결을 버린다) 잠금 화면으로. 서버는 그때부터 받지 않는다
  timer = setTimeout(() => { core.reconnect().catch(() => null).then(() => { if (sheet.open) refresh(); }); }, Math.max(1000, new Date(st.until).getTime() - Date.now() + 500));
}

/** 관리자 목록(주인만). keep: 다시 그린 뒤 초점을 둘 줄의 uid(그 줄이 없으면 목록의 첫 버튼, 그것도 없으면 더하기 칸) */
async function paintAdmins(keep) {
  const { h } = api, box = body.querySelector('[data-box="admins"]');
  if (!box) return;
  const list = box.querySelector("ul");
  try {
    const rows = await core.admins();
    list.replaceChildren(...rows.map((r) => h("li", { class: "info-row adm-row" },
      h("span", { class: "adm-who" }, h("span", {}, r.nick ? `${r.nick}#${r.tag}` : "닉네임 없음"),
        h("small", {}, `${r.role === "owner" ? "주인" : "관리자"}${r.me ? " · 나" : ""}${r.added ? ` · ${at(r.added)}` : ""}`)),
      r.me ? null : h("span", { class: "adm-acts" },
        h("button", { type: "button", class: "btn-text", "data-adm": "reset", "data-uid": r.uid }, "비밀번호 처음으로"),
        h("button", { type: "button", class: "btn-text danger", "data-adm": "remove", "data-uid": r.uid }, "빼기")))));
    if (keep !== undefined) (list.querySelector(`[data-adm="reset"][data-uid="${keep}"]`) || list.querySelector("[data-adm]") || body.querySelector("#adm-add"))?.focus();
  } catch (e) {
    await locked(e, box, "관리자 목록을 불러오지 못했어요");
  }
}

/** 잠겼으면(시간이 지났으면) 잠금 화면으로, 아니면 그 칸의 오류 줄에 알린다 */
async function locked(e, scope, fallback, field) {
  if (e && e.code === "LOCKED") { await refresh(); api.showSnackbar(ERR.LOCKED); return; }
  if (scope && scope.isConnected) fail(scope, say(e, fallback), field);
}

async function submit(form) {
  const btn = form.querySelector('button[type="submit"]'), kind = form.dataset.form;
  const val = (id) => (form.querySelector(`#${id}`) || { value: "" }).value;
  if (btn.getAttribute("aria-busy") === "true") return;
  clear(form);
  if (kind === "set" && val("adm-pw") !== val("adm-pw2")) { fail(form, "두 비밀번호가 달라요", "adm-pw2"); return; }
  if (kind === "change" && val("adm-new") !== val("adm-new2")) { fail(form, "두 비밀번호가 달라요", "adm-new2"); return; }
  const stop = busyOn(btn, PROGRESS[kind]);
  if (!stop) return;
  let failed = false;
  try {
    if (kind === "set" || kind === "unlock") {
      await (kind === "set" ? core.setPassword(val("adm-pw")) : core.unlock(val("adm-pw")));
      await refresh();
      api.showSnackbar("관리자 화면을 열었어요");
    } else if (kind === "retag") {
      const r = await core.retag(val("adm-retag-from"), val("adm-retag-to"));
      note(form, r.from === r.tag ? "이미 그 번호예요" : `${r.nick}#${r.tag}${ro(r.tag)} 바꿨어요`);
    } else if (kind === "add") {
      const r = await core.addAdmin(val("adm-add"));
      form.querySelector("#adm-add").value = "";
      note(form, `관리자로 더했어요 · ${r.nick}#${r.tag}`);
      paintAdmins();
    } else if (kind === "change") {
      await core.changePassword(val("adm-new"));
      for (const i of form.querySelectorAll("input")) i.value = "";
      note(form, "비밀번호를 바꿨어요");
    }
  } catch (e) {
    failed = true;
    await locked(e, form, "하지 못했어요", FIELD[kind] && FIELD[kind][e && e.code]);
  } finally {
    await stop();
    if (kind === "set" || kind === "unlock") {
      for (const i of form.querySelectorAll('input[type="password"]')) i.value = "";
      if (failed && form.isConnected) form.querySelector("#adm-pw").focus(); // 틀렸으면 다시 넣을 칸으로
    }
  }
}

async function act(k, b) {
  if ((k === "reset" || k === "remove") && !b.dataset.armed) { // 두 번 눌러야 한다(4초 안에. 개발자 메뉴의 '기록 모두 지우기'와 같다)
    b.dataset.armed = "1";
    const text = b.textContent;
    b.textContent = k === "reset" ? "정말 처음으로" : "정말 빼기";
    setTimeout(() => { delete b.dataset.armed; b.textContent = text; }, 4000);
    return;
  }
  const stop = busyOn(b, b.classList.contains("btn-secondary") ? PROGRESS[k] : "");
  if (!stop) return;
  try {
    if (k === "lock") { await core.lock(); await refresh(); api.showSnackbar("잠갔어요"); return; }
    if (k === "dev") return await openDev(b);
    if (k === "reports") return await showReports();
    if (k === "close") return await closeReport(b);
    if (k === "orphans" || k === "clean") return await orphanStep(k);
    if (k === "reset" || k === "remove") {
      const box = body.querySelector('[data-box="admins"]'), uid = b.dataset.uid;
      clear(box);
      try {
        await (k === "reset" ? core.resetPassword(uid) : core.removeAdmin(uid));
        note(box, k === "reset" ? "비밀번호를 처음으로 돌렸어요. 다음에 들어올 때 새로 정해요" : "관리자에서 뺐어요");
        await paintAdmins(uid);
      } catch (e) { await locked(e, box, "하지 못했어요"); }
    }
  } finally {
    await stop();
  }
}

/** 개발자 메뉴(js/dev.js, 이 기기 도구): 열린 동안만. 서버에 한 번 더 물어 잠겼으면 잠금 화면으로 간다.
 *  관리자 화면은 닫히고(시트 위에 시트를 띄우지 않는다) 개발자 메뉴를 닫으면 계정 화면의 '관리자 화면' 줄로 초점이 돌아간다 */
async function openDev(b) {
  const box = b.closest(".adm-box");
  clear(box);
  let now;
  try { now = await core.state(); } catch (e) { fail(box, say(e, "확인하지 못했어요")); return; }
  if (!now.until) { await refresh(); api.showSnackbar(ERR.LOCKED); return; }
  let dev;
  try { dev = await import("./dev.js"); } catch { fail(box, "개발자 메뉴를 불러오지 못했어요"); return; }
  dev.open(api, sheet.returnTo);
}

/** 남은 신고 수: 머리 '닉네임 신고' 옆 .count(0 이면 숨김) */
function countReports(n) {
  const c = body.querySelector('[data-box="reports"]').closest(".adm-sec").querySelector(".adm-label .count");
  c.textContent = n ? n.toLocaleString("ko-KR") : "";
  c.hidden = !n;
}

/** 남은 신고(새것 먼저): 줄마다 그때 닉네임#번호 / 까닭 · 보낸 때 / 덧붙인 말, 오른쪽 [끝내기]. 신고한 사람은 보이지 않는다(법무 11/17) */
async function showReports() {
  const { h } = api, box = body.querySelector('[data-box="reports"]'), list = box.querySelector("ul");
  clear(box);
  try {
    const rows = await core.reports();
    list.replaceChildren(...rows.map((r) => h("li", { class: "info-row adm-row" },
      h("span", { class: "adm-who" }, h("span", {}, r.handle),
        h("small", {}, `${REASON[r.reason] || r.reason}${r.created ? ` · ${at(r.created)}` : ""}`),
        r.note ? h("span", { class: "adm-note" }, r.note) : null),
      h("span", { class: "adm-acts" }, h("button", { type: "button", class: "btn-text", "data-adm": "close", "data-id": r.id }, "끝내기")))));
    list.hidden = !rows.length;
    countReports(rows.length);
    note(box, rows.length ? "" : "남은 신고가 없어요");
  } catch (e) {
    await locked(e, box, "신고를 불러오지 못했어요");
  }
}

/** 신고 하나를 끝낸다: 줄을 빼고 남은 수를 고친다. 초점은 다음 줄(없으면 앞 줄, 그것도 없으면 '남은 신고 보기') */
async function closeReport(b) {
  const box = body.querySelector('[data-box="reports"]');
  clear(box);
  try {
    await core.closeReport(b.dataset.id);
    const li = b.closest("li"), list = li.parentElement, next = li.nextElementSibling || li.previousElementSibling;
    li.remove();
    const n = list.children.length;
    list.hidden = !n;
    countReports(n);
    note(box, n ? `끝냈어요 · 남은 신고 ${n.toLocaleString("ko-KR")}건` : "남은 신고가 없어요");
    (next ? next.querySelector('[data-adm="close"]') : box.querySelector('[data-adm="reports"]')).focus();
  } catch (e) { await locked(e, box, "끝내지 못했어요"); }
}

/** 지운 계정이 남긴 번호·열쇠: 수만 보인다(닉네임이 든 열쇠 이름은 보이지 않는다) */
async function orphanStep(k) {
  const box = body.querySelector('[data-box="orphans"]'), find = box.querySelector('[data-adm="orphans"]'), clean = box.querySelector('[data-adm="clean"]');
  clear(box);
  try {
    if (k === "orphans") {
      clean.hidden = true;
      found = await core.orphans();
      const n = found.numbers.length, c = found.handles.length;
      note(box, n + c ? `번호 ${n}개 · 열쇠 ${c}개` : "남은 것이 없어요");
      clean.hidden = !(n + c);
    } else if (found) {
      const r = await core.cleanOrphans(found);
      found = null;
      clean.hidden = true;
      note(box, `정리했어요 · 번호 ${r.numbers}개 · 열쇠 ${r.handles}개`);
      find.focus(); // 누른 '정리'가 숨었다
    }
  } catch (e) {
    await locked(e, box, k === "clean" ? "정리하지 못했어요" : "찾지 못했어요");
  }
}
