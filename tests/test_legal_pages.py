"""개인정보 처리방침·문의 페이지(web/privacy/, web/support/, update74)와 이용약관(11/15 판 이름 이용 규칙)·계정 삭제 안내(web/terms/, web/delete-account/, update116):
원문(docs/legal/*.md)에서 만든 그대로인지, 문안의 【】 를 다 풀었는지, 링크(글 속 주소·메일·기관 누리집)와 개발자 메일 제목,
앱에 들어가기 전의 기능 줄(의견 보내기, Tachyon으로 보내기)이 빠지는지, 처리방침을 바꾼 판의 시행일·바뀐 기록·이전 판
(web/privacy/2026-11-01/ update81, 2026-11-11/ update99. 11/20 판은 시행하지 않고 11/15 판으로 갈음, update116.
11/30 판은 update145: 11/23 에 올려 7일 알림, 11/15 판은 privacy/2026-11-15/·terms/2026-11-15/ 이전 판)."""
import re
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
import legal_pages as lp  # noqa: E402


def test_pages_are_built_from_sources():
    assert lp.main(["--check"]) == 0  # 원문을 고쳤으면 python scripts/legal_pages.py
    # 페이지 설명(검색 결과·링크 미리 보기 글)은 라이팅 11/24 글 그대로(update152)
    assert lp.PAGES["terms"][2] == "TT Wizard 서비스 이용약관"
    assert lp.PAGES["privacy"][2] == "TT Wizard가 처리하는 개인정보와 열람, 삭제를 요청하는 방법"


@pytest.mark.parametrize("name", ["privacy", "support", "terms", "delete-account", "privacy-2026-11-01", "privacy-2026-11-11",
                                  "privacy-2026-11-15", "terms-2026-11-15"])
def test_page_shape(name):
    folder, title, *_ = lp.PAGES[name]
    text = (ROOT / "web" / folder / "index.html").read_text(encoding="utf-8")
    up = "../" * (folder.count("/") + 1)  # 이전 판(privacy/2026-11-01/)은 두 칸 위가 웹 앱
    assert f'<a href="{up}"><picture><source srcset="{up}icons/wordmark-dark.svg"' in text and f'<a href="{up}">TT Wizard 열기</a>' in text
    h1 = f"TT Wizard {title}" if name.split("-")[0] in ("terms", "delete") else title  # 이용 규칙·계정 삭제 안내의 ### 제목은 'TT Wizard …'
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
    # 실제 처리방침 꼴(update149, 라이팅 11/23): 원문 N절 = 제N조, 조 제목은 개인정보보호위원회 작성지침의 표준 제목
    assert re.findall(r"<h2>제(\d+)조\(", text) == [str(i) for i in range(1, 18)]
    assert "<h2>제9조(정보주체와 법정대리인의 권리·의무 및 행사방법)</h2>" in text and "<h2>제17조(개인정보 처리방침의 변경)</h2>" in text
    # 바꾼 판(update81·99·116·145): 맨 위 시행일은 이 판의 것, 제17조에 판마다 시행일과 바뀐 것, 지난 판은 이전 방침 링크
    assert f'<p class="date">시행일: {lp.REVISED}</p>' in text and text.count(lp.REVISED) == 2 and text.count(lp.EFFECTIVE) == 1
    old = "https://archi142857.github.io/tt-wizard/privacy/2026-11-01/"
    assert f'<li>{lp.EFFECTIVE} 최초 시행(이전 방침: <a href="{old}">{old}</a>)' in text
    old = "https://archi142857.github.io/tt-wizard/privacy/2026-11-11/"
    assert "<li>2026년 11월 11일 비공개 테스트 신청" in text and "안드로이드 공유 화면의 앱 버튼에 관한 사항을 추가하고" in text
    assert f'수정하였습니다(제3조, 제8조). 이전 방침: <a href="{old}">{old}</a>' in text
    # 11/15 판(지금 다 열기, 법무 11/15 오전): 그 판의 줄, 11/20 판(테스트용 구글 그룹)은 시행하지 않고 갈음, 새 기능은 켤 때 알리고 바로 시행
    assert "<li>2026년 11월 15일 로그인(계정 및 친구)에 관한 사항을 추가하고, 베타 테스터 닉네임, 기기에만 저장하는 정보(학과, 학번, 수강한 과목, 성적)" in text
    old = "https://archi142857.github.io/tt-wizard/privacy/2026-11-15/"
    assert f"11월 13일에 공지한 11월 20일 방침(테스트용 구글 그룹)은 그룹을 개설하지 않아 시행하지 않고 11월 15일 방침으로 갈음하였습니다. 이전 방침: <a href=\"{old}\">{old}</a>" in text
    # 11/30 판(update145, 사용자 11/23 '앞당겨', 법무 11/23. 문체는 update149): 이 판의 줄
    assert f"<li>{lp.REVISED} 계정 번호, 앱 내 닉네임 신고, 친구에게 공개되는 시간표 테마에 관한 사항을 명시하고, 학교 계정 표시가 항상 표시되도록 변경하였습니다." in text
    assert "아울러 방침 전체의 조문 체계와 표현을 정비하였습니다(내용은 같습니다)." in text
    assert "다만, 새로운 기능을 켜는 이용자에게만 적용되는 내용은 해당 기능을 켜는 화면에 이 방침의 링크를 두어 알리고 즉시 시행합니다." in text
    assert "2026년 11월 20일" not in text
    # 공유 카드가 앱에 들어가서(프론트엔드 ui100a, update83) 제1조④ 줄이 이 판에 있다
    assert "<li>공유 화면의 앱 버튼(안드로이드): 공유 화면에 카카오톡, 인스타그램, 문자 버튼과" in text
    for site in lp.SITES:
        assert f'href="https://{site}"' in text
    assert 'href="mailto:privacy@github.com"' in text and 'href="https://support.google.com/policies?p=privpol_privts"' in text


