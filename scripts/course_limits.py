"""수강 제한 알림 자료: 수강편람 비고 → 분반마다 단계 규칙과 대상 글 → data/limits/<학기>.json

update105(11/13 밤, 디자인 121·123판, 프론트엔드 ②, 법무 11/13). 화면은 이 자료와 web/js/limits.js 의 답을 그대로 그리고 글을 짓지 않는다.
형식과 규칙은 docs/limits.md. sync.py 가 편람을 새로 받을 때 그 학기 것을 다시 만든다(웹 자료 만들기는 표준 라이브러리만 써서 엑셀을 못 읽는다).

비고는 사람이 쓴 문장이라 다 읽지 못한다. 읽은 비고만 규칙(kind "rule")으로 내고, 확실하지 않으면 원문(kind "note")만 낸다.
- ® 만 있는 분반: kind "mark"(화면 '수강반 제한', 중립)
- 단계: '수강신청 1~4일차', '4일차까지', '5일차부터', '6일차', '변경기간', '8/4~8/7'(날짜). 단계 앞의 '®X만' 은 모든 단계에 걸린다(밑 규칙)
- 누구: 단과대·학과(부)·전공(수강편람 개설학과 이름, 줄임말, 학과 목록의 전공 이름), 주전공·제2전공(복수·부전공), 학년, 학번, 초수강,
  '전체 학생'·'수강반 해제', 'X 제외', 'X 외 수강불가'(= X만), 'X생 수강불허'(= X 제외), '타과생 불허'(개설학과만), '자유전공학부(X 주전공)'
- 이름은 학과 목록(data/requirements/catalog.json)의 학과(부)·전공 id 로 바꿔 둔다. 못 바꾸는 이름이 있으면 그 비고는 원문으로
- 수업·문의·정원 외 신청·성적 기준 같은 안내 조각은 규칙과 무관해 건너뛴다. 남는 글이 있으면 그 비고는 읽지 않은 것으로 본다
- 개인 메일 주소는 원문에서 '문의 메일은 수강편람 원문에서'로 바꾼다(법무 11/13). 기관 번호·학교 주소·사람 이름이 든 반 이름은 그대로

python scripts/course_limits.py [--term 2026-2 ...] [--raw data/raw/2026-2_….xls] [--out data/limits]
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from datetime import date, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
from restrictions import COLLEGE_ALIASES, DEPT_ALIASES, norm  # noqa: E402

RAW = ROOT / "data" / "raw"
OUT = ROOT / "data" / "limits"
CATALOG = ROOT / "data" / "requirements" / "catalog.json"
REGISTRATION = ROOT / "data" / "registration.json"
SITE = "https://sugang.snu.ac.kr"
MASK = "문의 메일은 수강편람 원문에서"
EMAIL = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+")
SPECIAL = re.compile(r"유학생반|글로벌\s*인재반|외국인\s*학생|교환\s*학생만")
LEAD = re.compile(r"^[\s®ⓔⓞⓒ*※]+")
# 수강신청 사이트 밖에서 정하는 분반(따로 뽑기·사전 신청·일괄 등록): 앱이 판단하지 않고 원문만
NOTE_ONLY = re.compile(r"별도\s*선발|인터뷰|사전\s*(?:수강)?\s*신청|수기\s*등록|일괄\s*(?:수강)?\s*신청|지정\s*인원|인턴십|교직\s*이수")

# 규칙과 무관한 안내 조각(문의, 정원 외 신청, 성적 기준, 강의실, 같은 담당 교수 …). 이런 조각은 읽지 않고 넘어간다
INFO = re.compile(r"문의|정원외|수강기준|텝스|FAQ|확인후|필독|참조|참고|공지|홈페이지|담당교수|담당교원|일치하지|한국어강좌|영어강좌|"
                  r"동시수강|면제|권장|세미나실|LnL|과제신청|면담|재수강불가|교환학생|국내교류|국제교환|방문|성적|이론\d|실습\d|"
                  r"권고|승인|사회봉사|마이스누|포털|역수강|강의계획서|재배정|강의실|크로스리스팅|https?:|www\.|forms\.gle")
# 단계 표시. 압축 글(띄어쓰기·가운뎃점 없음) 위에서 찾는다
STAGE = re.compile(
    r"(?P<range>(?P<a>\d)(?:일차?)?[~∼\-](?P<b>\d)일차?(?:까지)?)"
    r"|(?P<upto>(?P<u>\d)일차?까지)"
    r"|(?P<from>(?P<f>\d)일차?(?:부터|이후|[~∼](?!\d)))"
    r"|(?P<one>(?P<o>\d)일차)"
    r"|(?P<change>(?:수강신청)?변경기간)"
    r"|(?P<main>본수강신청)"
    r"|(?P<after>(?<!학번)(?<!주)이후(?:에는|부터는?)?)"
    r"|(?P<dates>(?P<m1>\d{1,2})/(?P<d1>\d{1,2})[~∼\-](?P<m2>\d{1,2})/(?P<d2>\d{1,2}))")
CART = re.compile(r"장바구니\d(?:일차?)?(?:[~∼\-]\d일차?)?\+?")  # '장바구니 1~2일차+선착순 1~2일차': 장바구니 쪽은 뺀다
EVERYONE = re.compile(r"타과생(?:수강신청|수강|신청)*가능|수강반해제|수강반제한없음|제한없음|전체학생|모든학생|재학생전체|누구나|초수강생?[,및과와]재수강생?|전학부전학년|전체수강가능")
WIDE = re.compile(r"전대학|전학부|전체단과대|전단과대")  # 학과 제한 없음(학년은 따로 볼 수 있다)
GRADE = re.compile(r"(?P<g>\d(?:[,~∼\-]\d)*)학년(?P<up>이상)?")
ALLGRADE = re.compile(r"전학년|전체학년")
YEAR = re.compile(r"(?:20)?(?P<y>\d{2})학번(?:포함)?(?P<dir>이후|이전|부터|까지)?")
FIRST = re.compile(r"초수강생?")
BOTH = re.compile(r"주전공(?:생|자)?(?:(?:및|,|\+|과|와|/)?(?:제2전공|2전공|다전공|복수전공|부전공)(?:생|자|진입생)?)+")
MAIN = re.compile(r"주전공(?:생|자)?|전공생")
SECOND = re.compile(r"(?:제2전공|2전공|다전공|복수전공|부전공)(?:생|자|진입생)?")
FREE_MAJOR = re.compile(r"\(?자유전공학부(?:생|학생)?\(?(?P<x>[^()]+?)주전공(?:생|자)?\)?(?:포함)?\)?")
EXCEPT_WORD = re.compile(r"(?:을|를)?제외(?:한|하고)?")
PRE_EXCEPT = re.compile(r"^\(?수강제외\)?")
LINK = re.compile(r"(?:(?:주전공|제2전공|2전공|다전공|복수전공|부전공)(?:생|자)?|학생|소속|생|및|,|과|와|\(|\)|_)*")
OTHERS_BAR = re.compile(r"타과생[^/]*?(?:불허|불가|금지)")
ONLY = re.compile(r"(?:이외에는|외에는|외)(?:학생)?(?:수강신청|수강|신청)*(?:불허|불가|금지)")
NEG = re.compile(r"(?:불허|불가|금지)")
FILLER = re.compile(r"수강신청제한|수강제한|(?:주전공생?|전공생|전공자)?우선(?:수강|신청)|서울대학교|수강신청기간|수강신청|수강|신청|가능하며|가능하고|가능함|가능합니다|가능|하며|하고|함|"
                    r"만|에는|까지는|부터는|에서|에|는|은|의|및|학생|소속|대상|우선|선착순|본|정원내|이|가|도|포함|"
                    r"학사과정|학사|과정|전공별순차적|순차적|장바구니|\d단계|단계|이수자|이수생|해당|등|생|자|중|[:;,.()\[\]+~∼\-『』<>\"'“”·_]")
TAIL_FILLER = re.compile(r"전공")  # 역할 말을 다 뺀 뒤 남은 '전공'('연합전공 인공지능반도체공학 전공')
RULE_WORDS = re.compile(r"만|가능|불허|불가|금지|제외|제한|해제|학년|학번|초수강|타과생")
HEAD_WORDS = re.compile(r"만|불허|불가|금지|제외|학년|학번|전공")
SENTENCE = re.compile(r"(가능|불가|불허|금지|허용)(하며|하고|함|합니다|하다)?[,.;]")
PAREN_INFO = re.compile(r"\([^()]*(?:정원|문의|홈페이지|공지|확인|인정|eTL|http)[^()]*\)")  # '(정원내 신청가능)'·'(… 전공 불인정)'
LOCAL_ALIASES = {"컴공": "컴퓨터공학부"}  # restrictions.DEPT_ALIASES 에 더해(줄기 '경제학주' 같은 것은 쓰지 않는다)


class Unknown(Exception):
    """읽지 못한 조각"""


class Names:
    """비고 속 이름 찾기와 학과 목록 id 로 바꾸기.

    depts = {편람 개설학과: 개설대학}, catalog = data/requirements/catalog.json.
    찾는 이름: 단과대(줄임말), 편람 개설학과 이름과 끝의 '학부·학과·부·과'를 뗀 줄기('경제학 주전공'), 학과 목록의 전공 이름과
    '전공'을 뗀 줄기('소비자학 주전공생'), 연합·연계전공 이름. 같은 글자면 편람 학과 이름 > 전공 이름 > 전공 줄기 > 학과 줄기.
    """

    def __init__(self, depts: dict[str, str], catalog: dict):
        self.catalog = catalog
        self.units = {}  # unit id → (대학, 이름, [과정 id])
        for col in catalog.get("colleges", []):
            for u in col["units"]:
                self.units[u["id"]] = (col["name"], u["name"], list(u["programs"]))
        for u in catalog.get("others", []):
            self.units[u["id"]] = (None, u["name"], list(u["programs"]))
        self.unit_by_name = {norm(name): uid for uid, (_, name, _) in self.units.items()}
        self.college_units = {}
        for uid, (col, _, _) in self.units.items():
            if col:
                self.college_units.setdefault(col, []).append(uid)
        programs = catalog.get("programs", {})
        self.program_name = {pid: p.get("short") or p["name"] for pid, p in programs.items()}
        self.dept_display = {norm(d): d for d in depts if d}
        pats: dict[str, tuple[int, str, str]] = {}

        def add(pat: str, prio: int, kind: str, key: str) -> None:
            if len(pat) >= 2 and (pat not in pats or pats[pat][0] > prio):
                pats[pat] = (prio, kind, key)

        for d in self.dept_display:
            add(d, 0, "dept", d)
        for college, aliases in COLLEGE_ALIASES.items():
            for a in aliases:
                add(norm(a), 0, "college", college)
        for pid, p in programs.items():
            unit = self.units.get(p.get("unit"), (None, "", []))
            if len(unit[2]) <= 1 and norm(p["name"]) == norm(unit[1]):
                continue  # 전공으로 나뉘지 않는 학과(부): 학과 이름으로 찾는다
            name = norm(p["name"])
            if FILLER.fullmatch(name) or name in ("학사과정", "석사과정", "통합과정"):
                continue  # 치의학대학원의 '학사과정' 처럼 흔한 말과 같은 이름은 찾지 않는다
            add(name, 1, "program", pid)
            stem = re.sub(r"전공$", "", name)
            if stem != name and len(stem) >= 3:
                add(stem, 2, "program", pid)
            if unit[1] in ("연합전공", "연계전공"):
                add(unit[1] + name, 1, "program", pid)
                if len(name) < 5 and pats.get(name, (0, "", ""))[2] == pid:
                    pats.pop(name)  # 짧은 연합·연계전공 이름('인공지능')은 '연합전공 …' 으로만
        for d in list(self.dept_display):
            stem = re.sub(r"(?:부|과)$", "", d)  # '경제학부' → '경제학', '산업공학과' → '산업공학'
            if len(stem) >= 3 and stem != d:
                add(stem, 3, "dept", d)
        for a, d in {**DEPT_ALIASES, **LOCAL_ALIASES}.items():
            if norm(d) in self.dept_display and not a.endswith("주"):
                add(norm(a), 4, "dept", norm(d))
        order = sorted(pats, key=lambda p: (-len(p), pats[p][0]))
        self.lookup = {p: pats[p][1:] for p in order}
        self.re = re.compile("|".join(re.escape(p) for p in order))

    def find(self, text: str) -> list[tuple[int, int, str, str]]:
        return [(m.start(), m.end(), *self.lookup[m.group(0)]) for m in self.re.finditer(text)]

    def owns(self, dept_key: str, pid: str) -> bool:
        """편람 학과(부) 이름 dept_key 가 전공 pid 를 품는가('응용생물화학부' ⊃ 응용생명화학전공)"""
        try:
            units = set(self.item("dept", dept_key, "any").get("units") or [])
        except Unknown:
            return False
        return self.catalog.get("programs", {}).get(pid, {}).get("unit") in units

    # ------------------------------------------------------------ 학과 목록 id

    def item(self, kind: str, key: str, role: str) -> dict:
        """이름 → {"name", "role", "units"|"programs"}. 단과대는 소속(주전공)만. 못 바꾸면 Unknown"""
        if kind == "college":
            units = self.college_units.get(key)
            if not units:
                raise Unknown(key)
            return {"name": key, "role": "main", "college": True, "units": sorted(units)}
        if kind == "program":
            return {"name": self.program_name.get(key, key), "role": role, "programs": [key]}
        display = self.dept_display.get(key, key)
        dep = self.catalog.get("depts", {}).get(display)
        if dep and dep.get("units"):
            return {"name": display, "role": role, "units": sorted(dep["units"])}
        uid = self.unit_by_name.get(norm(display))
        if uid:
            return {"name": display, "role": role, "units": [uid]}
        bare = re.sub(r"^(?:연합전공|연계전공)", "", norm(display))
        for pid, p in self.catalog.get("programs", {}).items():
            if norm(p["name"]) == bare:
                return {"name": display, "role": role, "programs": [pid]}
        if display in self.college_units:
            return {"name": display, "role": "main", "college": True, "units": sorted(self.college_units[display])}
        raise Unknown(display)


def mask_emails(text: str) -> str:
    return EMAIL.sub(MASK, text or "")


def compact(text: str) -> str:
    text = re.sub(r"(\d)\s*[·‧∙ㆍ,]\s*(\d)\s*일", r"\1~\2일", text or "")  # '5‧6일차' = 5~6일차
    t = norm(text).replace("［", "[").replace("］", "]").replace("（", "(").replace("）", ")").replace("，", ",")
    t = re.sub(r"(전공(?:생|자)?)/(?=(?:제2|2|다|복수|부|주)?전공)", r"\1,", t)  # '주전공생/다전공생' 은 한 조각
    t = CART.sub("", t)
    t = PAREN_INFO.sub("", t)
    t = re.sub(r"\([^()]*소속\)", "", t)  # '심리학 주전공생(사회과학대학 심리학과/자유전공학부 소속)': 풀이
    t = re.sub(r"\(자유전공학부(?:생|학생)?주전공(?:생|자)?포함\)", "", t)  # 앞 학과 주전공에 이미 든다
    return SENTENCE.sub(lambda m: m.group(1) + "|", t)


def _clauses(text: str) -> list[str]:
    """'/'·'|'·줄바꿈·대괄호로 나눈 조각. 괄호 안의 '/'(복수전공/부전공)와 날짜(8/4)는 나누지 않는다."""
    out, buf, depth = [], [], 0
    for i, ch in enumerate(text):
        if ch == "(":
            depth += 1
        elif ch == ")":
            depth = max(0, depth - 1)
        cut = ch in "|\n[]" or (ch == "/" and depth == 0 and not (0 < i < len(text) - 1 and text[i - 1].isdigit() and text[i + 1].isdigit()))
        if cut:
            out.append("".join(buf))
            buf = []
        else:
            buf.append(ch)
    out.append("".join(buf))
    return [c for c in (x.strip() for x in out) if c]


def _strip_parens(text: str) -> str:
    while True:
        new = re.sub(r"\([^()]*\)", "", text)
        if new == text:
            return new
        text = new


def _who(content: str, names: Names, section_dept: str) -> dict | None:
    """조각(단계 표시를 뺀 글) → 받는 사람 규칙. None 은 누구나. 못 읽으면 Unknown."""
    allow: dict = {}
    rest = content
    everyone = bool(EVERYONE.search(rest))  # '수강반 해제'·'전체 학생': 밑 규칙도 푼다
    weak = False  # '전 대학'·'전 학년': 밑 규칙(단과대·학과)은 그대로, 학년만 넓힌다
    rest = EVERYONE.sub("", rest)
    who: list[dict] = []
    if OTHERS_BAR.search(rest):
        who.append(names.item("dept", norm(section_dept), "any"))
        rest = OTHERS_BAR.sub("", rest)
    only = bool(ONLY.search(rest))
    rest = ONLY.sub("", rest)
    if WIDE.search(rest):
        rest = WIDE.sub("", rest)
        weak = True
    grades: set[int] = set()
    for m in list(GRADE.finditer(rest)):
        gs = []
        for part in m.group("g").split(","):
            ends = [int(x) for x in re.split(r"[~∼\-]", part)]
            gs += list(range(ends[0], ends[-1] + 1))
        if m.group("up"):
            allow["grade_min"] = gs[0]
        else:
            grades.update(gs)
    rest = GRADE.sub("", rest)
    if grades:
        allow["grades"] = sorted(grades)
    if ALLGRADE.search(rest):
        allow.pop("grades", None)
        allow.pop("grade_min", None)
        rest = ALLGRADE.sub("", rest)
        weak = True
    m = YEAR.search(rest)
    if m:
        y = 2000 + int(m.group("y"))
        if m.group("dir") in ("이후", "부터"):
            allow["year_min"] = y
        elif m.group("dir") in ("이전", "까지"):
            allow["year_max"] = y
        else:
            allow["years"] = [y]
        rest = rest[:m.start()] + rest[m.end():]
    if FIRST.search(rest):
        allow["first_time"] = True
        rest = FIRST.sub("", rest)
    excepts: list[dict] = []
    pre = PRE_EXCEPT.match(rest)  # '(수강제외) 의대, 공대': 뒤의 이름이 다 제외
    if pre:
        rest = rest[pre.end():]
    negative = bool(pre) or bool(NEG.search(rest))  # 'X생 수강불허'(외 … 불가는 위에서 뺐다) → X 제외
    for fm in list(FREE_MAJOR.finditer(rest)):  # 자유전공학부(X 주전공) → X 주전공
        hits = names.find(fm.group("x"))
        if len(hits) != 1:
            raise Unknown(fm.group(0))
        (excepts if negative else who).append(names.item(hits[0][2], hits[0][3], "main"))
    rest = FREE_MAJOR.sub("", rest)
    hits = names.find(rest)
    cuts = []
    for em in EXCEPT_WORD.finditer(rest):  # 'A, B, C를 제외한', 'X 주전공생 및 제2전공 제외한': 바로 앞에 이어진 이름들
        end, j, chain = em.start(), None, []
        before = [i for i, h in enumerate(hits) if h[1] <= end]
        j = before[-1] if before else None
        while j is not None and j >= 0 and LINK.fullmatch(rest[hits[j][1]:end]):
            chain.append(j)
            end = hits[j][0]
            j -= 1
        if not chain:
            continue
        seg = rest[hits[chain[-1]][0]:em.start()]
        role = "any" if (SECOND.search(seg) or BOTH.search(seg)) else "main"
        excepts += [names.item(hits[i][2], hits[i][3], role) for i in reversed(chain)]
        cuts.append((hits[chain[-1]][0], em.end()))
    for a, e in sorted(cuts, reverse=True):
        rest = rest[:a] + rest[e:]
    if negative:
        rest = NEG.sub("", rest)
    hits = names.find(rest)
    spans = []
    for i, (a, e, k, n) in enumerate(hits):
        nxt = hits[i + 1][0] if i + 1 < len(hits) else len(rest)
        tail = rest[e:nxt]
        glued = i + 1 < len(hits) and re.fullmatch(r"[_:(]*", rest[e:hits[i + 1][0]])
        if k == "college" and glued and hits[i + 1][2] != "college":
            spans.append((a, e))  # '공대_재료공학부': 단과대는 학과를 꾸미는 말
            continue
        if k == "dept" and glued and hits[i + 1][2] == "program" and names.owns(n, hits[i + 1][3]):
            spans.append((a, e))  # '응용생물화학부 응용생명화학전공': 학부는 전공을 꾸미는 말
            continue
        tail = re.sub(r"^(?:학사과정|학사|소속|_|:)+", "", tail)
        paren = re.match(r"\(([^()]*)\)", tail)
        explain = paren.group(1) if paren else ""
        if BOTH.match(tail) or SECOND.match(tail) or re.search(r"다전공|제2전공|2전공|복수|부전공", explain):
            role = "any"
        elif MAIN.match(tail) or re.fullmatch(r"(?:주전공|주전공생)", explain):
            role = "main"
        else:
            role = "any"
        if negative and not (BOTH.match(tail) or SECOND.match(tail) or re.search(r"다전공|제2전공|2전공|복수|부전공", explain)):
            role = "main"  # 막는 쪽은 분명할 때만 넓힌다('생명과학부생 수강불가' 는 주전공만 막는다고 본다)
        (excepts if negative else who).append(names.item(k, n, role))
        spans.append((a, e))
        if paren and re.fullmatch(r"(?:주전공|주전공생|다전공생?포함|제2전공포함|주전공,?제2전공|주전공,?다전공)?", explain):
            spans.append((e, e + paren.end()))  # '(주전공, 제2전공)'·'(다전공생 포함)': 역할 말
    for a, e in sorted(spans, reverse=True):
        rest = rest[:a] + rest[e:]
    if negative and (only or "만" in content or any(k in allow for k in ("grades", "grade_min", "years", "year_min", "year_max"))):
        raise Unknown(content)  # '음대생 수강 불허(국악과만 수강 가능)'·'4학년 수강불허': 막는 말과 받는 말이 섞이거나 학년을 막음
    rest = BOTH.sub("", rest)
    rest = SECOND.sub("", rest)
    rest = MAIN.sub("", rest)
    rest = TAIL_FILLER.sub("", FILLER.sub("", rest))
    rest = re.sub(r"\d", "", rest)
    if re.search(r"[가-힣A-Za-z]", rest):
        raise Unknown(rest)
    if who:
        merged: dict[tuple, dict] = {}
        for w in who:  # 같은 학과가 주전공과 제2전공으로 따로 나오면 둘 다 받는다
            key = (w["name"], tuple(w.get("units") or w.get("programs") or []))
            if key in merged and merged[key]["role"] != w["role"]:
                merged[key]["role"] = "any"
            merged.setdefault(key, dict(w))
        allow["who"] = list(merged.values())
    if excepts:
        uniq: dict[tuple, dict] = {}
        for w in excepts:
            key = (w["name"], tuple(w.get("units") or w.get("programs") or []))
            if key in uniq and uniq[key]["role"] != w["role"]:
                uniq[key]["role"] = "any"
            uniq.setdefault(key, dict(w))
        allow["except"] = list(uniq.values())
    if not allow and everyone:
        return None
    if not allow and weak:
        return {"weak": True}
    if not allow:
        raise Unknown(content)
    return allow


def _who_name(w: dict) -> str:
    """'생명과학부 주전공', '소비자학 주전공'(전공 이름은 '전공'을 떼고), '공과대학'(단과대는 소속이라 그대로)"""
    if w.get("role") != "main" or w.get("college"):
        return w["name"]
    return re.sub(r"전공$", "", w["name"]) + " 주전공"


def _target(allow: dict | None) -> str:
    """대상 글('물리·천문학부만', '생명과학부 주전공 1학년만', '통계학과 제외')"""
    if allow is None:
        return "누구나"
    who = ", ".join(_who_name(w) for w in allow.get("who", []))
    cond = []
    if "grades" in allow:
        cond.append(", ".join(str(g) for g in allow["grades"]) + "학년")
    if "grade_min" in allow:
        cond.append(f"{allow['grade_min']}학년 이상")
    if "years" in allow:
        cond.append(", ".join(str(y) for y in allow["years"]) + "학번")
    if "year_min" in allow:
        cond.append(f"{allow['year_min']}학번부터")
    if "year_max" in allow:
        cond.append(f"{allow['year_max']}학번까지")
    if allow.get("first_time") and not who and not cond:
        cond.append("초수강")
    exc = ", ".join(e["name"] for e in allow.get("except", []))
    text = " ".join(x for x in (who, " ".join(cond)) if x)
    if text:
        text += "만"
    if exc:
        text = (text + ", " if text else "") + exc + " 제외"
    return text or "누구나"


def _until(stage: dict, text: str) -> str | None:
    """'4일차까지 1학년만', '8월 7일까지 공과대학만'. 끝이 열린 단계(…부터, 늘)는 None"""
    days = stage.get("days")
    if days and days[1] is not None:
        return f"{days[1]}일차까지 {text}"
    if stage.get("dates"):
        d = date.fromisoformat(stage["dates"][1])
        return f"{d.month}월 {d.day}일까지 {text}"
    return None


def _merge(base: dict | None, stage: dict | None) -> dict | None:
    """밑 규칙(단계 앞의 'X만')과 단계 규칙을 함께 건다. 둘 다 '누구'가 있고 다르면 읽지 않는다."""
    if stage is not None and stage.get("weak"):
        if base is None:
            return None
        return {k: v for k, v in base.items() if k not in ("grades", "grade_min")}  # '5일차부터 전학년': 밑 규칙의 학년만 푼다
    if base is None or stage is None:
        return stage  # 단계가 '수강반 해제'면 밑 규칙도 풀린다
    if base.get("who") and stage.get("who") and base["who"] != stage["who"]:
        raise Unknown("밑 규칙과 단계 규칙의 대상이 다름")
    out = dict(base)
    out.update(stage)
    return out


def _span(m: re.Match, term: str) -> dict:
    """단계 표시 → {"days": [처음, 끝|None]}(+ through_change) · {"change": True} · {"dates": ["2026-08-04", "2026-08-07"]}"""
    if m.group("range"):
        return {"days": [int(m.group("a")), int(m.group("b"))]}
    if m.group("upto"):
        return {"days": [1, int(m.group("u"))]}
    if m.group("from"):
        return {"days": [int(m.group("f")), None], "through_change": True}
    if m.group("one"):
        n = int(m.group("o"))
        return {"days": [n, n]}
    if m.group("change"):
        return {"change": True}
    if m.group("main"):
        return {"days": [1, None]}
    if m.group("after"):
        return {"after": True}  # 앞 단계 다음 날부터(parse_limit 이 채운다)
    year = int(term[:4])
    return {"dates": [f"{year}-{int(m.group('m1')):02d}-{int(m.group('d1')):02d}",
                      f"{year}-{int(m.group('m2')):02d}-{int(m.group('d2')):02d}"]}


def parse_limit(remark: str, section_dept: str, names: Names, term: str) -> dict | None:
    """비고 하나 → {"kind": "rule"|"mark"|"note", ...} 또는 None(제한 없음)."""
    masked = mask_emails(remark or "").strip()
    if not masked:
        return None
    note = LEAD.sub("", masked).strip()
    mark = "®" in masked
    if not note:
        return {"kind": "mark"} if mark else None
    if SPECIAL.search(masked) or NOTE_ONLY.search(masked):
        return {"kind": "note", "note": note}
    text = compact(LEAD.sub("", masked))
    try:
        stages, base, seen_rule = [], None, False
        for clause in _clauses(text):
            marks = list(STAGE.finditer(clause))
            if not marks:
                if INFO.search(clause):
                    continue
                if not RULE_WORDS.search(clause):
                    if not names.find(clause):
                        continue  # 이름도 제한 말도 없는 조각('(Python 활용 강좌)')
                    allow = _who(clause + "만", names, section_dept)  # '®첨단융합학부'·'(수강대상) 의대, 공대': 그 학생들의 수강반
                else:
                    allow = _who(clause, names, section_dept)
                if base is not None or stages:
                    raise Unknown(clause)
                base, seen_rule = (None if allow and allow.get("weak") else allow), True
                continue
            head = clause[:marks[0].start()]
            if names.find(head) or HEAD_WORDS.search(FILLER.sub("", _strip_parens(head))):
                raise Unknown(clause)
            # 붙은 표시('6일차와 변경기간에는', '5일차~, 변경기간')는 한 단계로 묶는다
            groups, cur = [], []
            for i, m in enumerate(marks):
                cur.append(m)
                nxt = marks[i + 1].start() if i + 1 < len(marks) else len(clause)
                between = FILLER.sub("", re.sub(r"와|과|및", "", clause[m.end():nxt]))
                if i + 1 < len(marks) and not re.search(r"[가-힣A-Za-z]", between):
                    continue
                groups.append((cur, clause[m.end():nxt]))
                cur = []
            for group, content in groups:
                allow = _who(content, names, section_dept)
                for m in group:
                    stages.append({**_span(m, term), "allow": allow})
                seen_rule = True
        for i, st in enumerate(stages):
            if st.get("after"):
                prev = stages[i - 1].get("days") if i else None
                if not prev or prev[1] is None:
                    raise Unknown("'이후' 앞 단계가 없음")
                st.pop("after")
                st.update({"days": [prev[1] + 1, None], "through_change": True})
        if not seen_rule:
            return {"kind": "mark"} if mark else None
        if any("dates" in s for s in stages) and any(s.get("days") for s in stages):
            raise Unknown("날짜와 일차가 섞임")
        if not stages:
            stages = [{"days": None, "allow": base}]
        else:
            stages = [{**s, "allow": _merge(base, s["allow"])} for s in stages]
            stages = [{**s, "allow": None if s["allow"] and s["allow"].get("weak") else s["allow"]} for s in stages]
            if base is not None:
                stages.append({"days": None, "rest": True, "allow": base})
        uniq = []
        for s in stages:
            if s not in uniq:
                uniq.append(s)
        spans = [json.dumps({k: v for k, v in s.items() if k != "allow"}, sort_keys=True) for s in uniq]
        if len(spans) != len(set(spans)):
            raise Unknown("같은 단계에 다른 대상")  # 두 판의 글이 이어 붙은 비고
        for s in uniq:
            s["text"] = _target(s["allow"])
            until = _until(s, s["text"]) if s["allow"] is not None else None
            if until:
                s["until"] = until
        if all(s["allow"] is None for s in uniq):
            return {"kind": "mark"} if mark else None
        return {"kind": "rule", "stages": uniq, "note": note}
    except Unknown:
        return {"kind": "note", "note": note}


# ---------------------------------------------------------------- 수강신청 일정표

def schedule_of(rows: list[dict], holidays: set[str] | frozenset = frozenset()) -> dict | None:
    """수강신청 사이트 첫 화면 일정표의 줄들 → {"days": {"1": "2026-08-04", …}, "change": ["2026-08-31", "2026-09-04"]}.

    SNUTT 처럼 '선착순'(신입생 줄 빼고)은 본 수강신청, '수강신청변경'은 변경기간으로 본다. 일차는 그 줄들의 평일(공휴일 빼고)을 날짜 차례로
    1일차부터 센다. 줄 이름에 '(5~6일차)' 처럼 일차가 적혀 있고 평일 수와 맞으면 그대로 쓴다.
    """
    def weekdays(start: str, end: str) -> list[str]:
        a, b = date.fromisoformat(start), date.fromisoformat(end)
        out = []
        while a <= b:
            if a.weekday() < 5 and a.isoformat() not in holidays:
                out.append(a.isoformat())
            a += timedelta(days=1)
        return out

    main = [r for r in rows if "선착순" in r["type"] and "신입생" not in r["type"] and "변경" not in r["type"]]
    change = [r for r in rows if "수강신청변경" in r["type"]]
    days: dict[str, str] = {}
    labelled = bool(main)
    for r in sorted(main, key=lambda r: r["start"]):
        m = re.search(r"(\d)\s*(?:일차)?\s*[~∼\-]\s*(\d)\s*일차|(\d)\s*일차", r["type"])
        ds = weekdays(r["start"], r["end"])
        if not m:
            labelled = False
            break
        a = int(m.group(1) or m.group(3))
        b = int(m.group(2) or m.group(3))
        if b - a + 1 != len(ds):
            labelled = False
            break
        days.update({str(n): d for n, d in zip(range(a, b + 1), ds)})
    if not labelled:
        days = {}
        for d in sorted({d for r in main for d in weekdays(r["start"], r["end"])}):
            days[str(len(days) + 1)] = d
    out = {}
    if days:
        out["days"] = days
    if change:
        out["change"] = [min(r["start"] for r in change), max(r["end"] for r in change)]
    return out or None


def update_registration(term: str, windows: list[dict], today: str, path: Path = REGISTRATION) -> bool:
    """sync.py 가 부른다: 그 학기 일정표 줄을 data/registration.json 에 모은다(지난 줄은 첫 화면에서 빠져도 남긴다). 바뀌었으면 True"""
    if not windows:
        return False
    data = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {
        "source": "서울대학교 수강신청 사이트", "url": SITE, "terms": {}}
    t = data["terms"].setdefault(term, {"collected": None, "rows": []})
    have = {(r["type"], r["start"], r["end"]) for r in t["rows"]}
    new = [{"type": w["type"], "start": str(w["start"]), "end": str(w["end"])} for w in windows]
    added = [r for r in new if (r["type"], r["start"], r["end"]) not in have]
    t["rows"] = sorted(t["rows"] + added, key=lambda r: (r["start"], r["type"]))
    changed = bool(added) or t["collected"] != today
    t["collected"] = today  # 일정표를 마지막으로 확인한 날(자료 출처의 기준일)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    return changed


# ---------------------------------------------------------------- 편람 엑셀 → 자료

def read_rows(path: Path) -> list[dict]:
    import pandas as pd

    raw = pd.read_excel(path, header=None, engine="xlrd" if path.suffix.lower() == ".xls" else None, dtype=str)
    h = next(i for i in range(min(len(raw), 15)) if any("교과목번호" in str(c) for c in raw.iloc[i].tolist()))
    header = [str(c).strip() for c in raw.iloc[h].tolist()]
    col = {k: next((i for i, x in enumerate(header) if k in x), None)
           for k in ("교과목번호", "강좌번호", "개설대학", "개설학과", "이수과정", "비고")}
    out = []
    for row in raw.iloc[h + 1:].itertuples(index=False):
        def get(k):
            i = col[k]
            v = None if i is None else row[i]
            s = "" if v is None else str(v).strip()
            return "" if s.lower() in ("nan", "none", "<na>") else s
        if not get("교과목번호"):
            continue
        no = get("강좌번호")
        no = no[:-2] if no.endswith(".0") else no
        out.append({"id": get("교과목번호"), "no": no.zfill(3) if no.isdigit() else no, "college": get("개설대학"),
                    "dept": get("개설학과") or get("개설대학"), "program": get("이수과정"), "remark": get("비고")})
    return out


def stamp_of(path: Path) -> str | None:
    """'2026-2_2026-10-12_1454.xls' → '2026-10-12T14:54+09:00'(편람을 받은 시각 = 비고를 읽은 자료 시각)"""
    m = re.search(r"_(\d{4}-\d{2}-\d{2})_(\d{2})(\d{2})", path.name)
    return f"{m.group(1)}T{m.group(2)}:{m.group(3)}+09:00" if m else None


def load_catalog(path: Path = CATALOG) -> dict:
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}


def build(rows: list[dict], term: str, read_at: str | None, catalog: dict) -> dict:
    """분반 목록 → {term, read_at, rules: [...], sections: {"과목번호-분반": 규칙 차례}}. 같은 비고는 규칙 하나를 같이 쓴다"""
    names = Names({r["dept"]: r["college"] for r in rows}, catalog)
    rules: list[dict] = []
    index: dict[str, int] = {}
    sections: dict[str, int] = {}
    counts = {"rule": 0, "mark": 0, "note": 0}
    for r in rows:
        if r["program"] and r["program"] != "학사":
            continue
        lim = parse_limit(r["remark"], r["dept"], names, term)
        if lim is None:
            continue
        key = json.dumps(lim, ensure_ascii=False, sort_keys=True)
        if key not in index:
            index[key] = len(rules)
            rules.append(lim)
        sections[f"{r['id']}-{r['no']}"] = index[key]
        counts[lim["kind"]] += 1
    return {"term": term, "read_at": read_at, "source": "수강편람 비고", "site": SITE, "counts": counts,
            "rules": rules, "sections": dict(sorted(sections.items()))}


def build_file(path: Path, term: str, out: Path = OUT, catalog: dict | None = None) -> dict:
    data = build(read_rows(path), term, stamp_of(path), load_catalog() if catalog is None else catalog)
    out.mkdir(parents=True, exist_ok=True)
    (out / f"{term}.json").write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    return data


def latest_raw(term: str, raw: Path = RAW) -> Path | None:
    files = sorted(raw.glob(f"{term}_*.xls*"))
    return files[-1] if files else None


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--term", action="append", help="학기(예: 2026-2). 없으면 data/raw 에 있는 학기 모두")
    ap.add_argument("--raw", help="편람 엑셀 하나(--term 하나와 같이)")
    ap.add_argument("--out", default=str(OUT))
    args = ap.parse_args()
    terms = args.term or sorted({p.name.split("_")[0] for p in RAW.glob("*_*.xls*")})
    catalog = load_catalog()
    for term in terms:
        path = Path(args.raw) if args.raw else latest_raw(term)
        if not path:
            continue
        data = build_file(path, term, Path(args.out), catalog)
        c = data["counts"]
        print(f"{term}: 규칙 {c['rule']} · 기호만 {c['mark']} · 원문 {c['note']} (규칙 {len(data['rules'])}가지) → {args.out}/{term}.json")


if __name__ == "__main__":
    main()
