"""개인정보 처리방침·문의·이용 규칙·계정 삭제 안내 페이지를 웹에 올릴 HTML 로 만든다 (백엔드 update74, 11/1. 이용 규칙·계정 삭제 안내는 update116, 11/15).

원문은 docs/legal/privacy.md·support.md·terms.md·delete-account.md(문서·법무 세션이 공유 폴더 `개인정보_처리방침.md` 2-1·3·4·5절에 쓴 것을 그대로 옮김).
나오는 곳: web/privacy/index.html(https://archi142857.github.io/tt-wizard/privacy/), web/support/index.html(…/support/),
web/terms/index.html(…/terms/, 로그인할 때 동의받는 이용 규칙), web/delete-account/index.html(…/delete-account/, Play 데이터 보안의 계정 삭제 주소),
처리방침의 이전 판 web/privacy/2026-11-01/·2026-11-11/·2026-11-15/index.html(원문 docs/legal/privacy-<시행일>.md. 17절 '이전 판도 볼 수 있게 둡니다', update81·99·145),
이용 규칙의 이전 판 web/terms/2026-11-15/index.html(원문 docs/legal/terms-2026-11-15.md, update145).
스토어(Play 처리방침·계정 삭제 칸, App Store 처리방침·지원 주소)와 앱 정보 탭·로그인 카드가 이 주소를 쓴다. 앱 묶음에는 넣지 않는다(scripts/build_app.py).

원문에 쓰는 것은 문안에 나오는 만큼만 읽는다: ### 제목(h1), #### 제목(h2), 문단, 글머리표 목록(두 칸 들여 쓰면 안쪽 목록),
**굵게**(이용 규칙의 중요한 조항: 약관법 제3조, 법무 11/23).
글 속 주소(https://…)·메일 주소·기관 누리집(아래 SITES)은 링크로, 개발자 메일은 앱처럼 제목 'TT Wizard 문의'를 채운다.
【올리는 날】은 처음 시행일 EFFECTIVE, 【이 판 시행일】은 지금 판의 시행일 REVISED 로 채운다(처리방침을 바꾸면 시행일 7일 전에 알린다: 17절).
【앱에 들어간 뒤에 넣음】이 붙은 줄과 【앱에 들어간 뒤에 넣음: …】 문장은 그 기능이 앱에 들어간 판에서만 넣는다(LATER_FEATURES: 글에 든 낱말로 기능을 찾는다).
【Tachyon 처리방침이 올라간 뒤에 넣음】처럼 표시가 곧 조건인 줄은 LATER_MARKERS 의 켜는 이름이 참일 때만 넣는다.
원문에 쓰는 목록은 글머리표(- )와 번호(1. , 줄 머리에서만)다.

    python scripts/legal_pages.py          # 다시 만든다
    python scripts/legal_pages.py --check  # 원문과 같은지 본다(다르면 1)
"""
from __future__ import annotations

import argparse
import html
import re
import sys
from pathlib import Path
from urllib.parse import quote

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "docs" / "legal"
WEB = ROOT / "web"

