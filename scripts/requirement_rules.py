"""졸업 요건 줄 다듬기(update135): 규칙 설명 줄 표시, 외국어진행강좌 셈 꼴, 백엔드가 찾은 사실. requirements_import.py 가 부른다.

1. 규칙 설명 줄(type 'rule'): 채울 요건이 아니라 중복 인정·선이수·이름 바뀜·인정 범위·권장 같은 설명(디자인 update127 ⑧,
   프론트엔드 '이수 규칙 N개' 시트). 앱은 요건 줄·요건 수·확인 필요에서 빼고 따로 보인다(requirements.js gradView 의 rules).
   RULE_ROWS 는 2026-11-16 '졸업_요건_확인_필요_목록.csv'(공유 폴더)에서 '규칙 설명(요건 아님)'으로 가른 99줄, 그 밖은 글로 가른다(is_rule).
2. 외국어진행강좌(영어 진행 강좌) 줄 → r['foreign'] = {min_count|min_credits, major_count|major_credits, lang, exclude}:
   학기마다 외국어로 진행된 강좌(lecture_lang.json)와 들은 분반으로 센다(requirements.js evaluateForeign). '권장(필수 아님)'은 규칙 설명.
3. FACTS: 공개 자료로 백엔드가 확인한 것(출처는 과정의 sources 에 더한다).
4. 복수전공 줄에 묶인 졸업논문(update137): 그 역할(double)에 졸업논문 줄이 따로 없으면 따로 줄로 뺀다(DOUBLE_THESIS).
표준 라이브러리만.
"""

from __future__ import annotations

import re

CHECKED = "2026-11-17"