def test_feedback_lines_wait_for_app(monkeypatch):
    """【앱에 들어간 뒤에 넣음】: 그 기능이 앱에 없으면 줄·문장을 빼고, 들어간 판에서는 표시 없이 넣는다. 기능은 글에 든 낱말로 찾는다
    (의견 보내기: 처리방침 제12조 줄(졸업 요건 '출처 알려 주기' 문장 포함)과 문의 페이지 문장).
    【Tachyon 처리방침이 올라간 뒤에 넣음】: 'Tachyon으로 보내기'를 켠 판(TACHYON_IN_APP)에서만 제1조④ 줄을 넣는다(update116, 지금은 꺼짐)"""
    cases = (("FEEDBACK_IN_APP", "privacy", "정보 화면의 ‘의견 보내기’는"), ("FEEDBACK_IN_APP", "privacy", "졸업 요건의 ‘출처 알려 주기’도 같은 방식이며"),
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
                                           ("2026-11-11", "2026년 11월 11일", "2026년 11월 15일", "이전 판입니다"),
                                           ("2026-11-15", "2026년 11월 15일", lp.REVISED, "이전 판입니다")):
        src = re.sub(r"<!--.*?-->", "", (ROOT / "docs" / "legal" / f"privacy-{name}.md").read_text(encoding="utf-8"), flags=re.S)
        assert re.findall(r"【[^】]*】", src) == (["【이 판 시행일】"] if name == "2026-11-15" else []), name
        text = (ROOT / "web" / "privacy" / name / "index.html").read_text(encoding="utf-8")
        assert f'<p class="date">시행일: {effective}</p>' in text and f"{effective}부터 {until} 전날까지의 {ending}" in text
        assert "정보 탭의 ‘의견 보내기’는" in text and ("구글 그룹" in text) == (name == "2026-11-15")  # 11/15 판은 17절 갈음 줄에만
        assert '<a href="../../privacy/">지금 판 개인정보 처리방침</a>' in text
        assert ("구글 설문지" in text) == (name != "2026-11-01")
        assert ("로그인(계정과 친구)" in text) == (name == "2026-11-15") and "닉네임 신고" not in text
    # 이용 규칙도 11/15 판을 이전 판으로(새 판 9절 '이전 판', 문서 11/23). 신고는 그때 메일이었다
    src = re.sub(r"<!--.*?-->", "", (ROOT / "docs" / "legal" / "terms-2026-11-15.md").read_text(encoding="utf-8"), flags=re.S)
    assert re.findall(r"【[^】]*】", src) == ["【이 판 시행일】"]
    text = (ROOT / "web" / "terms" / "2026-11-15" / "index.html").read_text(encoding="utf-8")
    assert '<p class="date">시행일: 2026년 11월 15일</p>' in text and f"2026년 11월 15일부터 {lp.TERMS_REVISED} 전날까지의 이전 판입니다" in text
    assert "규칙에 어긋나는 닉네임은 메일로 신고할 수 있습니다(5절)" in text and '<a href="../../terms/">지금 판 이용약관</a>' in text
    assert "<h1>TT Wizard 이용 규칙</h1>" in text  # 이전 판은 그때 이름 그대로(update149)