EFFECTIVE = "2026년 11월 1일"  # 처음 시행일(처음 올린 날. 문안의 【올리는 날】: 17절 '처음 시행')
# 지금 판의 시행일(맨 위 시행일·17절 기록의 【이 판 시행일】). 11/3 법무·문서가 비공개 테스트 신청·오픈채팅방·테스트 의견을 더한 판(update81, 11/10 시행으로 알림)을
# 11/4 법무가 테스트 방을 카카오톡 팀채팅으로 고쳤다(update91). 시행 전에 고쳐서 11/10 판은 시행되지 않고, 17절 '바꾸면 시행일 7일 전에 이 페이지에 알려요'(사용자 11/1)대로
# 고친 판을 올린 날 + 7일(11/4 에 올리면 11/11). 그때까지는 11/1 판이 시행 중이었다.
# 11/12(update99): 문서가 쓰고 법무가 11/11 에 본 2-2절(테스트용 구글 그룹) 판. 11/13 안에 올리면 시행일 7일 전 알림이 되도록 11/20 시행, 그때까지는 11/11 판이 시행 중이다
# (이전 판 privacy-2026-11-11). 그룹은 법무 11/11 대로 이 알림과 함께 연다(17절 줄). 다음 판(2-1절 닉네임)은 이 판이 시행된 뒤(11/20 부터) 올려 판이 겹치지 않게 한다.
# 처리방침을 다시 바꾸면 이 날짜, 지금 판을 이전 판으로 남기기(PAGES, 앞 이전 판 문단의 【이 판 시행일】을 그 날로 굳히기)를 같이 한다
# 11/15(update116): 사용자 11/15 09:26 '로그인 기능도 그냥 지금 되게 … 구현한 기능 싹 다 릴리즈'에 따라 문서가 11/27 판에 로그인(계정과 친구)을 합친 판(공유 폴더 2-1절)을
# 올리는 날 시행한다(법무 11/15 오전: 17절 '새 기능을 켜는 분에게만 해당하는 내용은 그 기능을 켤 때 화면에서 알리고 바로 시행'. 11/20·11/27 판 알림은 이 판으로 갈음).
# 11/20 판은 시행되지 않아 이전 판으로 두지 않는다(11/10 판과 같다). 지금까지 시행 중이던 11/11 판(privacy-2026-11-11)의 '…전날까지'가 이 날로 채워진다.
# 올리는 날을 넘기면 이 날짜와 TERMS_REVISED 를 그날로 고친다
# 11/23(update145): 사용자 11/23 02:00 '앞당겨'(앱 안 닉네임 신고), 법무 11/23 '11/30 당김 돼'. 문서가 쓴 11/30 판(공유 폴더 2-1절 처리방침·4절 이용 규칙)을
# 11/23 에 올려 17절 7일 알림을 지킨다(11/3 판과 같은 방식: 새 판을 시행일과 함께 바로 올리고 11/15 판은 이전 판 privacy-2026-11-15·terms-2026-11-15 로 남긴다.
# 그때까지 시행 중인 것은 이전 판이다). 11/24 넘어 올리면 7일이 모자라니 이 두 날짜를 올리는 날 + 7일로 고치고 문서·프론트엔드에 알린다
REVISED = "2026년 11월 30일"
TERMS_REVISED = "2026년 11월 30일"  # 이용 규칙의 시행일(이용 규칙 원문의 【이 판 시행일】). 처음(11/15)도 이번(11/30)도 처리방침 새 판과 같은 날
FEEDBACK_IN_APP = True  # 앱 정보 탭에 '의견 보내기'가 들어간 판에서 True. 프론트엔드 e9a70a9(11/1)에 들어가 켰다(update76)
# 공유 화면의 앱 단추(update80 의 TTW_APP.shareTargets + 프론트엔드 공유 카드 ui100a eab3a92, 11/3 15:35 푸시)가 앱에 들어가 켰다(update83).
# 11/3 에 올린 11/10 시행 판에 같이 넣어서 17절 7일 전 알림을 지킨다(11/3 안에 올려야 한다)
SHARE_APPS_IN_APP = True
# 【앱에 들어간 뒤에 넣음】이 붙은 줄·문장이 어느 기능인지: 그 글에 든 낱말 → 켜는 이름(위). 낱말이 없거나 둘 이상이면 멈춘다
LATER_FEATURES = {"의견 보내기": "FEEDBACK_IN_APP", "공유 화면의 앱 단추": "SHARE_APPS_IN_APP"}
# 'Tachyon으로 보내기' 단추(web/js/app.js TACHYON_ON)를 켰을 때 True. 켜기 전에 Tachyon 처리방침 페이지가 먼저 올라가야 한다(법무 11/13, 문서 11/13 ②)
TACHYON_IN_APP = False
LATER_MARKERS = {"【Tachyon 처리방침이 올라간 뒤에 넣음】": "TACHYON_IN_APP"}  # 이 표시가 붙은 줄은 켜는 이름이 참일 때만(표시는 지운다)
DEV_MAIL = "sanger.lee138@gmail.com"
MAIL_SUBJECT = "TT Wizard 문의"  # 앱 개발자 정보의 메일 링크와 같다(web/js/app.js DEV_MAIL_HREF)
# 글 덩이에 이 말이 있으면 그 덩이의 개발자 메일 링크는 이 제목(계정 삭제 안내 '‘TT Wizard 계정 삭제 요청’이라고 보내 주십시오'). 나머지는 MAIL_SUBJECT
MAIL_SUBJECTS = {"TT Wizard 계정 삭제 요청": "TT Wizard 계정 삭제 요청"}
SITES = ("privacy.kisa.or.kr", "www.kopico.go.kr", "www.spo.go.kr", "ecrm.police.go.kr")  # 16절 기관(글에는 https:// 없이)

