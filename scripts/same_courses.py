"""이름·번호가 바뀐 과목과 더 열리지 않는 과목 → 졸업 요건 자료의 course_map.json 에 붙일 값(export_web 이 웹으로 옮길 때 붙인다).

  python scripts/same_courses.py            # 무엇이 붙는지 줄여 보기(파일은 쓰지 않는다)

붙이는 값(docs/requirements.md '같은 과목'):
  same   [{codes: [옛 번호, 새 번호], names: [옛 이름, 새 이름], since: 새 번호 첫 개설 학기|null, why, src}]
         - 학과·학교 자료에 같은 과목·이름 변경·대체 지정으로 적혔거나 학과 목록에서 자리를 이어받은 짝(data/requirements/same_courses.json, 손으로 모음)
         - 지난 편람에서 이름이 그대로인 채 번호만 바뀐 과목(자동): 앞 번호가 닫힌 뒤 1년 반 안에 새 번호가 열리고, 함께 열린 학기가 없고,
           학점·과정(학사 등)이 같고, 개설 학과나 교수가 같으며, 서로 하나씩만 짝이 되는 것. 요건 목록에 걸린 번호만
  now    {번호: {code, name}}  요건 목록의 과목이 지금은 다른 이름으로 열리면 그 번호와 이름(이어진 번호 가운데 지금 열리는 것, 가장 늦게 생긴 것)
  ended  {번호: 마지막 개설 학기}  요건 목록의 과목 가운데 그 과목이 열리던 간격(최근 세 번, 1년~2년으로 자름)보다 오래 안 열렸고,
         이어진 번호도 그 줄의 alt_codes 도 안 열리는 것(해마다 가을에 열리던 과목은 이번 가을에 없어도 1년이 지나야 '안 열림')
'이어진 번호'는 교양 대응표(rows)와 same 으로 이어진 번호다. 표준 라이브러리만 쓴다.
"""

from __future__ import annotations

import json
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
REQ = ROOT / "data" / "requirements"
HISTORY = ROOT / "data" / "history"
TERM = re.compile(r"^(\d{4})-(1|S|2|W)$")
ORDER = {"1": 0, "S": 1, "2": 2, "W": 3}
RECENT = 4  # 마지막 학기에서 이만큼(학기 넷 = 1년) 안에 열렸으면 '지금 열린다'(번호만 바뀐 짝 찾기). 안 열림(ended)은 열리던 간격도 본다(alive)
GAP = (1, 6)  # 옛 번호 마지막 개설 → 새 번호 첫 개설(학기 수, 1년 반 안)


def tord(term: str) -> int:
    m = TERM.match(term)
    return int(m[1]) * 4 + ORDER[m[2]]


def norm(name: str) -> str:
    """이름 맞대기: 로마 숫자는 아라비아 숫자로, 띄어쓰기·가운뎃점·괄호·쌍점 등은 빼고"""
    s = str(name or "").replace("Ⅰ", "1").replace("Ⅱ", "2").replace("Ⅲ", "3").replace("Ⅳ", "4")
    return re.sub(r"[\s·\-:：,()（）\[\]<>「」『』\"'.~]", "", s).lower()


def read_history(folder: Path) -> tuple[dict, str | None]:
    """번호 → {terms, name, dept, credits, level, people: {학기: 교수}}(학기마다 가장 많이 쓴 값). 마지막 학기도"""
    files = sorted((f for f in folder.glob("*.json") if TERM.match(f.stem)), key=lambda f: tord(f.stem))
    raw: dict[str, dict] = {}
    for f in files:
        for r in json.loads(f.read_text(encoding="utf-8")).get("courses", []):
            h = raw.setdefault(r[0], {"terms": [], "name": Counter(), "dept": Counter(), "credits": Counter(), "level": Counter(), "people": {}})
            if not h["terms"] or h["terms"][-1] != f.stem:
                h["terms"].append(f.stem)
            h["name"][r[1]] += 1
            h["dept"][r[2]] += 1
            h["credits"][r[3]] += 1
            h["level"][r[5] if len(r) > 5 else ""] += 1
            who = h["people"].setdefault(f.stem, set())
            for sec in (r[6] if len(r) > 6 else None) or []:
                if len(sec) > 1 and sec[1]:
                    who.update(p.strip() for p in re.split(r"[,/]", str(sec[1])) if p.strip())
    top = lambda c: c.most_common(1)[0][0] if c else None
    hist = {code: {"terms": h["terms"], "name": top(h["name"]), "dept": top(h["dept"]), "credits": top(h["credits"]), "level": top(h["level"]),
                   "people": h["people"]} for code, h in raw.items()}
    return hist, (files[-1].stem if files else None)