def test_login_version_lines():
    """11/15 판(문서 2-1절, 법무 11/15 오전)에서 더한 로그인(계정과 친구) 줄이 지금 판(제1조~제15조)에 다 있다(update149 문체).
    Google 계정 이름·사진 주소는 Firebase 인증에 남는다. 테스트용 구글 그룹은 열지 않아 제17조 갈음 줄에만.
    법무 11/15 낮에 더한 것(서울 저장의 범위, 이름·사진 주소는 화면에 안 씀, 로그인 중계 페이지)과 백엔드 사실(180일은 서버 자료도, 닉네임#번호가 보이는 사람)"""
    text = (ROOT / "web" / "privacy" / "index.html").read_text(encoding="utf-8")
    for words in ("로그인은 선택 사항입니다. 로그인하지 않은 경우 이용자가 서비스에 입력한 과목, 시간표, 메모는 이용자의 기기에만 저장되고 개발자에게 전송되지 않습니다.",
                  "② 로그인한 이용자에 대하여 서버에 저장하는 정보(계정 및 친구 기능)는 다음과 같습니다. 로그인은 선택 사항입니다.",
                  "로그인 서비스가 함께 보관하는 Google 계정 이름 및 프로필 사진 주소(앱 화면에는 사용하지 않습니다), 학교 계정(snu.ac.kr) 여부",
                  "교수 성명, 출발 및 도착 지점, 학과, 학번, 성적은 전송하지 않습니다.\n</li>",
                  "‘친구에게 숨기기’를 선택한 과목과 일정은 이름과 강의실 없이 시간만 회색 칸으로 표시됩니다",
                  "(「개인정보 보호법」 제15조 제1항 제4호)", "Google LLC의 Firebase Authentication(미국.",
                  "계정 이름 및 프로필 사진 주소, 계정 번호 및 닉네임#번호(자료의 식별명), 접속 기록(IP 주소, 기기 및 브라우저 정보)",
                  "(Google Cloud Firestore)는 서울(asia-northeast3)에 저장합니다. 다만, 자료의 식별명으로 사용하는 고유 번호(uid), 계정 번호 및 닉네임#번호와 서비스 운영 기록은 Google이 국외에서",
                  "해당 닉네임#번호로 이용자를 검색하는 로그인 이용자에게도 공개됩니다", "삭제된 계정과 서버 자료가 Google(Firebase)의 운영 및 백업 시스템에서",
                  "로그인 화면과 로그인 중계 페이지(tt-wizard.firebaseapp.com)는 Google(Firebase)이 제공하며",
                  "정보 화면 상단에서 ‘계정 삭제’(또는 ‘계정’ → ‘계정 삭제’)를 누르고 확인 창에서 ‘삭제’를 누르면",
                  "최대 180일이 걸릴 수 있으며", "앱과 웹은 쿠키를 사용하지 않으며 분석 도구도 사용하지 않습니다", "해당 화면의 쿠키에는 Google의 개인정보 처리방침이 적용됩니다.</p>",
                  "비공개 테스트 참가와 로그인은 만 14세 이상만 할 수 있으며(로그인 시 확인합니다)"):
        assert text.count(words) == 1, words
    delete = "https://archi142857.github.io/tt-wizard/delete-account/"
    assert f'계정 삭제 안내(<a href="{delete}">{delete}</a>)에 따라 이메일로 요청하시기 바랍니다' in text
    assert text.count("테스트용 구글 그룹") == 1 and "백엔드" not in text and "【" not in text


