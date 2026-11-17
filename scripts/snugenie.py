"""스누지니(서울대학교 학생 전공 탐색) 조사 자료 → 과정 파일의 확인 상태(update135, 사용자 11/17 '우리 과처럼 졸업 요건 모르는 건
스누지니든 뭐든 활용해서 알아내라니까'). requirements_import.py --snugenie <공유 폴더/조사_스누지니_20261117/data> 가 부른다.

조사 자료(이수규정.json·전공교과목.json·스누지니코드_앱과정.json)는 레포에 넣지 않는다(법무 11/17: 원문·비교표는 공유 폴더에만,
레포에는 우리 꼴로 옮긴 사실). 여기서 과정 파일에 남기는 것:
  1. 전필 줄: 그 학년도 스누지니 전필 목록 가운데 이 과정 학과의 과목이 판의 전필·논문·지정 과목 줄에 다 있고, 줄의 이 학과 과목이
     모두 스누지니 전필이면 '부분'·'미확인'·'충돌'인 '목록을 다 듣는 전필 줄'을 '확인'으로. 스누지니 목록에는 다른 학과 과목
     (통계학개론 같은 내규 전필)이 안 나와서 그런 과목은 견주지 않는다
  2. 판 나눔: 판의 학번 가운데 스누지니 목록이 빈 학년도(2026 등, '자료 없음'이지 '전필 없음'이 아니다)가 판 끝에 몰려 있으면
     판을 나눠 목록이 있는 학번 쪽만 '확인'
  3. 학점: 그 학년도 글의 '졸업(수료)학점·교양학점·단일전공·다른 전공 병행' 숫자가 판 값과 같으면 판 학점(credits)을 '확인'
  4. 외국어진행강좌 줄(requirement_rules 가 셈 꼴을 단 줄): 그 학년도 글에 같은 과목 수의 외국어(영어)진행 규정이 있으면 '확인'
  5. 출처 '서울대학교 스누지니 전공 탐색 졸업이수규정·전공 교과목(2025학년도, 2026-11-17 확인)'
학년도는 입학(진입) 학년도로 읽는다(조사 README). 입학 연도로 고르는 판만 본다. 고친 것과 남은 차이는 report()(공유 폴더 보고서).
표준 라이브러리만.
"""

from __future__ import annotations

import copy
import json
import re
from collections import defaultdict
from pathlib import Path

CHECKED = "2026-11-17"
TITLE = "서울대학교 스누지니 전공 탐색 졸업이수규정·전공 교과목"
NONE = "졸업이수규정 정보가 없습니다."
LO, HI = 2019, 2026
CODE = re.compile(r"M\d{4}\.\d{6}|[A-Z]\d{4}\.\d{6}|[A-Z]\d{2}\.\d{3}[A-Z]?|\d{3,4}[A-Z]?\.\d{3,4}[A-Z]?")
STD = re.compile(r"졸업\(수료\)학점\s*-\s*(\d+)\s*,\s*교양학점\s*-\s*(\d+)\s*,\s*단일전공 이수\s*-\s*(\d+)\s*,\s*다른 전공 병행이수\s*-\s*(\d+)")
FOREIGN = re.compile(r"(?:외국어|영어)\s?(?:로\s)?(?:진행|강의)[^\n]{0,40}?(\d+)\s*(과목|학점|강좌)")


def load(folder: Path | str | None) -> dict | None:
    """조사 폴더(data) → {rules, jp, codes(과정 id → 스누지니 코드들)}. 없으면 None"""
    if not folder:
        return None
    d = Path(folder)
    if not (d / "이수규정.json").exists():
        return None
    rules = json.loads((d / "이수규정.json").read_text(encoding="utf-8"))["rules"]
    subj = json.loads((d / "전공교과목.json").read_text(encoding="utf-8"))["subjects"]
    pmap = json.loads((d / "스누지니코드_앱과정.json").read_text(encoding="utf-8"))
    codes: dict[str, list[str]] = defaultdict(list)
    for code, pid in pmap.items():
        codes[pid].append(code)
    return {"rules": rules, "subjects": subj, "codes": dict(codes), "log": []}


def by_entry(v: dict) -> bool:
    b = v.get("basis")
    return b is None or str(b).startswith("입학 연도") or str(b).startswith("미확인(입학 연도")


def _code(x: str) -> str:
    m = CODE.search(str(x or ""))
    return m.group(0) if m else str(x or "")