# 확인 필요 목록에서 '규칙 설명(요건 아님)'으로 가른 줄: 과정 id → 줄 id
RULE_ROWS = {
    "animal-biotech": ["animal-rename", "animal-stat-once"],
    "life-sciences": ["bio-ge-alt", "bio-ge-exempt"],
    "p-0975d7e3": ["edu-eng-teach-literacy"],
    "p-121aa7bb": ["ece-overlap", "ece-prereq"],
    "p-13df6045": ["korean-practice-rules"],
    "p-1643f5b3": ["sti-elective-cap", "sti-track-ilseon"],
    "p-18cd75ef": ["cse-similar"],
    "p-1bcbd6fe": ["asia-must-pair"],
    "p-1f9e8c1b": ["jo-y2-practice-2024"],
    "p-21e29be7": ["ai-other-dept"],
    "p-234741e0": ["nur-double-minor", "nur-ge-world"],
    "p-2408e57e": ["rus-native"],
    "p-26c40934": ["econ-prereq"],
    "p-2c21b927": ["cl-ge-world"],
    "p-2cfbd5f9": ["sdmd-limits"],
    "p-2d920bdb": ["edu-fr-teach-literacy"],
    "p-35c6807d": ["edu-pe-ge-pe", "edu-pe-geold-pe", "edu-pe-grad-practical", "edu-pe-teach-literacy"],
    "p-38d77850": ["chem-elective", "chem-ge-exempt"],
    "p-3b4ed39d": ["astro-ge-calc", "astro-ge-exempt"],
    "p-3b9c97b2": ["edu-bio-teach-literacy"],
    "p-41637bd4": ["edu-kor-teach-literacy"],
    "p-41df1808": ["cls-overlap", "cls-pre-cap", "cls-second", "cls-substitute"],
    "p-44f16156": ["kh22-elective"],
    "p-4ccd7012": ["korean-practice-rules"],
    "p-509f9c7c": ["cs-ge-world"],
    "p-526889bd": ["hst-overlap"],
    "p-558e07aa": ["cs-elective"],
    "p-56afea81": ["edu-eth-overlap", "edu-eth-teach-literacy"],
    "p-58922b29": ["math-ge-exempt"],
    "p-5e5648a7": ["hist-classification", "hist-no-overlap"],
    "p-60140ad3": ["aes-overlap"],
    "p-638ed6b5": ["stat-ge-calc", "stat-ge-exempt", "stat-no-mathstat", "stat-transfer"],
    "p-67f0f7cb": ["fn-ge-free", "fn-ge-world"],
    "p-73756aa5": ["asia-must-pair"],
    "p-76162784": ["phys-elective", "phys-ge-calc", "phys-ge-exempt"],
    "p-76b45405": ["iss-prereq", "sti-elective-cap", "sti-track-ilseon"],
    "p-7e32b985": ["edu-chem-elective", "edu-chem-teach-literacy"],
    "p-7fccc8d9": ["dh-prereq", "sti-elective-cap", "sti-track-ilseon"],
    "p-89f20073": ["ah22-transfer"],
    "p-8a8be90a": ["sti-elective-cap", "sti-track-ilseon"],
    "p-8af8eacd": ["asia-must-pair"],
    "p-923b6f9e": ["korean-practice-rules"],
    "p-97f3ee92": ["gw-freshman-seminar"],
    "p-9baede1b": ["edu-phy-teach-literacy"],
    "p-a346f2bb": ["dent-ge-math"],
    "p-a758e356": ["sdm-cls-courses", "sdm-limits"],
    "p-b13fbed6": ["socio-overlap"],
    "p-b1cc35e9": ["hist-classification", "hist-no-overlap"],
    "p-bf59d12c": ["edu-ed-overlap", "edu-ed-teach-literacy"],
    "p-c1c26b61": ["sti-elective-cap", "sti-track-ilseon"],
    "p-c43beb02": ["hist-classification", "hist-no-overlap"],
    "p-cae89602": ["edu-soc-teach-literacy"],
    "p-d3470527": ["comm-elective"],
    "p-d569f217": ["edu-his-elective-credit", "edu-his-teach-literacy"],
    "p-db64f2a8": ["cf-ge-world"],
    "p-dcff7393": ["edu-ger-teach-literacy"],
    "p-ddda9e11": ["edu-math-geold-comp", "edu-math-teach-literacy"],
    "p-e5fab35c": ["sees-ge-exempt"],
    "p-ef30f28f": ["asia-must-pair"],
    "p-f17d6c49": ["edu-geo-teach-literacy"],
    "p-f3e53a1e": ["korean-practice-rules"],
    "p-f61bbb8f": ["edu-earth-teach-literacy"],
    "p-f76a4a1c": ["korean-practice-rules"],
    "p-fccadae3": ["med-elective-scope"],
    "p-ff570a3c": ["alc-elective-scope"],
}

# 글로 가르는 규칙 설명: 기준 수·과목 목록·셈 꼴이 없는 줄 가운데 겹쳐(중복) 인정·선이수 설명
RULE_ID = re.compile(r"-(?:no-)?overlap$|-prereq$")
RULE_TEXT = re.compile(r"^(?:다전공 겹쳐 인정|중복 ?인정|중복학점 인정|선이수)")


def countless(r: dict) -> bool:
    return (r.get("min_count") is None and r.get("min_credits") is None and not r.get("courses") and not r.get("sum")
            and not r.get("extra") and not r.get("foreign") and not r.get("same_as"))


def counts(r: dict) -> bool:
    """앱이 세는 줄인가(학점 합·분야·갈래·목록과 기준 수). 확인 필요 목록 때 규칙 설명으로 갈랐어도 그 뒤 셀 수 있게 된 줄(전선 학점 합 등)은 요건이다"""
    return bool(r.get("sum") or r.get("same_as") or r.get("foreign") or r.get("extra")
                or (r.get("courses") and (r.get("min_count") is not None or r.get("min_credits") is not None)))


def is_rule(pid: str, r: dict) -> bool:
    if r.get("type") == "rule" or counts(r):
        return False
    if r["id"] in RULE_ROWS.get(pid, ()):
        return True
    return r.get("type") != "ge" and countless(r) and bool(RULE_ID.search(r["id"]) or RULE_TEXT.match(r.get("text") or ""))


