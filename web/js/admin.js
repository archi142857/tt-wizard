// TT Wizard 관리자 화면(웹만, update140). 사용자 11/18 '웹에서 내 구글계정으로 로그인한 상황이면 개발자 화면으로 진입하는 버튼을 띄우고,
// 비밀번호를 입력했을 때만 … 나중에 관리자를 추가할 수 있도록 인원추가가 쉽게'. 계정 화면의 '관리자 화면' 줄(관리자 문서가 있는 계정, 웹만)을 누르면 app.js 가
// 이 파일을 불러 open(api, opener) 를 부른다. 서버 일은 admin-core.js, 지키는 것은 서버 규칙(firebase/firestore.rules '관리자')이 한다.
// 스토어 앱 묶음에는 넣지 않는다(scripts/build_app.py). 디자인 규칙 밖의 도구라 있는 모양(시트, 입력 칸, 버튼, 정보 행)만 쓴다.
//   잠금: 처음이면 비밀번호 정하기(두 번), 그다음부터 비밀번호 넣기 → 30분 열림(잠그기·로그아웃하면 바로 잠김)
//   열리면: 번호 바꿔 주기 · 닉네임 신고 · 지운 계정이 남긴 번호·열쇠 · 관리자(주인만: 더하기·비밀번호 처음으로·빼기) · 내 비밀번호 바꾸기

let api = null, sheet = null, body = null, core = null, st = null, timer = 0, found = null;

const CSS = `
.adm-sheet .adm-label { margin: var(--space-6) 0 var(--space-1); }
.adm-sheet .adm-form { display: grid; gap: var(--space-2); }
.adm-sheet .adm-form .field-label { margin: var(--space-2) 0 0; }
.adm-sheet .adm-form > button, .adm-sheet .adm-box > button { justify-self: start; }
.adm-sheet .adm-box { display: grid; gap: var(--space-2); }
.adm-sheet .adm-msg { margin: 0; min-height: 1.25rem; font-size: 0.875rem; line-height: 1.25rem; color: var(--text2); }
.adm-sheet .adm-help { margin: 0; font-size: 0.875rem; line-height: 1.25rem; color: var(--text3); }
.adm-sheet .adm-row { gap: var(--space-3); padding-top: var(--space-2); padding-bottom: var(--space-2); font-size: 0.9375rem; line-height: 1.375rem; }
.adm-sheet .adm-row > span { display: grid; min-width: 0; overflow-wrap: anywhere; }
.adm-sheet .adm-row small { font-size: 0.8125rem; line-height: 1.125rem; color: var(--text3); font-variant-numeric: tabular-nums; }
.adm-sheet .adm-row > .adm-acts { display: flex; flex-shrink: 0; gap: var(--space-1); margin-left: auto; }
.adm-sheet .adm-open { display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); font-size: 0.9375rem; color: var(--text2); }
`;

const ERR = { BAD_HANDLE: "닉네임#번호로 넣어 주세요", BAD_TAG: "새 번호는 숫자 여섯 자리예요", NOT_FOUND: "그 닉네임#번호를 쓰는 계정이 없어요",
  TAKEN: "다른 사람이 쓰거나 거둔 번호예요", LOCKED: "잠겼어요. 비밀번호를 다시 넣어 주세요", SIGNED_OUT: "로그인해 주세요", OFFLINE: "연결되면 다시 해 주세요",
  SHORT: "", WRONG_PASSWORD: "비밀번호가 맞지 않아요(기기 시계가 많이 틀려도 그래요)", NOT_ALLOWED: "비밀번호를 정할 수 없어요. 계정 화면을 새로 열어 주세요",
  SELF: "나는 여기서 바꿀 수 없어요", ALREADY: "이미 관리자예요", NO_CRYPTO: "이 브라우저에서는 열 수 없어요(https 주소로 열어 주세요)" };
