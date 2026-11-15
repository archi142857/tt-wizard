"""개인정보 처리방침·문의 페이지(web/privacy/, web/support/, update74)와 이용 규칙·계정 삭제 안내(web/terms/, web/delete-account/, update116):
원문(docs/legal/*.md)에서 만든 그대로인지, 문안의 【】 를 다 풀었는지, 링크(글 속 주소·메일·기관 누리집)와 개발자 메일 제목,
앱에 들어가기 전의 기능 줄(의견 보내기, Tachyon으로 보내기)이 빠지는지, 처리방침을 바꾼 판의 시행일·바뀐 기록·이전 판
(web/privacy/2026-11-01/ update81, 2026-11-11/ update99. 11/20 판은 시행하지 않고 11/15 판으로 갈음, update116)."""
import re
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
import legal_pages as lp  # noqa: E402


def test_pages_are_built_from_sources():
    assert lp.main(["--check"]) == 0  # 원문을 고쳤으면 python scripts/legal_pages.py


@pytest.mark.parametrize("name", ["privacy", "support", "terms", "delete-account", "privacy-2026-11-01", "privacy-2026-11-11"])
def test_page_shape(name):
    folder, title, *_ = lp.PAGES[name]
    text = (ROOT / "web" / folder / "index.html").read_text(encoding="utf-8")
    up = "../" * (folder.count("/") + 1)  # 이전 판(privacy/2026-11-01/)은 두 칸 위가 웹 앱
    assert f'<a href="{up}"><picture><source srcset="{up}icons/wordmark-dark.svg"' in text and f'<a href="{up}">TT Wizard 열기</a>' in text
    h1 = f"TT Wizard {title}" if name in ("terms", "delete-account") else title  # 이용 규칙·계정 삭제 안내의 ### 제목은 'TT Wizard …'
    assert '<html lang="ko">' in text and f"<h1>{h1}</h1>" in text and f"<title>{title} · TT Wizard</title>" in text
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
    # 바꾼 판(update81·99·116): 맨 위 시행일은 이 판의 것, 17절에 판마다 시행일과 바뀐 것, 지난 판은 이전 판 링크
    assert f'<p class="date">시행일: {lp.REVISED}</p>' in text and text.count(lp.REVISED) == 2 and text.count(lp.EFFECTIVE) == 1
    old = "https://archi142857.github.io/tt-wizard/privacy/2026-11-01/"
    assert f'<li>{lp.EFFECTIVE} 처음 시행(이전 판: <a href="{old}">{old}</a>)' in text
    old = "https://archi142857.github.io/tt-wizard/privacy/2026-11-11/"
    assert "<li>2026년 11월 11일 비공개 테스트 신청" in text and "안드로이드 공유 화면의 앱 단추를 더하고" in text
    assert f'고쳤습니다(3·8절). 이전 판: <a href="{old}">{old}</a>' in text
    # 11/15 판(지금 다 열기, 법무 11/15 오전): 이 판의 줄, 11/20 판(테스트용 구글 그룹)은 시행하지 않고 갈음, 새 기능은 켤 때 알리고 바로 시행
    assert f"<li>{lp.REVISED} 로그인(계정과 친구)을 더하고, 베타 테스터 닉네임, 기기에만 두는 학과·학번·들은 과목·성적" in text
    assert "11월 13일에 알린 11월 20일 판(테스트용 구글 그룹)은 그룹을 열지 않아 시행하지 않고 이 판으로 갈음했습니다.\n</li>" in text
    assert "다만 새 기능을 켜는 분에게만 해당하는 내용은 그 기능을 켤 때 화면에서 알리고 바로 시행합니다." in text
    assert "2026년 11월 20일" not in text
    # 공유 카드가 앱에 들어가서(프론트엔드 ui100a, update83) 1절 기기 안 줄이 이 판에 있다
    assert "<li>공유 화면의 앱 단추(안드로이드): 공유 화면에 카카오톡·인스타그램·문자 단추와" in text
    for site in lp.SITES:
        assert f'href="https://{site}"' in text
    assert 'href="mailto:privacy@github.com"' in text and 'href="https://support.google.com/policies?p=privpol_privts"' in text


