"""버그 제보·기능 제안 양식(.github/ISSUE_TEMPLATE, update73)과 앱이 여는 주소의 약속(docs/feedback.md).

앱 정보 탭의 '의견 보내기'는 issues/new?template=<양식>&title=…&what=…&app=… 를 연다. GitHub 는 양식의 글 칸을 그 id 로 채우므로
양식의 id·제목 머리말·라벨이 문서(와 앱)가 쓰는 것과 같아야 한다. PyYAML 이 있으면 양식을 읽어 보고, 없으면 글자로만 본다."""
import re
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
FORMS = ROOT / ".github" / "ISSUE_TEMPLATE"
WANT = {  # 양식 → (제목 머리말, 라벨, 글 칸 id 차례, 꼭 채울 칸)
    "bug.yml": ("[버그] ", ["bug"], ["what", "steps", "app"], {"what"}),
    "idea.yml": ("[제안] ", ["enhancement"], ["what", "why", "app"], {"what"}),
    "source.yml": ("[출처] ", ["documentation"], ["program", "row", "url", "what", "app"], {"url"}),  # 졸업 요건 출처 알려 주기(update107)
}
APP_FORMS = ("bug.yml", "idea.yml")  # 의견 보내기 화면이 늘 쓰는 양식. source.yml 은 졸업 요건 탭의 '출처 알려 주기'가 쓴다


def test_issue_forms_match_feedback_contract():
    doc = (ROOT / "docs" / "feedback.md").read_text(encoding="utf-8")
    assert sorted(p.name for p in FORMS.glob("*.yml")) == sorted(WANT)
    for name, (title, labels, ids, required) in WANT.items():
        text = (FORMS / name).read_text(encoding="utf-8")
        assert f'title: "{title}"' in text and f"labels: {labels}".replace("'", '"') in text
        assert re.findall(r"^\s+id: (\w+)$", text, re.M) == ids
        assert "개인정보" in text  # 맨 위 알림: 올린 글은 누구나 본다
        assert f"template={name}&title=<{title.strip()}" in doc  # 문서의 주소가 같은 양식·머리말
        for i in ids:
            assert f"`{i}`" in doc or f"{i}=" in doc
        try:
            import yaml
        except ImportError:
            continue
        form = yaml.safe_load(text)
        assert form["name"] and form["description"] and form["title"] == title and form["labels"] == labels
        fields = [b for b in form["body"] if b["type"] != "markdown"]
        assert [b["id"] for b in fields] == ids and all(b["type"] in ("textarea", "input") for b in fields)
        assert {b["id"] for b in fields if b.get("validations", {}).get("required")} == required
        assert all(b["attributes"]["label"] for b in fields)


def test_app_feedback_url_uses_forms():
    """앱이 의견 보내기를 넣었으면 같은 양식·칸으로 연다(넣기 전에는 건너뛴다)"""
    app = (ROOT / "web" / "js" / "app.js").read_text(encoding="utf-8")
    if "issues/new" not in app:
        pytest.skip("앱에 아직 의견 보내기가 없다")
    assert "github.com/Archi142857/tt-wizard/issues/new" in app
    for name in APP_FORMS:
        assert name in app
    assert "what" in app and "labels=" not in app
    if "source.yml" in app:  # 출처 알려 주기를 넣었으면 과정·줄 칸으로 연다(학과·학번·성적은 넣지 않는다, 법무 11/14)
        assert "program" in app and "row" in app


def test_source_form_notice():
    """출처 알려 주기 양식의 맨 위 알림(법무 11/14): 공개 문서 주소만, 개인정보 적지 않기, 누구나 볼 수 있음, 공개 문서인지 확인하고 사실만 옮김"""
    text = (FORMS / "source.yml").read_text(encoding="utf-8")
    for want in ("공개된 학교 문서 주소만 적어 주세요", "이름·학번·성적·이수 내역은 적지 마세요", "누구나 볼 수 있어요", "그 문서의 사실만",
                 "로그인해야 보이는 파일"):
        assert want in text


def test_feedback_url_fits_without_length_error():
    """앱 칸 한도(제목 50·내용 500, 디자인 98판)를 다 한글로 채워도 주소가 6,000자 아래다: 그래서 앱에 길이 오류 줄이 없다.
    한글은 주소에서 9자(UTF-8 세 바이트)로 입력칸 한 글자(UTF-16 단위)가 가장 길어지는 경우다. quote 는 encodeURIComponent 보다 더 많이 바꿔 넉넉하다"""
    from urllib.parse import quote

    def url(form, title, what, app):
        enc = lambda v: quote(v, safe="")  # noqa: E731
        return f"https://github.com/Archi142857/tt-wizard/issues/new?template={form}&title={enc(title)}&what={enc(what)}&app={enc(app)}"

    app = "0.9.0 · Android 14 · 설치한 웹 앱 · 2026년 여름학기"
    longest = max(len(url(form, head + "갈" * 50, "갈" * 500, app)) for form, head in (("bug.yml", "[버그] "), ("idea.yml", "[제안] ")))
    assert longest < 6000, longest
    # 출처 알려 주기: 제목 '[출처] 과정 · 줄'(과정 30자·줄 30자까지), 과정·줄 칸, 내용 500자
    enc = lambda v: quote(v, safe="")  # noqa: E731
    src = (f"https://github.com/Archi142857/tt-wizard/issues/new?template=source.yml&title={enc('[출처] ' + '갈' * 30 + ' · ' + '갈' * 30)}"
           f"&program={enc('갈' * 30)}&row={enc('갈' * 30)}&what={enc('갈' * 500)}&app={enc(app)}")
    assert len(src) < 6000, len(src)