def test_report_version_lines():
    """11/30 판(공유 폴더 2-1절, 법무 11/17·11/23, update145. 문체는 update149): 계정 번호, 앱 안 닉네임 신고(항목·쓰임·1년·알리지 않음), 학교 계정 늘 보이기,
    시간표 테마, 수강한 과목과 졸업 요건 표시, 업데이트 확인, 관리자 권한(한 시간에 열 번 — 넣어 본 값은 섞은 h 의 sha256 이라 맨 비밀번호가 아니다)"""
    text = (ROOT / "web" / "privacy" / "index.html").read_text(encoding="utf-8")
    for words in ("닉네임 및 계정 번호(6자리이며 닉네임을 변경하여도 유지됩니다)",
                  "닉네임 신고: 신고인 및 피신고인의 고유 번호(uid), 신고된 닉네임 및 계정 번호, 선택한 신고 사유, 추가로 작성한 내용(작성한 경우), 신고 일시",
                  "닉네임 신고는 이용약관에 위반되는 닉네임 및 친구 요청의 확인과 조치에만 이용합니다.",
                  "닉네임 신고: 처리 완료 후 1년간 보유합니다. 신고인 또는 피신고인이 계정을 삭제하더라도 해당 기간 동안 보유합니다.",
                  "피신고인에게는 신고인이 누구인지 알리지 않습니다.",
                  "수강한 과목 및 졸업 요건 표시: 졸업 요건 미리 보기를 이용하는 경우",
                  "업데이트 확인(안드로이드 앱): 앱을 실행하거나 다시 열 때 기기의 Play 스토어 앱에 새 버전이 있는지 확인하며",
                  "관리자 비밀번호는 1시간에 10회까지만 입력할 수 있습니다."):
        assert text.count(words) == 1, words
    assert "App Check" not in text and "Tachyon으로 보내기:" not in text  # 이 판에 넣지 않은 것(사용자 11/23, Tachyon 처리방침 전)


def test_lawful_basis_and_bold_terms():
    """update147(문서 11/23, 법무 11/23 셋)·update149(라이팅 문체): 11/30 판에 뜻을 또렷하게 한 줄과 처리의 법적 근거(개인정보 보호법 제22조③: 동의 없이 처리하는 것과
    근거를 나눠 공개, 제2조②), 제9조⑥⑦, 제17조 11/30 줄. 이용약관의 중요한 조항 셋(이용 제한·서비스 종료·책임 제한)은 굵게(약관법 제3조, 법무 11/23). 시행일은 11/30 그대로"""
    text = (ROOT / "web" / "privacy" / "index.html").read_text(encoding="utf-8")
    basis = text[text.index("<p>② 개인정보 처리의 법적 근거(「개인정보 보호법」 제15조 제1항)는 다음과 같습니다.</p>"):text.index("<h2>제3조(")]
    assert "<li>정보주체의 동의를 받아 처리하는 개인정보(제1호): 비공개 테스트 참가 신청(구글 설문지), 베타 테스터 닉네임(닉네임 설문)" in basis
    assert basis.count("(제4호)") == 3 and basis.count("(제6호)") == 2  # 로그인·문의·테스트 운영은 제4호, 편람에 공개된 정보·건네받은 측정 기록은 제6호
    for words in ("이는 이용자가 로그인하여 요청한 서비스를 제공하고 이용약관에 따라 서비스를 운영하기 위한 처리입니다(「개인정보 보호법」 제15조 제1항 제4호).",
                  "시간표 사본, 닉네임, 친구 목록은 이용자가 앱에서 전송한 것이고, 닉네임 신고는 신고인이 앱에서 전송한 것입니다.",
                  "⑥ 만 14세 미만 아동의 개인정보는 수집하지 않으므로(제15조) 법정대리인이 따로 권리를 행사할 일은 없습니다.",
                  "⑦ 이용자는 다른 사람의 개인정보를 닉네임이나 일정 제목에 넣어서는 안 됩니다(이용약관 제6조).",
                  "안드로이드 앱의 업데이트 확인, 관리자 권한 및 처리의 법적 근거에 관한 사항을 명시하였습니다"):
        assert text.count(words) == 1, words
    assert '<p class="date">시행일: 2026년 11월 30일</p>' in text
    assert "<strong>" not in text  # 굵게는 이용약관만
    terms = (ROOT / "web" / "terms" / "index.html").read_text(encoding="utf-8")
    strong = re.findall(r"<p><strong>(.*?)</strong></p>", terms, flags=re.S)
    assert [s[:6] for s in strong] == ["② 개발자는", "② 개발자가", "② 개발자는"]  # 제8조②·제9조②·제11조②
    assert "이 약관에 위반되는 정보를 알게 된 경우" in strong[0] and "종료일 30일 전에" in strong[1] and "고의 또는 중대한 과실" in strong[2]
    assert terms.count("<strong>") == 3 and "**" not in terms and "**" not in text
    assert lp.inline("앞 **굵은 sanger.lee138@gmail.com 글** 뒤") == (
        '앞 <strong>굵은 <a href="mailto:sanger.lee138@gmail.com?subject=TT%20Wizard%20%EB%AC%B8%EC%9D%98">sanger.lee138@gmail.com</a> 글</strong> 뒤')


