"""개인정보 처리방침·문의 페이지(web/privacy/, web/support/, update74): 원문(docs/legal/*.md)에서 만든 그대로인지, 문안의 【】 를 다 풀었는지,
링크(글 속 주소·메일·기관 누리집)와 개발자 메일 제목, 의견 보내기 줄이 앱에 들어가기 전에는 빠지는지."""
import re
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
import legal_pages as lp  # noqa: E402


def test_pages_are_built_from_sources():
    assert lp.main(["--check"]) == 0  # 원문을 고쳤으면 python scripts/legal_pages.py


@pytest.mark.parametrize("name", ["privacy", "support"])
def test_page_shape(name):
    folder, title, *_ = lp.PAGES[name]
    text = (ROOT / "web" / folder / "index.html").read_text(encoding="utf-8")
    assert '<html lang="ko">' in text and f"<h1>{title}</h1>" in text and f"<title>{title} · TT Wizard</title>" in text
    assert "【" not in text and "】" not in text
    assert 'name="viewport"' in text and "prefers-color-scheme: dark" in text
    mail = 'href="mailto:sanger.lee138@gmail.com?subject=TT%20Wizard%20%EB%AC%B8%EC%9D%98"'  # 앱 개발자 정보의 메일 링크와 같은 제목
    assert mail in text and "mailto:sanger.lee138@gmail.com\"" not in text
    hrefs = re.findall(r'href="([^"]+)"', text)
    assert all(h.startswith(("https://", "mailto:", "../")) for h in hrefs), hrefs
    assert not re.search(r'href="[^"]*[가-힣]', text)  # 주소 뒤의 한글 조사를 링크에 넣지 않는다


def test_privacy_sections_and_dates():
    text = (ROOT / "web" / "privacy" / "index.html").read_text(encoding="utf-8")
    assert re.findall(r"<h2>(\d+)\. ", text) == [str(i) for i in range(1, 18)]
    assert text.count(lp.EFFECTIVE) == 2  # 맨 위 시행일과 17절 기록
    for site in lp.SITES:
        assert f'href="https://{site}"' in text
    assert 'href="mailto:privacy@github.com"' in text and 'href="https://support.google.com/policies?p=privpol_privts"' in text


def test_feedback_lines_wait_for_app(monkeypatch):
    """【앱에 들어간 뒤에 넣음】: 앱에 의견 보내기가 없으면 처리방침 12절 줄과 문의 페이지 문장을 빼고, 들어간 판에서는 표시 없이 넣는다"""
    for name, words in (("privacy", "정보 탭의 ‘의견 보내기’는"), ("support", "‘의견 보내기’를 누르면 같은 양식이 열려요")):
        monkeypatch.setattr(lp, "FEEDBACK_IN_APP", False)
        assert words not in lp.page(name)
        monkeypatch.setattr(lp, "FEEDBACK_IN_APP", True)
        later = lp.page(name)
        assert words in later and "【" not in later


def test_page_style_follows_design():
    """모양(디자인 규칙 '정보 화면'의 '처리방침·문의 웹 페이지', 11/2 디자인 요청 → update78): 머리는 앱 상단 바와 같은 워드마크(높이 29, 다크는 wordmark-dark,
    머리 높이 56), 제목 t-h2 20/28·절 제목 t-button 17/24(둘 다 heading), 본문 16/24, 카드 모서리 20, 폰 좌우 여백 20"""
    text = (ROOT / "web" / "privacy" / "index.html").read_text(encoding="utf-8")
    assert ('<a href="../"><picture><source srcset="../icons/wordmark-dark.svg" media="(prefers-color-scheme: dark)">'
            '<img src="../icons/wordmark.svg" alt="TT Wizard" width="124" height="29"></picture></a>') in text
    assert all((ROOT / "web" / "icons" / f).exists() for f in ("wordmark.svg", "wordmark-dark.svg"))
    st = lp.STYLE
    assert ".top { display: flex; align-items: center; min-height: 56px; margin-bottom: 4px; }" in st
    assert ".top a { display: inline-flex; align-items: center; min-height: 48px; }" in st and ".top img { display: block; height: 29px; width: auto; }" in st
    assert "h1 { margin: 0 0 4px; color: var(--heading); font-size: 1.25rem; line-height: 1.75rem; letter-spacing: -0.01em; font-weight: 700; }" in st
    assert "h2 { margin: 32px 0 8px; color: var(--heading); font-size: 1.0625rem; line-height: 1.5rem; font-weight: 700; }" in st
    assert "font: 400 1rem/1.5rem " in st and "border-radius: 20px;" in st and "padding: 16px 20px 48px;" in st
    # heading 은 앱 토큰 값(라이트 tt-deep-navy, 다크 #e5e8f0)
    css = (ROOT / "web" / "style.css").read_text(encoding="utf-8")
    assert "--tt-deep-navy: #1d2a78;" in css and "--heading: var(--tt-deep-navy);" in css and "--heading: #e5e8f0;" in css
    assert "--heading: #1d2a78;" in st and "--heading: #e5e8f0;" in st