const REASON = { nick: "부적절한 닉네임", impersonation: "다른 사람 사칭", stranger: "모르는 사람의 친구 요청", other: "그 밖의 까닭" };
const say = (e, fallback) => (e && e.code === "SHORT" ? `${core.MIN_PASSWORD}자 이상 정해 주세요` : ERR[e && e.code] || fallback);
const two = (n) => String(n).padStart(2, "0");
const at = (iso) => { const d = new Date(iso); return `${d.getMonth() + 1}월 ${d.getDate()}일 ${two(d.getHours())}:${two(d.getMinutes())}`; };
const clock = (iso) => { const d = new Date(iso); return `${two(d.getHours())}:${two(d.getMinutes())}`; };

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
  sheet = h("dialog", { class: "sheet adm-sheet", id: "admin-sheet", "aria-labelledby": "admin-title" },
    h("div", { class: "sheet-head" },
      h("div", { class: "h" }, h("h2", { class: "sheet-title", id: "admin-title" }, "관리자 화면")),
      h("button", { type: "button", class: "btn-text", "data-close": true }, "닫기")),
    body);
  document.body.append(sheet);
  api.wireSheet(sheet);
  sheet.addEventListener("submit", (e) => { e.preventDefault(); submit(e.target); });
  sheet.addEventListener("click", (e) => { const b = e.target.closest("[data-adm]"); if (b) act(b.dataset.adm, b); });
  sheet.addEventListener("close", () => { found = null; for (const i of sheet.querySelectorAll('input[type="password"]')) i.value = ""; }); // 닫아도 끝나는 때의 잠금은 그대로 건다
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

/** 잠금: 처음이면 비밀번호 정하기(두 번 넣기), 아니면 비밀번호 넣기 */
function paintGate(first) {
  const { h } = api;
  const pw = (id, label, auto) => [h("label", { class: "field-label", for: id }, label),
    h("input", { class: "text-input", id, type: "password", autocomplete: auto, spellcheck: "false", required: true })];
  body.replaceChildren(h("form", { class: "adm-form", "data-form": first ? "set" : "unlock", novalidate: true },
    first ? h("p", { class: "adm-help" }, `처음이라 비밀번호를 정해요. ${core.MIN_PASSWORD}자 이상, 문장처럼 길게 정해 주세요. 비밀번호는 어디에도 저장되지 않아서 잊으면 주인이 처음으로 돌려야 해요.`) : null,
    ...pw("adm-pw", "비밀번호", first ? "new-password" : "current-password"),
    ...(first ? pw("adm-pw2", "한 번 더", "new-password") : []),
    h("button", { type: "submit", class: "btn-secondary" }, first ? "정하고 열기" : "열기"),
    h("p", { class: "adm-msg", role: "status" }, "")));
  body.querySelector("#adm-pw").focus();
}

function paintTools() {
  const { h } = api;
  const owner = st.role === "owner";
  body.replaceChildren(
    h("div", { class: "adm-open" }, h("span", { role: "status" }, `${clock(st.until)}까지 열려 있어요`), h("button", { type: "button", class: "btn-text", "data-adm": "lock" }, "잠그기")),
    h("h3", { class: "field-label adm-label" }, "번호 바꿔 주기"),
    h("form", { class: "adm-form", "data-form": "retag", novalidate: true },
      h("label", { class: "field-label", for: "adm-retag-from" }, "닉네임#번호"),
      h("input", { class: "text-input", id: "adm-retag-from", type: "text", autocomplete: "off", spellcheck: "false", placeholder: "닉네임#482193", enterkeyhint: "next" }),
      h("label", { class: "field-label", for: "adm-retag-to" }, "새 번호"),
      h("input", { class: "text-input", id: "adm-retag-to", type: "text", inputmode: "numeric", maxlength: "6", autocomplete: "off", placeholder: "000000", enterkeyhint: "done" }),
      h("button", { type: "submit", class: "btn-secondary" }, "바꾸기"),
      h("p", { class: "adm-msg", role: "status" })),
    h("h3", { class: "field-label adm-label" }, "닉네임 신고"),
    h("div", { class: "adm-box", "data-box": "reports" },
      h("button", { type: "button", class: "btn-secondary", "data-adm": "reports" }, "처리 안 한 신고 보기"),
      h("ul", { class: "sheet-list", hidden: true }),
      h("p", { class: "adm-msg", role: "status" })),
    h("h3", { class: "field-label adm-label" }, "지운 계정이 남긴 번호·열쇠"),
    h("div", { class: "adm-box", "data-box": "orphans" },
      h("p", { class: "adm-help" }, "옛 판 앱으로 계정을 지우면 남아요. 며칠에 한 번 찾아 정리해 주세요(5일 안에)."),
      h("button", { type: "button", class: "btn-secondary", "data-adm": "orphans" }, "찾기"),
      h("button", { type: "button", class: "btn-secondary", "data-adm": "clean", hidden: true }, "정리"),
      h("p", { class: "adm-msg", role: "status" })),
    owner ? h("h3", { class: "field-label adm-label" }, "관리자") : null,
    owner ? h("div", { class: "adm-box", "data-box": "admins" },
      h("ul", { class: "sheet-list" }),
      h("p", { class: "adm-msg", role: "status" })) : null,
    owner ? h("form", { class: "adm-form", "data-form": "add", novalidate: true },
      h("label", { class: "field-label", for: "adm-add" }, "관리자 더하기"),
      h("input", { class: "text-input", id: "adm-add", type: "text", autocomplete: "off", spellcheck: "false", placeholder: "닉네임#482193", enterkeyhint: "done" }),
      h("p", { class: "adm-help" }, "더한 사람은 처음 들어올 때 자기 비밀번호를 정해요."),
      h("button", { type: "submit", class: "btn-secondary" }, "더하기"),
      h("p", { class: "adm-msg", role: "status" })) : null,
    h("h3", { class: "field-label adm-label" }, "내 비밀번호 바꾸기"),
    h("form", { class: "adm-form", "data-form": "change", novalidate: true },
      h("label", { class: "field-label", for: "adm-new" }, "새 비밀번호"),
      h("input", { class: "text-input", id: "adm-new", type: "password", autocomplete: "new-password", spellcheck: "false" }),
      h("label", { class: "field-label", for: "adm-new2" }, "한 번 더"),
      h("input", { class: "text-input", id: "adm-new2", type: "password", autocomplete: "new-password", spellcheck: "false" }),
      h("button", { type: "submit", class: "btn-secondary" }, "바꾸기"),
      h("p", { class: "adm-msg", role: "status" })));
  if (owner) paintAdmins();
  // 열린 시간이 끝나면 연결을 새로 잇고(그동안 맺은 읽기 연결을 버린다) 잠금 화면으로. 서버는 그때부터 받지 않는다
  timer = setTimeout(() => { core.reconnect().catch(() => null).then(() => { if (sheet.open) refresh(); }); }, Math.max(1000, new Date(st.until).getTime() - Date.now() + 500));
}