PAGES = {  # 원문 → (나오는 폴더, 문서 제목(원문의 ### 제목은 이것이거나 'TT Wizard ' + 이것), 설명, 맞은편 페이지)
    "privacy": ("privacy", "개인정보 처리방침", "TT Wizard가 다루는 개인정보와 요청하는 방법", ("support", "문의")),
    "support": ("support", "문의", "TT Wizard 버그 제보·기능 제안과 문의", ("privacy", "개인정보 처리방침")),
    "terms": ("terms", "이용 규칙", "TT Wizard 로그인과 친구 기능을 쓸 때 지킬 규칙", ("privacy", "개인정보 처리방침")),
    "delete-account": ("delete-account", "계정 삭제", "TT Wizard 계정과 서버 자료를 지우는 방법", ("privacy", "개인정보 처리방침")),
    # 이전 판(17절 '이전 판도 볼 수 있게 둬요'): 올렸던 글을 풀어 둔 채로 두고 고치지 않는다. 맞은편은 지금 판
    "privacy-2026-11-01": ("privacy/2026-11-01", "개인정보 처리방침", "TT Wizard 개인정보 처리방침의 이전 판(2026년 11월 1일 시행)",
                           ("privacy", "지금 판 개인정보 처리방침")),
    "privacy-2026-11-11": ("privacy/2026-11-11", "개인정보 처리방침", "TT Wizard 개인정보 처리방침의 이전 판(2026년 11월 11일 시행)",
                           ("privacy", "지금 판 개인정보 처리방침")),
    "privacy-2026-11-15": ("privacy/2026-11-15", "개인정보 처리방침", "TT Wizard 개인정보 처리방침의 이전 판(2026년 11월 15일 시행)",
                           ("privacy", "지금 판 개인정보 처리방침")),
    "terms-2026-11-15": ("terms/2026-11-15", "이용 규칙", "TT Wizard 이용 규칙의 이전 판(2026년 11월 15일 시행)", ("terms", "지금 판 이용 규칙")),
}

LATER = "【앱에 들어간 뒤에 넣음】"
LATER_INLINE = re.compile(r"\s*【앱에 들어간 뒤에 넣음:\s*(.*?)】")
# 주소·메일은 ASCII 글자만(바로 뒤에 붙은 한글 조사 '으로' 같은 것을 먹지 않게), 주소 끝의 마침표·쉼표는 글의 것이다
LINK = re.compile(r"https?://[!-'*-~]*[!-'*+\-/-~]|[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+|" + "|".join(re.escape(s) for s in SITES))

# 모양(디자인 규칙 '정보 화면'의 '처리방침·문의 웹 페이지', 11/2 디자인이 고쳐 달라고 함 → update78): 앱 토큰만. 머리는 앱 상단 바와 같은 워드마크(높이 29,
# 다크는 wordmark-dark, 머리 높이 56), 제목 t-h2 20/28·절 제목 t-button 17/24 굵게(둘 다 heading), 본문 t-body 16/24 text2, 카드 모서리 20, 폰 좌우 여백 20.
# 다크는 기기 설정(prefers-color-scheme)이고 크리스마스는 없다(페이지는 앱 테마를 모른다)
STYLE = """
:root { color-scheme: light dark; --bg: #eef0ff; --card: #ffffff; --heading: #1d2a78; --text: #182033; --text2: #51596a; --text3: #646c7e; --line: #dee1f7;
  --line-strong: #7d8599; --focus: #4f70ff; }
@media (prefers-color-scheme: dark) {
  :root { --bg: #16171b; --card: #1e2026; --heading: #e5e8f0; --text: #e4e6eb; --text2: #c8cad2; --text3: #afb2bb; --line: #2f3138; --line-strong: #71747d;
    --focus: #a2b5fa; }
}
html { background: var(--bg); -webkit-text-size-adjust: 100%; text-size-adjust: 100%; }
body { margin: 0; background: var(--bg); color: var(--text2); font: 400 1rem/1.5rem Pretendard, "Pretendard Variable", "Noto Sans KR", -apple-system,
  BlinkMacSystemFont, "Apple SD Gothic Neo", "Malgun Gothic", sans-serif; word-break: keep-all; overflow-wrap: break-word; }
.page { box-sizing: border-box; max-width: 44rem; margin: 0 auto; padding: 16px 20px 48px; }
.top { display: flex; align-items: center; min-height: 56px; margin-bottom: 4px; }
.top a { display: inline-flex; align-items: center; min-height: 48px; }
.top img { display: block; height: 29px; width: auto; }
main { padding: 24px 20px 32px; border-radius: 20px; background: var(--card); }
h1 { margin: 0 0 4px; color: var(--heading); font-size: 1.25rem; line-height: 1.75rem; letter-spacing: -0.01em; font-weight: 700; }
h2 { margin: 32px 0 8px; color: var(--heading); font-size: 1.0625rem; line-height: 1.5rem; font-weight: 700; }
p { margin: 0 0 12px; }
.date { margin-bottom: 24px; color: var(--text3); font-size: .875rem; line-height: 1.25rem; }
ul, ol { margin: 0 0 12px; padding-left: 1.25rem; }
ul ul { margin: 4px 0 0; }
li { margin: 0 0 6px; }
a { color: var(--text); text-decoration: underline; text-decoration-color: var(--line-strong); text-underline-offset: 3px; overflow-wrap: anywhere; }
a:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; border-radius: 2px; }
.bottom { display: flex; flex-wrap: wrap; gap: 8px 16px; margin-top: 16px; padding: 0 4px; color: var(--text3); font-size: .875rem; line-height: 1.25rem; }
.bottom a { display: inline-flex; align-items: center; min-height: 48px; color: var(--text3); }
@media (min-width: 37.5em) { .page { padding-top: 24px; } main { padding: 32px 32px 40px; } }
"""


