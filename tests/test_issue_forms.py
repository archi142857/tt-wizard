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
}


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
    for name in WANT:
        assert name in app
    assert "what" in app and "labels=" not in app
