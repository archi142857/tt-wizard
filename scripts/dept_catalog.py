"""학과 목록(처음 화면의 학과와 학번, 디자인 121판): data/requirements/ → data/requirements/catalog.json

update103(11/13, 디자인·프론트엔드 요청). 졸업 요건 과정 목록(index.json)과 과정 파일, 지난 편람(data/history/)에서 만든다.
조사 원본 없이 레포 자료만으로 다시 만들 수 있다. 형식은 docs/requirements.md '학과 목록'.

- 대학 → 학과(부) → 전공. 보이는 이름은 괄호 설명을 뺀 것, 정보 줄에 쓸 짧은 이름(short).
- 학과(부)마다 전공으로 나뉘는지(splits), 입학 뒤 전공을 정하는지(undecided: '아직 안 정함'), '전공 진입'을 묻는지(ask_entry:
  입학 뒤 전공을 정하거나 판이 전공 진입 연도로 갈리는 전공이 있으면), 광역(wide), 주전공을 여럿 두는지(multi_major: 자유전공학부).
- 다른 전공 묶음(연합·연계·학생설계전공)은 대학 목록 끝(others).
- 편람 개설학과 이름 → 학과(부)·전공(depts): 지난 시간표의 전필·전선 과목으로 주전공을 미리 채울 때.
  같은 학과를 쓰는 전공은 과목번호 앞자리(prefixes)로 가르고, 못 가르면 학과(부)까지만.

python scripts/dept_catalog.py [--requirements data/requirements] [--history data/history]
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
REQ = ROOT / "data" / "requirements"
HISTORY = ROOT / "data" / "history"

# 대학 차례(학교 누리집의 단과대학 차례). 목록에 없는 대학은 이 뒤에 index 차례로
COLLEGES = ["인문대학", "사회과학대학", "자연과학대학", "간호대학", "경영대학", "공과대학", "농업생명과학대학", "미술대학", "사범대학",
            "생활과학대학", "수의과대학", "약학대학", "음악대학", "의과대학", "치의학대학원", "학부대학", "첨단융합학부"]
OTHERS = ["연합전공", "연계전공", "학생설계전공(복수전공)"]  # 대학 목록 끝의 다른 전공 묶음
SKIP_UNITS = {"혁신공유학부"}  # 교과인증과정: 소속 학생이 없고 복수·부전공도 아니다(docs/requirements.md)
AT_ENTRY = ("입학 때", "모집단위")  # 입학할 때 전공이 정해지는 학과(부): '아직 안 정함'·'전공 진입'을 묻지 않는다


def plain(name: str | None) -> str:
    """괄호 설명을 뺀 이름('국사학과(2022학번까지; …)' → '국사학과', '건축학전공(5년제)' → '건축학전공')"""
    out, depth = [], 0
    for ch in name or "":
        depth += ch == "("
        if depth == 0:
            out.append(ch)
        depth -= ch == ")" and depth > 0
    return " ".join("".join(out).split())


def unit_id(college: str, unit: str) -> str:
    return "u-" + hashlib.sha1(f"{college}|{unit}".encode("utf-8")).hexdigest()[:8]


def program_name(p: dict) -> str:
    """학과(부) 안에서 보일 전공 이름: 괄호를 빼고 앞에 붙은 학과 이름도 뺀다('작곡과 지휘전공' → '지휘전공')"""
    name, unit = plain(p["program"]), plain(p["unit"])
    if name.startswith(unit + " ") and len(name) > len(unit) + 1:
        name = name[len(unit) + 1:]
    return name


def known_depts(history: Path) -> set[str]:
    out = set()
    for f in history.glob("*.json"):
        out |= {c[2] for c in json.loads(f.read_text(encoding="utf-8")).get("courses", []) if c[2]}
    return out


def build(req: Path = REQ, history: Path = HISTORY) -> dict:
    index = json.loads((req / "index.json").read_text(encoding="utf-8"))
    files = {p.stem: json.loads(p.read_text(encoding="utf-8")) for p in (req / "programs").glob("*.json")}
    depts_known = known_depts(history)
    units: dict[tuple[str, str], list[dict]] = {}
    for p in index["programs"]:
        if p["unit"] in SKIP_UNITS:
            continue
        units.setdefault((p["college"], p["unit"]), []).append(p)
    colleges: dict[str, list[dict]] = {}
    others, programs, dept_map = [], {}, {}
    for (college, unit), ps in units.items():
        uid = unit_id(college, unit)
        when = ps[0].get("splits_when") or ""
        splits = len(ps) > 1
        wide = "광역" in unit
        undecided = splits and not any(k in when for k in AT_ENTRY)
        by_major_entry = [p["id"] for p in ps if any(str(v.get("basis", "")).startswith("전공 진입")
                                                     for v in files.get(p["id"], {}).get("versions") or [])]
        shown = plain(unit) if plain(unit) != college or len(ps) > 1 else program_name(ps[0])  # '사범대학' 안의 융합학습과학전공
        entry = {"id": uid, "name": shown, "splits": splits, "undecided": undecided, "ask_entry": undecided or bool(by_major_entry),
                 "wide": wide, "multi_major": plain(unit) == "자유전공학부", "programs": [p["id"] for p in ps], "when": when or None,
                 "exists_for": span([p["exists_for"] for p in ps])}
        group = college == "다전공" or unit in OTHERS
        for p in ps:
            f = files.get(p["id"], {})
            cr = (f.get("versions") or [{}])[0].get("credits") or {}
            name = program_name(p)
            if group:
                short = name if name.endswith("전공") else f"{plain(unit)} {name}"
            else:
                short = name if splits else plain(unit)
            programs[p["id"]] = {
                "name": name, "short": short, "unit": uid, "college": None if group else college,
                "kind": p["kind"], "version_key": p["version_key"], "major_entry": p["id"] in by_major_entry,
                "exists_for": p["exists_for"],
                "double": cr.get("double"), "minor": cr.get("minor"), "data": p["data"]}
            for d in f.get("depts") or []:
                hit = dept_map.setdefault(d, {"units": [], "programs": []})
                hit["programs"].append({"id": p["id"], "prefixes": f.get("code_prefixes") or []})
                if uid not in hit["units"]:
                    hit["units"].append(uid)
        if not group:  # 학과 칸을 비운 전공(번호 앞자리로 못 가름)도 학과(부) 이름이 편람 학과면 학과(부)까지는 잇는다
            name = plain(unit)
            if name in depts_known:
                hit = dept_map.setdefault(name, {"units": [], "programs": []})
                if uid not in hit["units"]:
                    hit["units"].append(uid)
        (others if group else colleges.setdefault(college, [])).append(entry)
    order = COLLEGES + [c for c in colleges if c not in COLLEGES]
    return {
        "checked_on": index.get("checked_on"),
        "colleges": [{"name": c, "units": colleges[c]} for c in order if c in colleges],
        "others": sorted(others, key=lambda u: OTHERS.index(u["name"]) if u["name"] in OTHERS else len(OTHERS)),
        "programs": programs,
        "depts": dict(sorted(dept_map.items())),
        "note": "보이는 이름은 괄호 설명을 뺀 것. exists_for 는 과정이 있던 학번(null 은 모름). double·minor 는 복수·부전공 학점(null 은 자료에 없음: "
                "받지 않거나 모름). 혁신공유학부(교과인증과정)는 넣지 않았다. docs/requirements.md '학과 목록'",
    }


def span(spans: list) -> list | None:
    known = [s for s in spans if s]
    if not known:
        return None
    return [min(s[0] for s in known), max(s[1] for s in known)]


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--requirements", default=str(REQ))
    ap.add_argument("--history", default=str(HISTORY))
    args = ap.parse_args()
    req = Path(args.requirements)
    cat = build(req, Path(args.history))
    (req / "catalog.json").write_text(json.dumps(cat, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    n_units = sum(len(c["units"]) for c in cat["colleges"])
    print(f"학과 목록: 대학 {len(cat['colleges'])}개 · 학과(부) {n_units}개 · 다른 전공 묶음 {len(cat['others'])}개 · "
          f"과정 {len(cat['programs'])}개 · 편람 학과 이름 {len(cat['depts'])}개 → {req / 'catalog.json'}")


if __name__ == "__main__":
    main()