def later_on(text: str) -> bool:
    """【앱에 들어간 뒤에 넣음】이 붙은 글의 기능이 앱에 들어갔는지(그 글에 든 LATER_FEATURES 낱말로 찾는다)"""
    hits = [flag for word, flag in LATER_FEATURES.items() if word in text]
    if len(hits) != 1:
        raise SystemExit(f"【앱에 들어간 뒤에 넣음】이 어느 기능인지 모르겠다(LATER_FEATURES 에 낱말을 더한다): {text[:60]!r}")
    return bool(globals()[hits[0]])


def resolve(text: str, revised: str = "") -> str:
    """【】 자리를 판에 맞게 푼다(revised: 이 원문의 【이 판 시행일】, 처음 값은 처리방침의 REVISED)"""
    text = text.replace("【올리는 날】", EFFECTIVE).replace("【이 판 시행일】", revised or REVISED)
    text = LATER_INLINE.sub(lambda m: " " + m.group(1) if later_on(m.group(1)) else "", text)
    lines = []
    for line in text.split("\n"):
        if LATER in line:
            if not later_on(line):
                continue
            line = line.replace(" " + LATER, "").replace(LATER, "")
        marks = [m for m in LATER_MARKERS if m in line]
        if marks:
            if not all(globals()[LATER_MARKERS[m]] for m in marks):
                continue
            for m in marks:
                line = line.replace(" " + m, "").replace(m, "")
        lines.append(line)
    return "\n".join(lines)


BOLD = re.compile(r"\*\*(.+?)\*\*")  # **굵게**: 약관의 중요한 조항(약관법 제3조 '알아보기 쉽게', 법무 11/23, update147)


def inline(text: str) -> str:
    """글 한 덩이 → HTML(**…** 는 굵게, 링크 넣기). 개발자 메일은 제목을 채운다(그 덩이에 MAIL_SUBJECTS 의 말이 있으면 그 제목, 없으면 MAIL_SUBJECT)"""
    subject = next((s for word, s in MAIL_SUBJECTS.items() if word in text), MAIL_SUBJECT)
    out, last = [], 0
    for m in BOLD.finditer(text):
        out.append(links(text[last:m.start()], subject))
        out.append(f"<strong>{links(m.group(1), subject)}</strong>")
        last = m.end()
    out.append(links(text[last:], subject))
    return "".join(out)


def links(text: str, subject: str) -> str:
    """글 조각 → HTML(글 속 주소·메일·기관 누리집을 링크로)"""
    out, last = [], 0
    for m in LINK.finditer(text):
        out.append(html.escape(text[last:m.start()], quote=False))
        s = m.group(0)
        if "@" in s and not s.startswith("http"):
            href = f"mailto:{s}" + (f"?subject={quote(subject)}" if s == DEV_MAIL else "")
        elif s.startswith("http"):
            href = s
        else:
            href = f"https://{s}"
        out.append(f'<a href="{html.escape(href)}">{html.escape(s, quote=False)}</a>')
        last = m.end()
    out.append(html.escape(text[last:], quote=False))
    return "".join(out)