class Same:
    """같은 과목 번호 잇기(data/requirements/same_courses.json 의 옛 번호 → 새 번호, 줄의 alt_codes)"""

    def __init__(self, pairs: list[dict] | None = None):
        self.parent: dict[str, str] = {}
        for p in pairs or []:
            self.join(p["old"], p["new"])

    def find(self, a: str) -> str:
        while self.parent.get(a, a) != a:
            a = self.parent[a]
        return a

    def join(self, a: str, b: str) -> None:
        ra, rb = self.find(a), self.find(b)
        if ra != rb:
            self.parent[rb] = ra


def _year_text(sg: dict, codes: list[str], y: int) -> str | None:
    out = []
    for c in codes:
        for g in (sg["rules"].get(c) or {}).get("groups") or []:
            if y in (g.get("years") or []) and g["text"].strip() != NONE:
                out.append(g["text"])
    return "\n".join(out) or None


def _year_jp(sg: dict, codes: list[str], y: int) -> list[str]:
    out = []
    for c in codes:
        out += ((sg["subjects"].get(c) or {}).get("jp") or {}).get(str(y)) or []
    return out


def _all_of(r: dict) -> bool:
    cs = r.get("courses") or []
    if not cs:
        return False
    if r.get("min_count") is not None:
        return r["min_count"] >= len(cs)
    total = sum(float(c.get("credits") or 0) for c in cs)
    return r.get("min_credits") is not None and total > 0 and float(r["min_credits"]) >= total


def _row_keys(r: dict, same: Same) -> list[set[str]]:
    """줄 과목마다 그 과목을 가리키는 대표 번호들(번호 + alt_codes)"""
    out = []
    for c in r.get("courses") or []:
        ks = {same.find(_code(c.get("code")))} | {same.find(_code(a)) for a in c.get("alt_codes") or []}
        out.append(ks)
    return out


def _source(prog: dict, years: list[int]) -> str:
    lo, hi = min(years), max(years)
    span = f"{lo}학년도" if lo == hi else f"{lo}~{hi}학년도"
    s = {"title": f"{TITLE}({span}, {CHECKED} 확인)", "locator": f"{span} 졸업이수규정·전공 교과목(전필) 목록",
         "accessed": CHECKED, "url": "https://snugenie.snu.ac.kr"}
    srcs = prog.setdefault("sources", {})
    for k, v in srcs.items():
        if v.get("title") == s["title"]:
            return k
    n = 1 + max([int(k[1:]) for k in srcs if re.fullmatch(r"s\d+", k)] or [0])
    srcs[f"s{n}"] = s
    return f"s{n}"


def _confirm(r: dict, key: str, note: str | None = None) -> None:
    r["status"] = "확인"
    r["src"] = list(dict.fromkeys(list(r.get("src") or []) + [key]))
    if note:
        r["note"] = ((r.get("note") or "") + " " + note).strip()