def test_feedback_lines_wait_for_app(monkeypatch):
    """【앱에 들어간 뒤에 넣음】: 그 기능이 앱에 없으면 줄·문장을 빼고, 들어간 판에서는 표시 없이 넣는다. 기능은 글에 든 낱말로 찾는다
    (의견 보내기: 처리방침 12절 줄(졸업 요건 '출처 알려 주기' 문장 포함)과 문의 페이지 문장).
    【Tachyon 처리방침이 올라간 뒤에 넣음】: 'Tachyon으로 보내기'를 켠 판(TACHYON_IN_APP)에서만 1절 줄을 넣는다(update116, 지금은 꺼짐)"""
    cases = (("FEEDBACK_IN_APP", "privacy", "정보 탭의 ‘의견 보내기’는"), ("FEEDBACK_IN_APP", "privacy", "졸업 요건의 ‘출처 알려 주기’도 같은 길이며"),
             ("FEEDBACK_IN_APP", "support", "‘의견 보내기’를 누르면 같은 양식이 열립니다"), ("TACHYON_IN_APP", "privacy", "<li>Tachyon으로 보내기: 공유 화면에서"))
    for flag, name, words in cases:
        monkeypatch.setattr(lp, flag, False)
        assert words not in lp.page(name)
        monkeypatch.setattr(lp, flag, True)
        later = lp.page(name)
        assert words in later and "【" not in later
    monkeypatch.undo()
    assert not lp.TACHYON_IN_APP and "Tachyon으로 보내기:" not in (ROOT / "web" / "privacy" / "index.html").read_text(encoding="utf-8")
    with pytest.raises(SystemExit):
        lp.later_on("어느 기능인지 모르는 줄 【앱에 들어간 뒤에 넣음】")


def test_old_version_stays_as_published():
    """이전 판(17절 '이전 판도 볼 수 있게 둡니다'): 올렸던 글을 풀어 둔 채로 둔다. 【】 는 마지막 이전 판의 '…전날까지' 하나(지금 판 시행일)뿐이고
    그 앞 이전 판은 다음 판 시행일로 굳혔다(update99). 판마다 그때 들어 있던 줄이 있고, 지금 판으로 가는 링크가 있다"""
    for name, effective, until, ending in (("2026-11-01", "2026년 11월 1일", "2026년 11월 11일", "이전 판이에요"),
                                           ("2026-11-11", "2026년 11월 11일", lp.REVISED, "이전 판입니다")):
        src = re.sub(r"<!--.*?-->", "", (ROOT / "docs" / "legal" / f"privacy-{name}.md").read_text(encoding="utf-8"), flags=re.S)
        assert re.findall(r"【[^】]*】", src) == ([] if name == "2026-11-01" else ["【이 판 시행일】"]), name
        text = (ROOT / "web" / "privacy" / name / "index.html").read_text(encoding="utf-8")
        assert f'<p class="date">시행일: {effective}</p>' in text and f"{effective}부터 {until} 전날까지의 {ending}" in text
        assert "정보 탭의 ‘의견 보내기’는" in text and "구글 그룹" not in text
        assert '<a href="../../privacy/">지금 판 개인정보 처리방침</a>' in text
        assert ("구글 설문지" in text) == (name == "2026-11-11")