def test_terms_and_delete_account_pages():
    """이용약관(로그인할 때 동의받는다. update149: 이름 '이용약관'과 실제 약관의 조 체계, 사용자·라이팅 11/23)·계정 삭제 안내(Play 데이터 보안의 계정 삭제 주소)와,
    문의 페이지의 두 주소 줄(update116)"""
    terms = (ROOT / "web" / "terms" / "index.html").read_text(encoding="utf-8")
    assert re.findall(r"<h2>제(\d+)조\(", terms) == [str(i) for i in range(1, 14)] and "<h2>부칙</h2>" in terms
    assert "<h1>TT Wizard 이용약관</h1>" in terms and "<title>이용약관 · TT Wizard</title>" in terms
    assert terms.count("이용 규칙") == 1 and "아울러 명칭을 ‘이용 규칙’에서 ‘이용약관’으로 변경하고 조문 체계와 표현을 정비하였습니다(내용은 같습니다)." in terms
    old = "https://archi142857.github.io/tt-wizard/terms/2026-11-15/"
    assert f'<p class="date">시행일: {lp.TERMS_REVISED}</p>' in terms and f"<p>① 이 약관은 {lp.TERMS_REVISED}부터 시행합니다.</p>" in terms
    assert f'<li>2026년 11월 15일 최초 시행(이전 약관: <a href="{old}">{old}</a>)' in terms
    assert f"<li>{lp.TERMS_REVISED} 계정 번호에 관한 사항을 명시하고, 닉네임 신고를 앱에서 할 수 있도록 하였으며" in terms  # 11/30 판(update145)
    assert "친구 메뉴의 ‘닉네임 신고’를 통하여 신고할 수 있습니다. 신고인이 누구인지는 상대방에게 알리지 않습니다." in terms and "메일로 신고" not in terms
    assert "로그인은 Google 계정으로 하며, 만 14세 이상인 경우에만 로그인할 수 있습니다." in terms and "서울대학교의 공식 서비스가 아닙니다." in terms
    assert "친구에게 공개되는 정보의 범위는 개인정보 처리방침 제1조 제3항에서 정합니다." in terms  # 처리방침 제1조③과 같은 날 올린다(법무 11/23)
    assert terms.count("<ol>") == 2 and '<a href="../privacy/">개인정보 처리방침</a>' in terms  # 제2조 정의·제6조 금지 행위는 번호 목록
    page = (ROOT / "web" / "delete-account" / "index.html").read_text(encoding="utf-8")
    steps = re.search(r"<ol>(.*?)</ol>", page, flags=re.S).group(1)
    assert steps.count("<li>") == 2 and "‘계정 삭제’(또는 ‘계정’ → ‘계정 삭제’)" in steps and "확인 창에서 ‘삭제’를 누릅니다" in steps  # 앱 안 길은 번호 목록(디자인 134판)
    assert "‘이 기기의 시간표도 삭제’를 켭니다" in steps and "지우기" not in page  # 버튼 이름 '삭제'(사용자 11/23)
    ask = "mailto:sanger.lee138@gmail.com?subject=TT%20Wizard%20%EA%B3%84%EC%A0%95%20%EC%82%AD%EC%A0%9C%20%EC%9A%94%EC%B2%AD"  # 'TT Wizard 계정 삭제 요청'
    assert page.count(f'href="{ask}"') == 1 and "요청을 받은 날부터 10일 이내에 삭제하고 그 결과를 알려 드립니다" in page
    assert '<p>문의: <a href="mailto:sanger.lee138@gmail.com?subject=TT%20Wizard%20%EB%AC%B8%EC%9D%98">' in page  # 끝의 문의 줄은 따로 문단, 제목은 문의
    assert "삭제된 계정과 서버 자료가 Google(Firebase)의 운영 및 백업 시스템에서 삭제되기까지 최대 180일이 걸릴 수 있습니다." in page and "수 주간" in page  # 처리방침 제4조와 같은 말
    assert "다른 이용자가 내 계정을 차단해 둔 기록(그 이용자의 차단 목록에 있는 내 고유 번호)은 그 이용자의 자료이므로 삭제되지 않습니다" in page  # 법무 11/15 낮 (나)
    # 11/30 판(update146, 문서 11/23 5-1절): 앱 안 닉네임 신고와 같이. 검색용 키는 지우고, 계정 번호는 누구 것인지 없이, 신고는 처리 뒤 1년
    assert "닉네임 및 검색용 키(닉네임#번호), 친구 요청 목록, 친구 목록, 차단 목록, 친구에게 공개되던 사본" in page
    assert "계정 번호(6자리)는 다른 이용자에게 다시 부여되지 않도록 누구의 것이었는지 알 수 없는 상태로 보관합니다." in page
    assert "닉네임 신고는 처리 완료 후 1년간 보관합니다. 신고인 또는 피신고인이 계정을 삭제하더라도 해당 기간 동안 보관합니다." in page
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