def apply(prog: dict, sg: dict | None, same: Same, own) -> dict[str, int]:
    """과정 하나. own(번호) → 이 과정 학과의 과목인가. 바꾼 것 수(종류별)"""
    done: dict[str, int] = {}
    if not sg:
        return done
    codes = sg["codes"].get(prog["id"])
    if not codes:
        return done

    def hit(k, n=1):
        done[k] = done.get(k, 0) + n

    out = []
    for v in prog.get("versions") or []:
        lo, hi = v["entry_years"]
        years = list(range(max(lo, LO), min(hi, HI) + 1))
        if not by_entry(v) or not years:
            out.append(v)
            continue
        jp = {y: {same.find(_code(c)) for c in _year_jp(sg, codes, y)} for y in years}
        have = [y for y in years if jp[y]]
        # 1. 전필 줄
        listed = set()
        for r in v.get("requirements") or []:
            if r.get("type") in ("major_required", "thesis", "major_choose"):
                for ks in _row_keys(r, same):
                    listed |= ks
        ok_rows, diff = [], []
        for r in v.get("requirements") or []:
            if r.get("type") != "major_required" or r.get("status") == "확인" or not _all_of(r):
                continue
            keys = _row_keys(r, same)
            res = {}
            for y in have:
                mine = {c for c in jp[y] if own(c)} or jp[y]
                ok1 = mine <= listed
                ok2 = all(ks & jp[y] for ks in keys if any(own(k) for k in ks))
                res[y] = ok1 and ok2
                if not res[y]:
                    diff.append((r["id"], y, sorted(mine - listed), sorted(min(ks) for ks in keys if any(own(k) for k in ks) and not ks & jp[y])))
            if have and all(res.values()):
                ok_rows.append(r["id"])
        rest = [y for y in years if y not in have]
        tail = bool(rest) and min(rest) > max(have) if have else False
        if ok_rows and rest and not tail:
            sg["log"].append((prog["id"], prog.get("program"), v["entry_years"], "판 가운데 학년도 목록이 비어 그대로", ok_rows))
            ok_rows = []
        parts = [(v, have)]
        if ok_rows and rest:  # 목록이 있는 학번만 확인: 판을 나눈다
            a, b = copy.deepcopy(v), copy.deepcopy(v)
            a["entry_years"], b["entry_years"] = [lo, max(have)], [max(have) + 1, hi]
            a["split"] = b["split"] = f"스누지니 전필 목록이 {min(rest)}학년도부터 비어 나눔(update135)"
            parts = [(a, have), (b, [])]
            hit("판 나눔")
        for part, ys in parts:
            if ys and ok_rows:
                key = _source(prog, ys)
                for r in part.get("requirements") or []:
                    if r["id"] in ok_rows:
                        _confirm(r, key)
                        hit("전필 줄 확인")
                sg["log"].append((prog["id"], prog.get("program"), part["entry_years"], "전필 확인", ok_rows))
            # 3. 학점
            texts = {y: _year_text(sg, codes, y) for y in range(part["entry_years"][0], part["entry_years"][1] + 1) if LO <= y <= HI}
            cr = part.get("credits") or {}
            nums = {y: STD.search(t) for y, t in texts.items() if t}
            if texts and all(nums.get(y) for y in texts) and all(
                    tuple(int(x) for x in nums[y].groups()) == (cr.get("grad"), cr.get("ge"), cr.get("single"), cr.get("parallel")) for y in texts):
                if cr.get("status") != "확인":
                    key = _source(prog, list(texts))
                    cr["status"] = "확인"
                    cr["src"] = list(dict.fromkeys(list(cr.get("src") or []) + [key]))
                    hit("학점 확인")
            # 4. 외국어진행강좌
            for r in part.get("requirements") or []:
                f = r.get("foreign")
                if not f or r.get("status") == "확인" or not texts:
                    continue
                n = f.get("min_count") or f.get("min_credits")
                unit = "학점" if f.get("min_credits") else "과목"
                ok = all(t and any(int(m.group(1)) == n and (m.group(2) in ("과목", "강좌") if unit == "과목" else m.group(2) == "학점")
                                   for m in FOREIGN.finditer(t)) for t in texts.values())
                if ok:
                    _confirm(r, _source(prog, list(texts)))
                    hit("외국어진행강좌 확인")
            out.append(part)
        for d in diff:
            sg["log"].append((prog["id"], prog.get("program"), v["entry_years"], "전필 목록 다름", d))
    prog["versions"] = out
    return done


def report(sg: dict | None) -> str:
    """공유 폴더 보고서(마크다운): 확인한 줄, 나눈 판, 목록이 다른 전필 줄"""
    if not sg:
        return ""
    lines = ["# 졸업 요건 스누지니 반영 (update135)", "",
             f"{CHECKED} 백엔드. 사용자 11/17 '우리 과처럼 졸업 요건 모르는 건 스누지니든 뭐든 활용해서 알아내라니까'.",
             "스누지니 전공 탐색(조사_스누지니_20261117)의 전필 목록·졸업이수규정 글을 과정 파일과 맞대어 '확인'으로 올린 것과, 맞지 않아 그대로 둔 것.", ""]
    ok = [x for x in sg["log"] if x[3] == "전필 확인"]
    lines += ["## 전필 줄을 '확인'으로", ""] + [f"- {p} ({pid}) {ys[0]}~{ys[1]}학번: {', '.join(rows)}" for pid, p, ys, _, rows in ok] + [""]
    diff = [x for x in sg["log"] if x[3] == "전필 목록 다름"]
    lines += ["## 전필 목록이 달라 그대로 둔 줄(사람이 볼 곳)", "",
              "스누지니에만: 스누지니 전필인데 앱 전필·논문 줄에 없는 이 학과 과목. 앱에만: 앱 줄에 있는데 그 학년도 스누지니 전필이 아닌 이 학과 과목(전선이 됐거나 내규 필수일 수 있다).", ""]
    for pid, p, ys, _, (rid, y, only_sg, only_app) in diff:
        lines.append(f"- {p} ({pid}) {ys[0]}~{ys[1]}학번 판 `{rid}` {y}학년도 — 스누지니에만 {', '.join(only_sg) or '없음'} / 앱에만 {', '.join(only_app) or '없음'}")
    other = [x for x in sg["log"] if x[3] not in ("전필 확인", "전필 목록 다름")]
    if other:
        lines += ["", "## 그 밖", ""] + [f"- {p} ({pid}) {ys}: {what} {rows}" for pid, p, ys, what, rows in other]
    return "\n".join(lines) + "\n"