def test_login_version_lines():
    """11/15 판(문서 2-1절, 법무 11/15 오전): 로그인(계정과 친구)은 따로 절 없이 1·2·3·4·5·6·7·8·9·11·12·14·15절에 줄을 더했다.
    문안의 【백엔드 확인】은 백엔드가 확인하고 지웠다(Google 계정 이름·사진 주소는 Firebase 인증에 남는다). 테스트용 구글 그룹은 열지 않아 17절 갈음 줄에만.
    법무 11/15 낮에 더한 것(서울 저장의 범위, 이름·사진 주소는 화면에 안 씀, 로그인 중계 페이지)과 백엔드 사실(180일은 서버 자료도, 닉네임#번호가 보이는 사람)"""
    text = (ROOT / "web" / "privacy" / "index.html").read_text(encoding="utf-8")
    for words in ("로그인은 고를 수 있고, 로그인하지 않으면 앱에 넣은 과목·시간표·메모는 쓰는 사람의 기기 안에만 있고",
                  "로그인하면 서버에 두는 것(계정과 친구. 로그인은 고를 수 있습니다)",
                  "로그인 서비스가 함께 두는 Google 계정 이름과 프로필 사진 주소(앱 화면에는 쓰지 않습니다), 학교 계정(snu.ac.kr)인지",
                  "교수 이름, 출발·도착 지점, 학과·학번, 성적은 올리지 않습니다.\n</li>",
                  "‘친구에게 숨기기’를 고른 과목·일정은 이름·강의실 없이 시간만 회색 칸으로 보입니다",
                  "(개인정보 보호법 제15조 제1항 제4호)", "Google LLC의 Firebase Authentication(미국.",
                  "계정 이름·프로필 사진 주소, 닉네임#번호(자료 이름), 접속 기록(IP 주소, 기기·브라우저 정보)",
                  "Google Cloud Firestore)은 서울(asia-northeast3)에 저장합니다. 다만 자료 이름으로 쓰는 고유 번호(uid)와 닉네임#번호, 서비스 운영 기록은 Google이 나라 밖에서",
                  "그 닉네임#번호로 찾는 로그인한 사람에게도 보입니다", "지운 계정과 서버 자료가 Google(Firebase)의 운영·백업 시스템에서",
                  "로그인 화면과 로그인 중계 페이지(tt-wizard.firebaseapp.com)는 Google(Firebase)이 띄우며",
                  "정보 화면 맨 위 ‘계정 삭제’(또는 ‘계정’ → ‘계정 삭제’)를 누르고 묻는 창에서 ‘지우기’를 누르면",
                  "180일까지 걸릴 수 있고", "앱과 웹은 쿠키를 쓰지 않고 분석 도구도 없습니다", "그 화면의 쿠키는 Google의 개인정보 처리방침을 따릅니다.</p>",
                  "비공개 테스트와 로그인은 만 14세 이상만 할 수 있고(로그인할 때 확인합니다)"):
        assert text.count(words) == 1, words
    delete = "https://archi142857.github.io/tt-wizard/delete-account/"
    assert f'계정 삭제 안내(<a href="{delete}">{delete}</a>)대로 메일로 요청해 주십시오' in text
    assert text.count("테스트용 구글 그룹") == 1 and "백엔드" not in text and "【" not in text


def test_terms_and_delete_account_pages():
    """이용 규칙(로그인할 때 '이용 규칙에 동의해요'로 동의받는다)·계정 삭제 안내(Play 데이터 보안의 계정 삭제 주소)와, 문의 페이지의 두 주소 줄(update116)"""
    terms = (ROOT / "web" / "terms" / "index.html").read_text(encoding="utf-8")
    assert re.findall(r"<h2>(\d+)\. ", terms) == [str(i) for i in range(1, 10)]
    assert f'<p class="date">시행일: {lp.TERMS_REVISED}</p>' in terms and f"<li>{lp.TERMS_REVISED} 처음 시행\n</li>" in terms
    assert "Google 계정으로 로그인합니다. 만 14세 이상만 로그인할 수 있습니다." in terms and "서울대학교 공식 서비스가 아닙니다." in terms
    assert '<a href="../privacy/">개인정보 처리방침</a>' in terms
    page = (ROOT / "web" / "delete-account" / "index.html").read_text(encoding="utf-8")
    steps = re.search(r"<ol>(.*?)</ol>", page, flags=re.S).group(1)
    assert steps.count("<li>") == 2 and "‘계정 삭제’(또는 ‘계정’ → ‘계정 삭제’)" in steps and "묻는 창에서 ‘지우기’를 누릅니다" in steps  # 앱 안 길은 번호 목록(디자인 134판)
    ask = "mailto:sanger.lee138@gmail.com?subject=TT%20Wizard%20%EA%B3%84%EC%A0%95%20%EC%82%AD%EC%A0%9C%20%EC%9A%94%EC%B2%AD"  # 'TT Wizard 계정 삭제 요청'
    assert page.count(f'href="{ask}"') == 1 and "받은 날부터 10일 안에 지우고 알려 드립니다" in page
    assert '<p>문의: <a href="mailto:sanger.lee138@gmail.com?subject=TT%20Wizard%20%EB%AC%B8%EC%9D%98">' in page  # 끝의 문의 줄은 따로 문단, 제목은 문의
    assert "지운 계정과 서버 자료는 Google(Firebase)의 운영·백업 시스템에서 180일 안에" in page and "몇 주" in page
    assert "다른 사람이 나를 차단해 둔 기록(그 사람의 차단 목록에 든 고유 번호)은 그 사람의 자료라 남습니다" in page  # 법무 11/15 낮 (나)
    support = (ROOT / "web" / "support" / "index.html").read_text(encoding="utf-8")
    for path in ("delete-account", "terms"):
        url = f"https://archi142857.github.io/tt-wizard/{path}/"
        assert f'<a href="{url}">{url}</a>' in support


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
