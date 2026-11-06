"""개인정보 처리방침·문의 페이지(web/privacy/, web/support/, update74): 원문(docs/legal/*.md)에서 만든 그대로인지, 문안의 【】 를 다 풀었는지,
링크(글 속 주소·메일·기관 누리집)와 개발자 메일 제목, 앱에 들어가기 전의 기능 줄(의견 보내기, 공유 화면의 앱 단추)이 빠지는지,
처리방침을 바꾼 판의 시행일·바뀐 기록·이전 판(web/privacy/2026-11-01/, update81)."""
import re
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
import legal_pages as lp  # noqa: E402


def test_pages_are_built_from_sources():
    assert lp.main(["--check"]) == 0  # 원문을 고쳤으면 python scripts/legal_pages.py


@pytest.mark.parametrize("name", ["privacy", "support", "privacy-2026-11-01"])
def test_page_shape(name):
    folder, title, *_ = lp.PAGES[name]
    text = (ROOT / "web" / folder / "index.html").read_text(encoding="utf-8")
    up = "../" * (folder.count("/") + 1)  # 이전 판(privacy/2026-11-01/)은 두 칸 위가 웹 앱
    assert f'<a href="{up}"><picture><source srcset="{up}icons/wordmark-dark.svg"' in text and f'<a href="{up}">TT Wizard 열기</a>' in text
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
    # 바꾼 판(update81): 맨 위 시행일은 이 판의 것, 17절에 처음 시행(이전 판 링크)과 이 판의 바뀐 것
    assert f'<p class="date">시행일: {lp.REVISED}</p>' in text and text.count(lp.REVISED) == 2 and text.count(lp.EFFECTIVE) == 1
    old = "https://archi142857.github.io/tt-wizard/privacy/2026-11-01/"
    assert f'<li>{lp.EFFECTIVE} 처음 시행(이전 판: <a href="{old}">{old}</a>)' in text
    assert f"<li>{lp.REVISED} 비공개 테스트 신청" in text and "안드로이드 공유 화면의 앱 단추를 더하고" in text
    # 공유 카드가 앱에 들어가서(프론트엔드 ui100a, update83) 1절 기기 안 줄이 이 판에 있다
    assert lp.SHARE_APPS_IN_APP and "<li>공유 화면의 앱 단추(안드로이드): 공유 화면에 카카오톡·인스타그램·문자 단추를" in text
    for site in lp.SITES:
        assert f'href="https://{site}"' in text
    assert 'href="mailto:privacy@github.com"' in text and 'href="https://support.google.com/policies?p=privpol_privts"' in text


def test_feedback_lines_wait_for_app(monkeypatch):
    """【앱에 들어간 뒤에 넣음】: 그 기능이 앱에 없으면 줄·문장을 빼고, 들어간 판에서는 표시 없이 넣는다. 기능은 글에 든 낱말로 찾는다
    (의견 보내기: 처리방침 12절 줄과 문의 페이지 문장, 공유 화면의 앱 단추: 처리방침 1절 기기 안 줄. 서로 따로 켠다)"""
    cases = (("FEEDBACK_IN_APP", "privacy", "정보 탭의 ‘의견 보내기’는"), ("FEEDBACK_IN_APP", "support", "‘의견 보내기’를 누르면 같은 양식이 열립니다"),
             ("SHARE_APPS_IN_APP", "privacy", "공유 화면의 앱 단추(안드로이드)"))
    for flag, name, words in cases:
        monkeypatch.setattr(lp, flag, False)
        assert words not in lp.page(name)
        monkeypatch.setattr(lp, flag, True)
        later = lp.page(name)
        assert words in later and "【" not in later
    monkeypatch.setattr(lp, "FEEDBACK_IN_APP", True)
    monkeypatch.setattr(lp, "SHARE_APPS_IN_APP", False)
    text = lp.page("privacy")
    assert "정보 탭의 ‘의견 보내기’는" in text and "공유 화면의 앱 단추(안드로이드)" not in text  # 17절 바뀐 줄의 말은 표시 없는 글이라 남는다
    with pytest.raises(SystemExit):
        lp.later_on("어느 기능인지 모르는 줄 【앱에 들어간 뒤에 넣음】")


def test_old_version_stays_as_published():
    """이전 판(17절 '이전 판도 볼 수 있게 둬요'): 올렸던 글을 풀어 둔 채로 둔다(【】 는 지금 판 시행일 하나뿐). 의견 보내기 줄이 들어 있고, 지금 판으로 가는 링크가 있다"""
    src = re.sub(r"<!--.*?-->", "", (ROOT / "docs" / "legal" / "privacy-2026-11-01.md").read_text(encoding="utf-8"), flags=re.S)
    assert re.findall(r"【[^】]*】", src) == ["【이 판 시행일】"]
    text = (ROOT / "web" / "privacy" / "2026-11-01" / "index.html").read_text(encoding="utf-8")
    assert '<p class="date">시행일: 2026년 11월 1일</p>' in text and f"2026년 11월 1일부터 {lp.REVISED} 전날까지의 이전 판이에요" in text
    assert "정보 탭의 ‘의견 보내기’는" in text and "구글 설문지" not in text
    assert '<a href="../../privacy/">지금 판 개인정보 처리방침</a>' in text


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