async function paintAdmins() {
  const { h } = api, box = body.querySelector('[data-box="admins"]');
  if (!box) return;
  const list = box.querySelector("ul"), msg = box.querySelector("p");
  try {
    const rows = await core.admins();
    list.replaceChildren(...rows.map((r) => h("li", { class: "info-row adm-row" },
      h("span", {}, r.nick ? `${r.nick}#${r.tag}` : "닉네임 없음", h("small", {}, `${r.role === "owner" ? "주인" : "관리자"}${r.me ? " · 나" : ""}${r.added ? ` · ${at(r.added)}` : ""}`)),
      r.me ? null : h("span", { class: "adm-acts" },
        h("button", { type: "button", class: "btn-text", "data-adm": "reset", "data-uid": r.uid }, "비밀번호 처음으로"),
        h("button", { type: "button", class: "btn-text danger", "data-adm": "remove", "data-uid": r.uid }, "빼기")))));
    msg.textContent = "";
  } catch (e) {
    await locked(e, msg, "관리자 목록을 불러오지 못했어요");
  }
}

/** 잠겼으면(시간이 지났으면) 잠금 화면으로, 아니면 그 칸에 알린다 */
async function locked(e, msg, fallback) {
  if (e && e.code === "LOCKED") { await refresh(); api.showSnackbar(ERR.LOCKED); return; }
  if (msg) msg.textContent = say(e, fallback);
}

const busy = (b) => { if (b.getAttribute("aria-busy") === "true") return true; b.setAttribute("aria-busy", "true"); return false; };
const done = (b) => b.removeAttribute("aria-busy");

async function submit(form) {
  const btn = form.querySelector('button[type="submit"]'), msg = form.querySelector(".adm-msg"), kind = form.dataset.form;
  const val = (id) => (form.querySelector(`#${id}`) || { value: "" }).value;
  if (busy(btn)) return;
  try {
    if (kind === "set" || kind === "unlock") {
      if (kind === "set" && val("adm-pw") !== val("adm-pw2")) { msg.textContent = "두 비밀번호가 달라요"; return; }
      msg.textContent = "여는 중";
      await (kind === "set" ? core.setPassword(val("adm-pw")) : core.unlock(val("adm-pw")));
      await refresh();
      api.showSnackbar("관리자 화면을 열었어요");
    } else if (kind === "retag") {
      msg.textContent = "바꾸는 중";
      const r = await core.retag(val("adm-retag-from"), val("adm-retag-to"));
      msg.textContent = r.from === r.tag ? "이미 그 번호예요" : `바꿨어요: ${r.nick}#${r.from} → ${r.nick}#${r.tag}`;
    } else if (kind === "add") {
      msg.textContent = "더하는 중";
      const r = await core.addAdmin(val("adm-add"));
      form.querySelector("#adm-add").value = "";
      msg.textContent = `${r.nick}#${r.tag} 님을 관리자로 더했어요`;
      paintAdmins();
    } else if (kind === "change") {
      if (val("adm-new") !== val("adm-new2")) { msg.textContent = "두 비밀번호가 달라요"; return; }
      msg.textContent = "바꾸는 중";
      await core.changePassword(val("adm-new"));
      for (const i of form.querySelectorAll("input")) i.value = "";
      msg.textContent = "비밀번호를 바꿨어요";
    }
  } catch (e) {
    await locked(e, msg, "하지 못했어요");
  } finally {
    done(btn);
    if (kind === "set" || kind === "unlock") for (const i of form.querySelectorAll('input[type="password"]')) i.value = "";
  }
}