# ===== 바뀜 알림 판(data/policy.json → web/data/policy.json, update153) =====
# 프론트엔드 ui163 이 켤 때 받아 알림 제목·[보기]·정보 두 줄 값을 그 판으로 한다. 없으면(404) 앱에 적힌 11/30 판

sys.path.insert(0, str(ROOT))
import export_web as ew  # noqa: E402

GOOD_POLICY = {"next": "2026-12-20", "posted": "2026-12-13", "markTo": "2026-12-27", "docs": ["privacy"]}


def _iso(korean: str) -> str:
    y, m, d = map(int, re.fullmatch(r"(\d{4})년 (\d{1,2})월 (\d{1,2})일", korean).groups())
    return f"{y:04d}-{m:02d}-{d:02d}"


def test_policy_export(tmp_path):
    import json

    src, out = tmp_path / "policy.json", tmp_path / "out.json"
    assert ew.export_policy(src, out) is None and not out.exists()  # 자료가 없으면 만들지 않는다
    src.write_text(json.dumps(GOOD_POLICY, ensure_ascii=False, indent=2), encoding="utf-8")
    assert ew.export_policy(src, out) == GOOD_POLICY
    text = out.read_text(encoding="utf-8")
    assert "\n" not in text and json.loads(text) == GOOD_POLICY
    both = {k: v for k, v in GOOD_POLICY.items() if k != "docs"}  # docs 를 빼면 둘 다
    assert ew.check_policy(both) is None and ew.check_policy({**GOOD_POLICY, "docs": ["terms", "privacy"]}) is None
    assert ew.check_policy({**GOOD_POLICY, "posted": "2026-12-06", "markTo": "2026-12-20"}) is None  # 7일 꼭 맞게, markTo = 시행일


@pytest.mark.parametrize("bad", [
    [],
    {**GOOD_POLICY, "markto": "2026-12-27"},  # 모르는 열쇠(오타)
    {k: v for k, v in GOOD_POLICY.items() if k != "markTo"},
    {**GOOD_POLICY, "next": "2026-12-20T00:00"},
    {**GOOD_POLICY, "next": "2026-12-32"},
    {**GOOD_POLICY, "posted": 20261213},
    {**GOOD_POLICY, "posted": "2026-12-14"},  # 7일이 안 된다(처리방침 17절)
    {**GOOD_POLICY, "markTo": "2026-12-19"},
    {**GOOD_POLICY, "docs": []},
    {**GOOD_POLICY, "docs": ["privacy", "privacy"]},
    {**GOOD_POLICY, "docs": ["support"]},
    {**GOOD_POLICY, "docs": "privacy"},
])
def test_policy_rejects_wrong_shape(tmp_path, bad):
    import json

    assert ew.check_policy(bad)
    src = tmp_path / "policy.json"
    src.write_text(json.dumps(bad, ensure_ascii=False), encoding="utf-8")
    with pytest.raises(SystemExit):
        ew.export_policy(src, tmp_path / "out.json")
    assert not (tmp_path / "out.json").exists()


def test_policy_matches_pages():
    """data/policy.json 을 두면 시행일이 그 문서 페이지의 시행일(legal_pages REVISED·TERMS_REVISED)과 같아야 한다"""
    import json

    path = ROOT / "data" / "policy.json"
    if not path.exists():
        pytest.skip("data/policy.json 없음(앱에 적힌 11/30 판)")
    data = json.loads(path.read_text(encoding="utf-8"))
    assert ew.check_policy(data) is None
    revised = {"privacy": _iso(lp.REVISED), "terms": _iso(lp.TERMS_REVISED)}
    for doc in data.get("docs", ew.POLICY_DOCS):
        assert data["next"] == revised[doc], doc
