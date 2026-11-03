"""개인정보 처리방침·문의 페이지를 웹에 올릴 HTML 로 만든다 (백엔드 update74, 11/1).

원문은 docs/legal/privacy.md·support.md(문서·법무 세션이 공유 폴더 `개인정보_처리방침.md` 2·3절에 쓴 것을 그대로 옮김).
나오는 곳: web/privacy/index.html(https://archi142857.github.io/tt-wizard/privacy/), web/support/index.html(…/support/),
처리방침의 이전 판 web/privacy/2026-11-01/index.html(원문 docs/legal/privacy-2026-11-01.md. 17절 '이전 판도 볼 수 있게 둬요', update81).
스토어(Play 처리방침 칸, App Store 처리방침·지원 주소)와 앱 정보 탭이 이 주소를 쓴다. 앱 묶음에는 넣지 않는다(scripts/build_app.py).

원문에 쓰는 것은 문안에 나오는 만큼만 읽는다: ### 제목(h1), #### 제목(h2), 문단, 글머리표 목록(두 칸 들여 쓰면 안쪽 목록).
글 속 주소(https://…)·메일 주소·기관 누리집(아래 SITES)은 링크로, 개발자 메일은 앱처럼 제목 'TT Wizard 문의'를 채운다.
【올리는 날】은 처음 시행일 EFFECTIVE, 【이 판 시행일】은 지금 판의 시행일 REVISED 로 채운다(처리방침을 바꾸면 시행일 7일 전에 알린다: 17절).
【앱에 들어간 뒤에 넣음】이 붙은 줄과 【앱에 들어간 뒤에 넣음: …】 문장은 그 기능이 앱에 들어간 판에서만 넣는다(LATER_FEATURES: 글에 든 낱말로 기능을 찾는다).

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
# 지금 판의 시행일(맨 위 시행일·17절 기록의 【이 판 시행일】). 11/3 법무·문서가 비공개 테스트 신청·오픈채팅방·테스트 의견을 더한 판(update81).
# 17절 '바꾸면 시행일 7일 전에 이 페이지에 알려요'(사용자 11/1): 11/3 에 올리면 11/10. 처리방침을 다시 바꾸면 이 날짜와 이전 판(ARCHIVES)을 같이 고친다
REVISED = "2026년 11월 10일"
FEEDBACK_IN_APP = True  # 앱 정보 탭에 '의견 보내기'가 들어간 판에서 True. 프론트엔드 e9a70a9(11/1)에 들어가 켰다(update76)
SHARE_APPS_IN_APP = False  # 공유 화면의 앱 단추(update80 의 TTW_APP.shareTargets, 프론트엔드 공유 카드 115판)가 앱에 들어간 판에서 True
# 【앱에 들어간 뒤에 넣음】이 붙은 줄·문장이 어느 기능인지: 그 글에 든 낱말 → 켜는 이름(위). 낱말이 없거나 둘 이상이면 멈춘다
LATER_FEATURES = {"의견 보내기": "FEEDBACK_IN_APP", "공유 화면의 앱 단추": "SHARE_APPS_IN_APP"}
DEV_MAIL = "sanger.lee138@gmail.com"
MAIL_SUBJECT = "TT Wizard 문의"  # 앱 개발자 정보의 메일 링크와 같다(web/js/app.js DEV_MAIL_HREF)
SITES = ("privacy.kisa.or.kr", "www.kopico.go.kr", "www.spo.go.kr", "ecrm.police.go.kr")  # 16절 기관(글에는 https:// 없이)

PAGES = {  # 원문 → (나오는 폴더, 문서 제목, 설명, 맞은편 페이지)
    "privacy": ("privacy", "개인정보 처리방침", "TT Wizard가 다루는 개인정보와 요청하는 방법", ("support", "문의")),
    "support": ("support", "문의", "TT Wizard 버그 제보·기능 제안과 문의", ("privacy", "개인정보 처리방침")),
    # 이전 판(17절 '이전 판도 볼 수 있게 둬요'): 올렸던 글을 풀어 둔 채로 두고 고치지 않는다. 맞은편은 지금 판
    "privacy-2026-11-01": ("privacy/2026-11-01", "개인정보 처리방침", "TT Wizard 개인정보 처리방침의 이전 판(2026년 11월 1일 시행)",
                           ("privacy", "지금 판 개인정보 처리방침")),
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
ul { margin: 0 0 12px; padding-left: 1.25rem; }
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


def resolve(text: str) -> str:
    """【】 자리를 판에 맞게 푼다"""
    text = text.replace("【올리는 날】", EFFECTIVE).replace("【이 판 시행일】", REVISED)
    text = LATER_INLINE.sub(lambda m: " " + m.group(1) if later_on(m.group(1)) else "", text)
    lines = []
    for line in text.split("\n"):
        if LATER in line:
            if not later_on(line):
                continue
            line = line.replace(" " + LATER, "").replace(LATER, "")
        lines.append(line)
    return "\n".join(lines)


def inline(text: str) -> str:
    """글 한 덩이 → HTML(링크 넣기)"""
    out, last = [], 0
    for m in LINK.finditer(text):
        out.append(html.escape(text[last:m.start()], quote=False))
        s = m.group(0)
        if "@" in s and not s.startswith("http"):
            href = f"mailto:{s}" + (f"?subject={quote(MAIL_SUBJECT)}" if s == DEV_MAIL else "")
        elif s.startswith("http"):
            href = s
        else:
            href = f"https://{s}"
        out.append(f'<a href="{html.escape(href)}">{html.escape(s, quote=False)}</a>')
        last = m.end()
    out.append(html.escape(text[last:], quote=False))
    return "".join(out)


def body(md: str) -> tuple[str, str]:
    """원문 → (h1 글, 본문 HTML). h1 바로 아래 '시행일: …' 문단은 날짜 줄로"""
    md = re.sub(r"<!--.*?-->", "", md, flags=re.S).strip("\n")
    title, parts, para, stack = "", [], [], []  # stack: 열린 목록의 들여쓰기 깊이

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

    for line in resolve(md).split("\n"):
        if not line.strip():
            close_para()
            continue
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
    return title, "\n".join(parts)


def page(name: str) -> str:
    folder, title, description, (other, other_title) = PAGES[name]
    up = "../" * (folder.count("/") + 1)  # 웹 앱 첫 주소(…/tt-wizard/)까지
    h1, content = body((SRC / f"{name}.md").read_text(encoding="utf-8"))
    if h1 != title:
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