# ---------------------------------------------------------------- 외국어진행강좌

FOREIGN = re.compile(r"외국어\s?진행|영어\s?진행|외국어로 진행")
RECOMMENDED = re.compile(r"권장\s*[(—–-]?\s*(?:필수|의무)\s*아님|'권장'\s*\(필수 아님\)|\)은 권장|은 권장$")
SKIP = re.compile(r"생명존중|안전환경|음악대학 안|공개 자료에서|학번별 전공생|복수전공|다전공|소그룹|선택 전공의 이수규정|단일\(심화\) \d+과목")


def foreign_spec(text: str) -> dict | None:
    """외국어진행강좌 글 → 셈 꼴. 못 읽으면 None(줄은 그대로). '권장'이면 {'recommended': True}"""
    t = str(text or "")
    if not FOREIGN.search(t) or SKIP.search(t):
        return None
    if RECOMMENDED.search(t):
        return {"recommended": True}
    spec: dict = {"lang": "영어" if re.search(r"영어\s?진행", t) and not re.search(r"외국어\s?진행", t) else "any"}
    m = re.search(r"(\d+)\s*과목", t)
    mc = re.search(r"(\d+)\s*학점 이상", t)
    if mc and (not m or mc.start() < m.start()):
        spec["min_credits"] = int(mc.group(1))
    elif m:
        spec["min_count"] = int(m.group(1))
    else:
        return None
    major = re.search(r"(?:주?전공|전공 과목|영문 전공|서문 전공|국사학과 전공|종교학 전공)\s*(\d+)\s*(과목|강좌|학점)?|그중\s*(\d+)\s*과목 이상은 전공|(\d+)학점 이상 전공", t)
    if major:
        n = next(int(g) for g in major.groups() if g and g.isdigit())
        unit = major.group(2) or ("학점" if major.group(4) else "과목")
        if unit == "학점":
            spec["major_credits"] = n
        else:
            spec["major_count"] = n
    if not major and "그중" in t:
        return None  # '그중 회화 1과목'·'종교학 관련 교양 1과목'처럼 못 읽은 조건이 남는다
    excl = []
    if re.search(r"대학영어(?:·고급영어)?\s*제외|외국어 영역 영어 과목은 불인정", t):
        excl += ["대학영어", "고급영어"] if re.search(r"고급영어\s*제외|외국어 영역 영어", t) else ["대학영어"]
    if re.search(r"기초영어 제외", t):
        excl.append("기초영어")
    if excl:
        spec["exclude"] = excl
    return spec


# ---------------------------------------------------------------- 백엔드가 찾은 사실

BSE_RULES = {"title": "바이오시스템공학전공 누리집 — 학사내규(2022)", "url": "https://bse.snu.ac.kr/%ED%95%99%EC%82%AC%EB%82%B4%EA%B7%9C2022/",
             "locator": "졸업논문 근거: 학칙 제88조, 농업생명과학대학 「학사학위논문심사에 관한 시행 지침」(2011.6.9.)", "accessed": CHECKED}
ANIBIO_BOARD = {"title": "동물생명공학전공 — 게시판 자료실", "url": "https://anibiotech.snu.ac.kr/index.php?hCode=BOARD&bo_idx=5",
                "locator": "'[졸업]학사 졸업논문양식'(2021-06-03)", "accessed": CHECKED}
CALS_FOREIGN = {"title": "동물생명공학전공 — 졸업요건 학부과정(2022년도)", "url": "https://anibiotech.snu.ac.kr/index.php?hCode=EDU_03_03_08",
                "locator": "1. 기본 이수 요건 마(농업생명과학대학 공통: 2008학년도 신입생부터 외국어진행강좌 3과목, 그중 전공 1과목 이상, 대학영어 포함)",
                "accessed": CHECKED}