async function act(k, b) {
  if (busy(b)) return;
  try {
    if (k === "lock") { await core.lock(); await refresh(); api.showSnackbar("잠갔어요"); return; }
    if (k === "reports") return await showReports(b);
    if (k === "close") {
      const box = body.querySelector('[data-box="reports"]'), msg = box.querySelector(".adm-msg");
      try {
        await core.closeReport(b.dataset.id);
        const li = b.closest("li"), list = li.parentElement;
        li.remove();
        list.hidden = !list.children.length;
        msg.textContent = list.children.length ? `처리했어요 · 남은 것 ${list.children.length}건` : "처리했어요 · 남은 신고가 없어요";
      } catch (e) { await locked(e, msg, "처리하지 못했어요"); }
      return;
    }
    if (k === "orphans" || k === "clean") return await orphanStep(k, b);
    if (k === "reset" || k === "remove") {
      // 두 번 눌러야 한다(4초 안에)
      if (!b.dataset.armed) {
        b.dataset.armed = "1";
        const text = b.textContent;
        b.textContent = k === "reset" ? "정말 처음으로" : "정말 빼기";
        setTimeout(() => { delete b.dataset.armed; b.textContent = text; }, 4000);
        return;
      }
      const msg = body.querySelector('[data-box="admins"] .adm-msg');
      try {
        await (k === "reset" ? core.resetPassword(b.dataset.uid) : core.removeAdmin(b.dataset.uid));
        msg.textContent = k === "reset" ? "비밀번호를 처음으로 돌렸어요. 다음에 들어올 때 새로 정해요" : "관리자에서 뺐어요";
        paintAdmins();
      } catch (e) { await locked(e, msg, "하지 못했어요"); }
    }
  } finally {
    done(b);
  }
}

/** 처리 안 한 신고(새것 먼저): 그때 닉네임#번호 · 까닭 / 덧붙임 글 / 보낸 때, [처리]. 신고한 사람은 보이지 않는다(법무 11/17) */
async function showReports() {
  const { h } = api, box = body.querySelector('[data-box="reports"]'), list = box.querySelector("ul"), msg = box.querySelector(".adm-msg");
  msg.textContent = "불러오는 중";
  try {
    const rows = await core.reports();
    list.replaceChildren(...rows.map((r) => h("li", { class: "info-row adm-row" },
      h("span", {}, `${r.handle} · ${REASON[r.reason] || r.reason}`, r.note ? h("small", {}, r.note) : null, h("small", {}, r.created ? at(r.created) : "")),
      h("span", { class: "adm-acts" }, h("button", { type: "button", class: "btn-text", "data-adm": "close", "data-id": r.id }, "처리")))));
    list.hidden = !rows.length;
    msg.textContent = rows.length ? `${rows.length}건` : "처리 안 한 신고가 없어요";
  } catch (e) {
    await locked(e, msg, "불러오지 못했어요");
  }
}

/** 지운 계정이 남긴 번호·열쇠: 수만 보인다(닉네임이 든 열쇠 이름은 보이지 않는다) */
async function orphanStep(k) {
  const box = body.querySelector('[data-box="orphans"]'), clean = box.querySelector('[data-adm="clean"]'), msg = box.querySelector(".adm-msg");
  try {
    if (k === "orphans") {
      clean.hidden = true;
      msg.textContent = "찾는 중";
      found = await core.orphans();
      const n = found.numbers.length, c = found.handles.length;
      msg.textContent = n + c ? `번호 ${n}개 · 열쇠 ${c}개` : "남은 것이 없어요";
      clean.hidden = !(n + c);
    } else if (found) {
      const r = await core.cleanOrphans(found);
      found = null;
      clean.hidden = true;
      msg.textContent = `정리했어요 · 번호 ${r.numbers}개 · 열쇠 ${r.handles}개`;
    }
  } catch (e) {
    await locked(e, msg, k === "clean" ? "정리하지 못했어요" : "찾지 못했어요");
  }
}
