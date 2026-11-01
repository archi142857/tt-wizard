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