def listed_codes(programs: list[dict]) -> tuple[set[str], list[tuple[str, str]]]:
    """과정 파일의 요건 목록에 적힌 번호(줄·분야·갈래의 courses)와 alt_codes 짝"""
    codes, alts = set(), []

    def walk(x):
        if isinstance(x, dict):
            if isinstance(x.get("code"), str) and "name" in x:
                codes.add(x["code"])
                for a in x.get("alt_codes") or []:
                    if isinstance(a, str) and a and a != x["code"]:
                        alts.append((x["code"], a))
            for v in x.values():
                walk(v)
        elif isinstance(x, list):
            for v in x:
                walk(v)

    for p in programs:
        for v in p.get("versions") or []:
            walk(v.get("requirements") or [])
    return codes, alts


def renumbered(hist: dict, codes: set[str]) -> list[dict]:
    """이름이 그대로인 채 번호만 바뀐 짝(위 머리글의 조건). codes(요건 목록의 번호)가 한쪽에 있는 것만"""
    last = max((tord(h["terms"][-1]) for h in hist.values()), default=0)
    by_name: dict[tuple, list[str]] = defaultdict(list)
    for code, h in hist.items():
        by_name[(norm(h["name"]), h["credits"], h["level"])].append(code)
    found = []
    for group in by_name.values():
        if len(group) < 2:
            continue
        for o in group:
            ho = hist[o]
            if tord(ho["terms"][-1]) > last - RECENT:  # 옛 번호가 아직 열린다
                continue
            for n in group:
                hn = hist[n]
                if n == o or not (GAP[0] <= tord(hn["terms"][0]) - tord(ho["terms"][-1]) <= GAP[1]):
                    continue
                if set(ho["terms"]) & set(hn["terms"]):
                    continue
                people = set().union(*(ho["people"].get(t, set()) for t in ho["terms"][-4:])) & set().union(*(hn["people"].get(t, set()) for t in hn["terms"][:4]))
                if ho["dept"] != hn["dept"] and not people:
                    continue
                found.append((o, n))
    outs, ins = Counter(o for o, _ in found), Counter(n for _, n in found)
    rows = []
    for o, n in found:
        if outs[o] == 1 and ins[n] == 1 and (o in codes or n in codes):
            rows.append({"codes": [o, n], "names": [hist[o]["name"], hist[n]["name"]], "since": hist[n]["terms"][0], "why": "번호 변경", "src": "수강편람(같은 이름, 번호만 바뀜)"})
    return sorted(rows, key=lambda r: r["codes"])