def body(md: str, revised: str = "") -> tuple[str, str]:
    """원문 → (h1 글, 본문 HTML). h1 바로 아래 '시행일: …' 문단은 날짜 줄로. 줄 머리의 '1. ' 꼴은 번호 목록(ol)"""
    md = re.sub(r"<!--.*?-->", "", md, flags=re.S).strip("\n")
    title, parts, para, stack = "", [], [], []  # stack: 열린 목록의 들여쓰기 깊이
    numbered = []  # 열린 번호 목록(하나, 줄 머리에서만)

    def close_para():
        if para:
            text = " ".join(para)
            cls = ' class="date"' if text.startswith("시행일:") and not any(p.startswith("<h2") for p in parts) else ""
            parts.append(f"<p{cls}>{inline(text)}</p>")
            para.clear()

    def close_lists(depth: int = -1):
        while stack and stack[-1] > depth:
            stack.pop()
            parts.append("</li></ul>")

    def close_numbered():
        if numbered:
            numbered.clear()
            parts.append("</li></ol>")

    for line in resolve(md, revised).split("\n"):
        if not line.strip():
            close_para()
            continue
        n = re.match(r"^(\d+)\. (.*)$", line)
        if n and not stack:
            close_para()
            if numbered:
                parts.append("</li>")
            else:
                parts.append("<ol>")
                numbered.append(True)
            parts.append(f"<li>{inline(n.group(2).strip())}")
            continue
        close_numbered()
        m = re.match(r"^( *)- (.*)$", line)
        if m:
            close_para()
            depth = len(m.group(1)) // 2
            if stack and stack[-1] == depth:
                parts.append("</li>")
            elif stack and stack[-1] > depth:
                close_lists(depth)
                parts.append("</li>")
            if not stack or stack[-1] < depth:
                parts.append("<ul>")
                stack.append(depth)
            parts.append(f"<li>{inline(m.group(2).strip())}")
            continue
        close_lists()
        if line.startswith("#### "):
            close_para()
            parts.append(f"<h2>{inline(line[5:].strip())}</h2>")
        elif line.startswith("### "):
            close_para()
            title = line[4:].strip()
        else:
            para.append(line.strip())
    close_para()
    close_lists()
    close_numbered()
    return title, "\n".join(parts)


def page(name: str) -> str:
    folder, title, description, (other, other_title) = PAGES[name]
    up = "../" * (folder.count("/") + 1)  # 웹 앱 첫 주소(…/tt-wizard/)까지
    revised = TERMS_REVISED if name.split("-")[0] == "terms" else REVISED  # 이용 규칙의 이전 판도 '…전날까지'는 이용 규칙 시행일
    h1, content = body((SRC / f"{name}.md").read_text(encoding="utf-8"), revised)
    if h1 not in (title, f"TT Wizard {title}"):
        raise SystemExit(f"{name}.md: 맨 위 제목이 '{title}' 이 아니다: {h1!r}")
    if "【" in content or "】" in content:
        raise SystemExit(f"{name}.md: 풀지 않은 【】 가 있다")
    return f"""<!doctype html>
<!-- scripts/legal_pages.py 가 docs/legal/{name}.md 로 만든 파일이다. 여기를 고치지 말고 원문을 고친 뒤 다시 만든다 -->
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>{html.escape(title)} · TT Wizard</title>
<meta name="description" content="{html.escape(description)}">
<link rel="icon" href="{up}icons/favicon.svg" type="image/svg+xml">
<link rel="icon" href="{up}icons/favicon-32.png" sizes="32x32" type="image/png">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css" crossorigin>
<style>{STYLE}</style>
</head>
<body>
<div class="page">
<header class="top"><a href="{up}"><picture><source srcset="{up}icons/wordmark-dark.svg" media="(prefers-color-scheme: dark)"><img src="{up}icons/wordmark.svg" alt="TT Wizard" width="124" height="29"></picture></a></header>
<main>
<h1>{html.escape(h1)}</h1>
{content}
</main>
<nav class="bottom" aria-label="다른 페이지"><a href="{up}{other}/">{html.escape(other_title)}</a><a href="{up}">TT Wizard 열기</a></nav>
</div>
</body>
</html>
"""


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--check", action="store_true", help="만든 파일이 원문과 같은지만 본다")
    args = ap.parse_args(argv)
    stale = []
    for name, (folder, *_rest) in PAGES.items():
        out = WEB / folder / "index.html"
        text = page(name)
        if args.check:
            if not out.exists() or out.read_text(encoding="utf-8") != text:
                stale.append(str(out.relative_to(ROOT)))
            continue
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(text, encoding="utf-8", newline="\n")
        print(f"  {out.relative_to(ROOT)}")
    if stale:
        print("원문과 다르다(python scripts/legal_pages.py 로 다시 만든다): " + ", ".join(stale), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