def _thesis(course: str, extra_src: tuple = ()) -> dict:
    return {"text": f"졸업논문(학사학위논문) 심사 합격(학칙·농업생명과학대학 학사학위논문심사 시행 지침). 학과는 {course}에서 쓴다",
            "status": "확인", "min_count": 1, "sources": (BSE_RULES, *extra_src), "note": "과목 없이 논문만 내는 길이 있는지는 학과 확인"}


# (과정 id, 줄 id) → 바꿀 값. sources 는 과정 sources 에 더하고 src 로 가리킨다
FACTS = {
    ("animal-biotech", "animal-thesis"): _thesis("4학년 동물생명공학논문연구(M1702.000400, 3학점)", (ANIBIO_BOARD,)),
    ("p-1b7f1668", "crop-thesis"): _thesis("작물생명과학 학사논문연구(M1672.000100, 3학점)"),
    ("p-d2e2af8f", "rse-thesis"): _thesis("지역시스템공학전공 학사논문연구(M1708.000200, 3학점)"),
}
COLLEGE_FACTS = {  # 단과대 공통 줄: (대학, 줄 id) → 바꿀 값
    ("농업생명과학대학", "cals-foreign-lang-lectures"): {"status": "확인", "sources": (CALS_FOREIGN,)},
}


# ---------------------------------------------------------------- 복수전공 줄의 졸업논문(update137)
# 사용자 11/17 '화생공은 졸업논문 작성 이게 과목이 따로 없던데, 이런 건 체크박스로 두면 좋을 듯'(프론트엔드 요청): 복수전공 줄이 과목 목록·학점과
# 졸업논문을 한 줄에 묶어 졸업논문을 따로 셀 수 없던 과정. 복수전공(double)에 걸린 졸업논문 줄이 따로 없는 것만(나머지는 이미 thesis 줄이 double 에도 걸려 있다).
# 졸업논문 쪽은 type 'thesis', applies_to ['double'] 줄로: 과목이 없으면 목록 없이(앱이 확인 필요와 시트의 '이 요건을 채웠어요' 체크), 과목이 있으면 그 목록.
# cut: 복수전공 줄 글에서 뺄 부분(그 줄은 과목·학점만 남는다), move: 복수전공 줄의 과목을 졸업논문 줄로 옮긴다, from: 이 학번부터 걸린다
DOUBLE_THESIS = {
    ("chem-bio-eng", "cbe-double"): {
        "id": "cbe-double-thesis", "name": "졸업논문", "cut": r"\s*\+\s*졸업논문 작성",
        "text": "졸업논문 작성(복수전공). 학부에 논문 과목이 따로 없다",
        "note": "과목이 없어 앱에서는 '이 요건을 채웠어요'로 표시한다."},
    ("p-db64f2a8", "cf-double"): {
        "id": "cf-double-thesis", "name": "졸업논문", "cut": r"\s*\+\s*졸업논문, 아동가족학논문작성 필수", "move": True,
        "text": "졸업논문(복수전공): 아동가족학논문작성 필수",
        "note": "논문작성 필수는 '18학번부터 적용'(학과 자료)."},
    ("p-8bc02fbf", "musicology-double"): {
        "id": "musicology-double-thesis", "name": "학사논문", "cut": r"\s*\+\s*학사논문 제출·발표", "src_from": "musicology-thesis",
        "text": "학사논문 제출·발표(복수전공): 전공이론 2개 학기 이수 뒤 논문을 내고 학기말 논문발표회에서 발표·심사 통과"},
    ("p-085d9249", "piano-double"): {
        "id": "piano-double-recitals", "name": "졸업연주", "from": 2021,
        "cut": r"\s*2021학번부터 학사과정 연주회·콘체르토·졸업연주와 과제곡\([^)]*\) 필수\.?",
        "text": "학사과정 연주회·콘체르토·졸업연주와 과제곡(Bach·고전·낭만·근현대 각 1곡)(복수전공, 2021학번부터)"},
}