def build(req: Path = REQ, history: Path = HISTORY, course_map: dict | None = None) -> dict:
    """course_map.json 에 붙일 {same, now, ended}"""
    hist, latest = read_history(history)
    if course_map is None:
        course_map = json.loads((req / "course_map.json").read_text(encoding="utf-8"))
    programs = [json.loads(f.read_text(encoding="utf-8")) for f in sorted((req / "programs").glob("*.json"))]
    codes, alts = listed_codes(programs)
    hand = json.loads((req / "same_courses.json").read_text(encoding="utf-8")) if (req / "same_courses.json").exists() else {"pairs": []}
    same = []
    for p in hand.get("pairs") or []:
        h = hist.get(p["new"])
        same.append({"codes": [p["old"], p["new"]], "names": list(p["names"]), "since": h["terms"][0] if h else None, "why": p["why"], "src": p["src"]})
    seen = {tuple(r["codes"]) for r in same}
    same += [r for r in renumbered(hist, codes) if tuple(r["codes"]) not in seen]
    # 이어진 번호 묶음(교양 대응표·same·과정 alt_codes)
    parent: dict[str, str] = {}

    def find(a):
        while parent.get(a, a) != a:
            a = parent[a]
        return a

    def join(a, b):
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[rb] = ra

    for row in course_map.get("rows") or []:
        cs = [row[y]["code"] for y in ("2024", "2025", "2026") if row.get(y) and row[y].get("code")]
        for c in cs[1:]:
            join(cs[0], c)
    for r in same:
        join(*r["codes"])
    members: dict[str, set] = defaultdict(set)
    for c in set(parent) | codes:
        members[find(c)].add(c)
    # 과정 파일의 alt_codes 는 그 줄에서 '이것도 된다'는 뜻일 때가 있어(화학실험·화학실험 1 같은 대안) 지금 이름에는 안 쓰고, 그 번호가 열리면 '안 열림'만 뺀다
    alt_of: dict[str, set] = defaultdict(set)
    for a, b in alts:
        alt_of[a].add(b)
    newest = tord(latest) if latest else 0

    def alive(c):
        """지금 열리는 과목: 마지막 개설 뒤 지난 학기 수가 열리던 간격(최근 세 번의 간격 중 가장 긴 것, 4~8 학기) 안"""
        if c not in hist:
            return False
        t = [tord(x) for x in hist[c]["terms"]]
        gaps = [b - a for a, b in zip(t, t[1:])][-3:]
        return newest - t[-1] <= min(max([RECENT, *gaps]), 2 * RECENT)
    names = {c: n for r in same for c, n in zip(r["codes"], r["names"]) if n}
    now, ended = {}, {}
    for c in sorted(codes):
        group = members[find(c)]
        live = [x for x in group if alive(x)]
        if c in live:
            continue
        if not live and any(alive(a) or any(alive(x) for x in members[find(a)]) for a in alt_of[c]):
            continue
        if live:
            cur = max(live, key=lambda x: (tord(hist[x]["terms"][0]), x))
        else:  # 아직 안 열린 새 번호(학과가 적어 둔 것)
            cur = next((r["codes"][1] for r in same if r["codes"][0] == c and r["codes"][1] not in hist), None)
        name = (hist[cur]["name"] if cur in hist else names.get(cur)) if cur else None
        old = hist[c]["name"] if c in hist else names.get(c)
        if cur and name and norm(name) != norm(old or ""):
            now[c] = {"code": cur, "name": name}
        if not live and c in hist:
            ended[c] = hist[c]["terms"][-1]
    return {"same": same, "now": now, "ended": ended, "latest": latest}


def enrich(course_map: dict, req: Path = REQ, history: Path = HISTORY) -> dict:
    """course_map 에 same·now·ended 를 붙인 새 dict(편람이 없으면 그대로)"""
    if not history.exists() or not any(history.glob("*.json")):
        return course_map
    got = build(req, history, course_map)
    return {**course_map, "same": got["same"], "now": got["now"], "ended": got["ended"], "same_basis": got["latest"]}


def main(argv: list[str] | None = None) -> int:
    got = build()
    why = Counter(r["why"] for r in got["same"])
    print(f"같은 과목 짝 {len(got['same'])}개({', '.join(f'{k} {v}' for k, v in why.most_common())}), 지금 이름 {len(got['now'])}개, "
          f"더 안 열리는 과목 {len(got['ended'])}개(편람 마지막 학기 {got['latest']})")
    for r in got["same"][:5]:
        print("  ", r["codes"], r["names"], r["why"])
    return 0


if __name__ == "__main__":
    sys.exit(main())