def split_double_thesis(prog: dict) -> int:
    """복수전공 줄에 묶인 졸업논문을 따로 줄로 뺀다(DOUBLE_THESIS). 그 판에 double 에 걸린 thesis 줄이 이미 있으면 그대로. 뺀 줄 수"""
    n = 0
    for v in prog.get("versions") or []:
        reqs, out = v.get("requirements") or [], []
        has = any(r.get("type") == "thesis" and (not r.get("applies_to") or "double" in r["applies_to"]) for r in reqs)
        for r in reqs:
            out.append(r)
            spec = DOUBLE_THESIS.get((prog["id"], r["id"]))
            if not spec or has:
                continue
            r["text"] = re.sub(spec["cut"], "", r["text"]).strip()
            if spec.get("from") and v["entry_years"][1] < spec["from"]:
                continue  # 그 학번들에는 걸리지 않는다(줄 글에서 그 말만 뺀다)
            courses = []
            if spec.get("move"):
                courses, r["courses"] = r.get("courses") or [], []
            src = list(r.get("src") or [])
            if spec.get("src_from"):
                for x in reqs:
                    if x["id"] == spec["src_from"]:
                        src += [s for s in x.get("src") or [] if s not in src]
            row = {"id": spec["id"], "type": "thesis", "applies_to": ["double"], "text": spec["text"],
                   "min_count": len(courses) or None, "min_credits": None, "courses": courses, "status": "확인", "src": src, "name": spec["name"]}
            if spec.get("note"):
                row["note"] = spec["note"]
            if r.get("note") and "졸업논문은 과목이 아니라" in r["note"]:
                r["note"] = "졸업논문은 따로 줄(졸업논문)로 뺐다."
            out.append(row)
            n += 1
        v["requirements"] = out
    return n


def add_source(prog: dict, s: dict) -> str:
    """과정 sources 에 출처를 더하고 그 열쇠(같은 것이 있으면 그것)"""
    srcs = prog.setdefault("sources", {})
    for k, v in srcs.items():
        if v.get("title") == s.get("title") and v.get("locator") == s.get("locator"):
            return k
    n = 1 + max([int(k[1:]) for k in srcs if re.fullmatch(r"s\d+", k)] or [0])
    srcs[f"s{n}"] = dict(s)
    return f"s{n}"


def refine(prog: dict) -> dict[str, int]:
    """과정 하나: 사실 → 외국어진행강좌 셈 꼴('권장'은 규칙 설명). 셀 수 있는 꼴로 바꾸기(requirements_lists.apply) 앞에. 바꾼 줄 수(종류별)"""
    pid, done = prog["id"], {}

    def hit(k):
        done[k] = done.get(k, 0) + 1

    split = split_double_thesis(prog)
    if split:
        done["복수전공 졸업논문 줄"] = split

    for v in prog.get("versions") or []:
        for r in v.get("requirements") or []:
            fact = FACTS.get((pid, r["id"])) or COLLEGE_FACTS.get((prog.get("college"), r["id"]))
            if fact:
                for k, val in fact.items():
                    if k == "sources":
                        r["src"] = list(dict.fromkeys(list(r.get("src") or []) + [add_source(prog, s) for s in val]))
                    else:
                        r[k] = val
                hit("사실")
            if r.get("type") != "ge":
                spec = foreign_spec(r.get("text"))
                if spec and spec.get("recommended"):
                    r["type"] = "rule"
                    hit("규칙 설명(권장)")
                elif spec and not r.get("courses"):
                    r["foreign"] = spec
                    hit("외국어진행강좌")
    return done


def mark_rules(prog: dict) -> int:
    """규칙 설명 줄 표시(type 'rule'). 셀 수 있는 꼴로 바꾼 뒤에(셀 수 있게 된 줄은 요건으로 남긴다). 바꾼 줄 수"""
    n = 0
    for v in prog.get("versions") or []:
        for r in v.get("requirements") or []:
            if is_rule(prog["id"], r):
                r["type"] = "rule"
                n += 1
    return n
