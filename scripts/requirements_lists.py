"""졸업 요건 줄을 앱이 셀 수 있는 꼴로 바꾼다(update127, 사용자 11/16 '이런 조사 안 된 것들 다 최대한 조사해서 목록으로 만들어줘').

requirements_import.py 가 과정 파일을 쓰기 전에 부른다(apply). 조사 자료의 글·extra·과목을 읽어
  1. 교양 줄 → 분야 줄(영역마다 번호 앞자리 prefixes) · 갈래 줄 · 과목 목록 줄 · 학점 합 줄(sum)
  2. 학과 전공 학점 줄(전공 N학점 · 전공선택 N학점 · 복수·부전공 전체 N학점) → 학점 합 줄(sum: of major)
  3. '전체·전공 평점 2.0 이상'만 적은 줄 → 공통 졸업 평점과 같은 줄(same_as)
  4. 인문대학 공통(college_common 참조 줄) → 학번에 맞는 공통 요건 줄들(조사 2차 college_common, 1차 인문대 공통 요건)
조사 자료의 원래 extra 는 extra_research 에 두고(앱은 쓰지 않음), 바꾼 줄에는 auto(규칙 이름)를 단다. 형식과 근거는 docs/requirements.md 1절.

영역 번호: 교양 과목 번호의 앞자리가 곧 영역이다(학교 교양 영역·과목 대응표 2024-2026, data/requirements/course_map.json 에서 모든 줄이 맞음).
  2025 새 교양: F11·F12 글쓰기와 말하기, F21~F29 외국어(F21 영어), F31·F32 수학, F33~F36 과학, F37 컴퓨팅, C10~C40 지성의 열쇠 네 영역,
  E11·E12 지식의 세계, E20 공감과 공존, E31·E32 자율과 창의, E41·E42 예술, E43 체육, E51·E52 학부생 세미나, V10·V20·V30 베리타스.
  옛 교양(2019~2024학번): 031·L0440 사고와 표현, 032·L0441 외국어, 033·L0442 수량적 분석과 추론, 034·L0443 과학적 사고와 실험,
  035·L0444 컴퓨터와 정보 활용, 041~047·L0545~L0551 학문의 세계 일곱 영역, 051·L0652 체육, 052·L0653 예술 실기,
  053·L0654 대학과 리더십, 054·L0655 창의와 융합, 055·L0656 한국의 이해.
옛 학번이 새 번호로 들은 같은·대체 과목은 대표 번호(2024 번호)로 옛 영역에 든다(앱 prefixHits). 대응 없는 새 과목은 영역에 안 들고 교양 학점으로만 센다
(학부대학 '입학년도 공통교육과정 이수규정 기준', 인문대학 공지 2026-08-07).
표준 라이브러리만 쓴다.
"""

from __future__ import annotations

import copy
import re

NEW_AREAS = {
    "글쓰기와 말하기": ["F11.", "F12."],
    "외국어": [f"F2{i}." for i in range(1, 10)],
    "영어": ["F21."],
    "수학·과학·컴퓨팅": [f"F3{i}." for i in range(1, 8)],
    "수학": ["F31.", "F32."],
    "과학": ["F33.", "F34.", "F35.", "F36."],
    "과학·컴퓨팅": ["F33.", "F34.", "F35.", "F36.", "F37."],
    "물리": ["F33."], "화학": ["F34."], "생물": ["F35."], "지구과학": ["F36."],
    "컴퓨팅": ["F37."],
    "문화 해석과 상상": ["C10."],
    "역사적 탐구와 철학적 사유": ["C20."],
    "인간의 이해와 사회 분석": ["C30."],
    "과학적 사고와 응용": ["C40."],
    "지식의 세계": ["E11.", "E12."],
    "공감과 공존": ["E20."],
    "자율과 창의": ["E31.", "E32."],
    "예술과 체육": ["E41.", "E42.", "E43."],
    "체육": ["E43."],
    "학부생 세미나": ["E51.", "E52."],
    "지성의 확장": ["E11.", "E12.", "E20.", "E31.", "E32.", "E41.", "E42.", "E43.", "E51.", "E52."],
    "베리타스": ["V10.", "V20.", "V30."],
    "베리타스 강좌 1": ["V10."], "베리타스 강좌 2": ["V20."], "베리타스 실천": ["V30."],
}
KEYS = ["문화 해석과 상상", "역사적 탐구와 철학적 사유", "인간의 이해와 사회 분석", "과학적 사고와 응용"]

OLD_AREAS = {
    "사고와 표현": ["031.", "L0440."],
    "외국어": ["032.", "L0441."],
    "수량적 분석과 추론": ["033.", "L0442."],
    "과학적 사고와 실험": ["034.", "L0443."],
    "컴퓨터와 정보 활용": ["035.", "L0444."],
    "언어와 문학": ["041.", "L0545."],
    "문화와 예술": ["042.", "L0546."],
    "역사와 철학": ["043.", "L0547."],
    "정치와 경제": ["044.", "L0548."],
    "인간과 사회": ["045.", "L0549."],
    "자연과 기술": ["046.", "L0550."],
    "생명과 환경": ["047.", "L0551."],
    "체육": ["051.", "L0652."],
    "예술 실기": ["052.", "L0653."],
    "대학과 리더십": ["053.", "L0654."],
    "창의와 융합": ["054.", "L0655."],
    "한국의 이해": ["055.", "L0656."],
}
WORLD = ["언어와 문학", "문화와 예술", "역사와 철학", "정치와 경제", "인간과 사회", "자연과 기술", "생명과 환경"]
# 옛 영어 과목(대학영어 1·2, 고급영어. 기초영어 L0441.000400 은 뺌): 옛 외국어 번호 L0441 안에서 앞자리로 못 가르니 목록으로
OLD_ENGLISH = ["L0441.000600", "L0441.000700", "L0441.000800", "L0441.000900", "L0441.001000", "L0441.001100",
               "L0441.001200", "L0441.001300", "L0441.001400", "L0441.001500"]

NEW_CUES = ("지성의 열쇠", "학문의 토대", "베리타스", "지성의 확장", "글쓰기와 말하기", "수학·과학·컴퓨팅", "2025학번", "2025학년도", "2026학년도")
OLD_CUES = ("학문의 기초", "학문의 세계", "선택 교양", "선택교양", "사고와 표현", "수량적 분석", "과학적 사고와 실험", "컴퓨터와 정보 활용",
            "옛 체계", "2019~2024", "2024학번", "체육계열", "체육실기")


class Tables:
    """교양 대응표(course_map)와 지난 편람(hist: 번호 → (이름, 학점, 학기))에서 과목 객체를 찾는다"""

    def __init__(self, course_map: dict, hist: dict):
        self.rows = (course_map or {}).get("rows") or []
        self.hist = hist or {}
        self.by_code: dict[str, dict] = {}
        for row in self.rows:
            codes = [row[y]["code"] for y in ("2024", "2025", "2026") if row.get(y)]
            for y in ("2024", "2025", "2026"):
                if row.get(y):
                    self.by_code[row[y]["code"]] = {"row": row, "year": y, "codes": codes}

    def credits(self, code: str):
        h = self.hist.get(code)
        if not h:
            return None
        c = h[1]
        return int(c) if float(c).is_integer() else c

    def course(self, code: str, name: str | None = None) -> dict:
        """번호 → {code, name, credits, alt_codes}(대응표의 다른 해 번호를 alt_codes 로)"""
        info = self.by_code.get(code)
        nm = name or (info and info["row"][info["year"]]["name"]) or (self.hist.get(code) or (None,))[0]
        out = {"code": code, "name": nm, "credits": self.credits(code)}
        if out["credits"] is None and info:
            for c in info["codes"]:
                if self.credits(c) is not None:
                    out["credits"] = self.credits(c)
                    break
        alts = [c for c in (info["codes"] if info else []) if c != code]
        if alts:
            out["alt_codes"] = alts
        return out

    def find(self, name: str, cur: str) -> dict | None:
        """과목 이름 → 과목 객체(새 교양은 2025 번호, 옛 교양은 2024 번호를 대표로). 띄어쓰기는 무시"""
        key = re.sub(r"\s+", "", name)
        year = "2025" if cur == "new" else "2024"
        for row in self.rows:
            for y in ("2024", "2025", "2026"):
                x = row.get(y)
                if x and re.sub(r"\s+", "", x["name"]) == key:
                    rep = row.get(year) or x
                    return self.course(rep["code"], rep["name"])
        return None


def _num(pat: str, text: str):
    m = re.search(pat, text)
    return int(m.group(1)) if m else None


def curriculum(text: str, years: list[int]) -> str | None:
    """이 줄의 교양 체계: 'new'(2025~ 학문의 토대·지성의 열쇠) · 'old'(2019~2024 학문의 기초·세계) · None(판이 두 체계에 걸치거나 글과 판이 다름)"""
    lo, hi = years
    by_years = "new" if lo >= 2025 else "old" if hi <= 2024 else None
    new_cue = any(c in text for c in NEW_CUES)
    old_cue = any(c in text for c in OLD_CUES)
    if new_cue and old_cue:
        return None
    if new_cue and by_years == "old":
        return None  # 옛 학번 판에 2025학번 교양 글이 들어간 것(조사 자료가 판마다 나누지 않음) — 셀 수 없다
    if old_cue and by_years == "new":
        return None
    return by_years


def area_group(name: str, cur: str, **kw) -> dict:
    table = NEW_AREAS if cur == "new" else OLD_AREAS
    g = {"name": kw.pop("label", None) or name, "prefixes": list(table[name]), "area": True}
    g.update({k: v for k, v in kw.items() if v is not None})
    return g


def teps_cond(text: str) -> str | None:
    m = re.search(r"TEPS\s*(\d{3})\s*점?\s*(?:\(\s*New\s*(?:TEPS\s*)?(\d{3})\s*점?\s*\)|/New\s*(\d{3}))?", text)
    if not m or "영어 1과목" not in text:
        return None
    new = m.group(2) or m.group(3)
    return f"입학 때 TEPS {m.group(1)}점{f'(New TEPS {new}점)' if new else ''} 이하였다면 영어 1과목이 더 필요해요."


# 예전 TEPS 경계 → New TEPS(학교 영어 수강 기준표의 같은 구간: 2026학년도 학부 신입생 특별시험 안내, 2026학번 졸업 정보. update148)
TEPS_OLD_NEW = {550: 267, 700: 386, 800: 452, 900: 525}


def teps_max(cond: str) -> int | None:
    """조건부 영어 글 → 그 조건이 걸리는 New TEPS 위 끝(이 점수 이하이면 필요. 앱 requirements.js 가 입학 때 TEPS 로 푼다, update148).
    글에 경계가 없으면('입학 때 TEPS 점수에 따라 …', 인문대 2019~2024학번) None: 점수를 알아도 조건부 그대로"""
    m = re.search(r"New TEPS (\d{3})점", cond or "")
    if m:
        return int(m.group(1))
    m = re.search(r"TEPS (\d{3})점 이하", cond or "")
    return TEPS_OLD_NEW.get(int(m.group(1))) if m else None


def with_teps(group: dict) -> dict:
    """조건부 영어 분야에 teps_max 를 cond 바로 뒤에 단다(경계를 읽을 수 있을 때만)"""
    tm = teps_max(group.get("cond") or "") if "TEPS" in (group.get("cond") or "") else None
    if tm is None or "teps_max" in group:
        return group
    out = {}
    for k, v in group.items():
        out[k] = v
        if k == "cond":
            out["teps_max"] = tm
    return out


def english_group(cur: str, tables: Tables, cond: str) -> dict:
    if cur == "new":
        return with_teps({"name": "영어", "prefixes": ["F21."], "area": True, "min_count": 1, "cond": cond})
    return with_teps({"name": "영어", "codes": list(OLD_ENGLISH), "area": True, "min_count": 1, "cond": cond})  # 새 번호는 앱의 같은 과목 표(대응표)로 이어진다


# ---------------------------------------------------------------- 교양 줄 규칙

def rule_total(r, ctx):
    """'교양 N학점 이상'·'공통교육과정 N학점 이상'·'교양 합계 N학점' → 교과구분 교양 학점 합"""
    t = r["text"]
    m = re.match(r"^(?:교양|공통교육과정)(?:\s*합계)?\s*(\d+)\s*학점\s*이상", t)
    if not m or ":" in t.split("(")[0]:
        return None
    if re.match(r"^교양 \d+학점 이상\(2025학번, 농생대", t) or "): 글쓰기" in t or "):" in t:
        return None  # 영역이 함께 적힌 묶음 줄은 rule_composite
    n = int(m.group(1))
    out = {"min_count": None, "min_credits": n, "sum": {"of": "ge"}, "name": "교양 학점"}
    floor = (r.get("extra_research") or {}).get("min_credits_if_exempted")
    if floor:
        out["sum"].update({"floor": floor, "cond": f"진단평가로 면제받은 학점만큼 기준이 줄어요(최소 {floor}학점)."})
    return [out]


def rule_free(r, ctx):
    """'전체 교양 교과목 중 자유 선택 N학점' → 교양 합 − (교양 기준 − N): 교양 학점 줄과 같은 셈을 자유 선택 몫으로"""
    t = r["text"]
    if not re.search(r"(전체 교양|일반교양|자유\s*선택|자유롭게)", t) or re.search(r"체육|봉사|따로 정한 학점 없음|합쳐", t):
        return None
    if re.search(r"\d+\s*[~–-]\s*\d+\s*학점", t) and "2021~2024학번" not in t:
        return None
    lo, hi = ctx["years"]
    if "2021~2024학번" in t:
        # 2019·2020학번은 외국어 학점에 따라 14~16: 자유 선택 몫은 '교양 합 − (교양 기준 − N)'이라 교양 학점 줄과 같은 셈이 되어 N 을 낮은 값으로 둬도 맞다
        n = _num(r"2021~2024학번\s*(\d+)\s*학점", t) if lo >= 2021 or hi > 2020 else _num(r"2019·2020학번\s*(\d+)", t)
    else:
        n = _num(r"(\d+)(?:\(\d+\))?\s*학점", t)
    total = ctx.get("ge_total")
    if n is None or not total or total - n < 0:
        return None
    return [{"min_count": None, "min_credits": n, "sum": {"of": "ge", "after": total - n}, "name": "자유 선택 교양"}]


def rule_foreign(r, ctx):
    """'외국어 2개 교과목 6학점. 입학 때 TEPS 900점 이하이면 영어 1과목 필수' → 외국어 영역 2과목·6학점 + 조건부 영어"""
    t, cur = r["text"], ctx["cur"]
    if not re.match(r"^(?:\[1-[12]\]\s*)?(?:학문의 토대\s*>\s*)?외국어\s*(?:\d\s*(?:개\s*)?)?(?:교과목|과목|\d+\s*학점)", t):
        return None
    if "제2외국어" in t:
        return None
    count = _num(r"외국어\s*(\d)\s*개?\s*(?:교과목|과목)", t) or (1 if "1개 교과목" in t else 2)
    lo, hi = ctx["years"]
    cond = None
    if "2021~2024학번 6학점" in t:
        credits = 6 if lo >= 2021 else 4 if hi <= 2020 else None
        if credits is None:
            credits, cond = 4, "2021학번부터는 6학점이 필요해요."
    elif re.search(r"\(?\s*4\s*[~–-]\s*6\s*학점", t):
        credits = 4
    else:
        credits = _num(r"(\d+)\s*학점", t)
    if credits is None:
        return None
    groups = [area_group("외국어", cur, min_count=count)]
    tc = teps_cond(t)
    if tc:
        groups.append(english_group(cur, ctx["tables"], tc))
    if cond:
        groups.append({"name": "6학점(2021학번부터)", "area": True, "cond": cond})
    extra = {"groups": groups}
    if "기초영어는 외국어 학점에 안" in t:
        extra["not_counted"] = [ctx["tables"].course("F21.100" if cur == "new" else "L0441.000400")]
    return [{"min_count": count, "min_credits": credits, "extra": extra, "name": "외국어"}]


def rule_keys(r, ctx):
    """지성의 열쇠: '4개 영역 중 3개 영역에서 9학점' 또는 '문화 해석과 상상 3, 역사적 … 3, 인간의 … 3'"""
    t = r["text"]
    if ctx["cur"] != "new" or "지성의 열쇠" not in t:
        return None
    n = _num(r"(\d+)\s*학점", t) or r.get("min_credits")
    m = re.search(r"문화 해석과 상상·역사적 탐구와 철학적 사유·과학적 사고와 응용 세 영역 중 (\d)개 영역 이상에서 (\d+)학점 \+ 인간의 이해와 사회 분석 1과목\((\d)학점\) 필수", t)
    if m:  # 간호: 세 영역 중 2개 9학점 + 인간의 이해와 사회 분석 1과목 → 두 줄
        a = {"min_count": None, "min_credits": int(m.group(2)), "name": "지성의 열쇠",
             "extra": {"groups": [area_group(x, "new") for x in (KEYS[0], KEYS[1], KEYS[3])], "min_areas": int(m.group(1))}}
        b = {"id_suffix": "social", "min_count": 1, "min_credits": int(m.group(3)), "name": "인간의 이해와 사회 분석",
             "text": "지성의 열쇠 '인간의 이해와 사회 분석' 1과목(3학점) 필수", "extra": {"groups": [area_group(KEYS[2], "new")]}}
        return [a, b]
    if re.search(r"4개 영역 각 3학점|4개 영역에서 영역마다 3학점씩", t):
        return [{"min_count": None, "min_credits": n or 12, "name": "지성의 열쇠", "extra": {"groups": [area_group(x, "new", min_credits=3) for x in KEYS]}}]
    quoted = re.findall(r"'(문화 해석과 상상|역사적 탐구와 철학적 사유|인간의 이해와 사회 분석|과학적 사고와 응용)'", t)
    if quoted and re.search(r"각\s*(\d)\s*학점", t):
        each = _num(r"각\s*(\d)\s*학점", t)
        return [{"min_count": None, "min_credits": n or each * len(quoted), "name": "지성의 열쇠",
                 "extra": {"groups": [area_group(x, "new", min_credits=each) for x in quoted]}}]
    per = re.findall(r"(문화 해석과 상상|역사적 탐구와 철학적 사유|인간의 이해와 사회 분석|과학적 사고와 응용)\s*(\d)(?!\s*개)", t)
    if per:
        groups = [area_group(a, "new", min_credits=int(c)) for a, c in per]
        return [{"min_count": None, "min_credits": n or sum(int(c) for _, c in per), "extra": {"groups": groups}, "name": "지성의 열쇠"}]
    k = _num(r"중\s*(\d)\s*개\s*영역", t)
    if not k or not n:
        return None
    return [{"min_count": None, "min_credits": n, "extra": {"groups": [area_group(a, "new") for a in KEYS], "min_areas": k},
             "name": "지성의 열쇠"}]


def rule_veritas(r, ctx):
    t = r["text"]
    if ctx["cur"] != "new" or not t.startswith("베리타스"):
        return None
    n = _num(r"(\d+)\s*학점", t)
    if not n:
        return None
    if "강좌 2는" in t and "제외" in t:
        pre = ["V10.", "V30."]
    else:
        pre = list(NEW_AREAS["베리타스"])
    return [{"min_count": None, "min_credits": n, "extra": {"groups": [{"name": "베리타스", "prefixes": pre, "area": True}]}, "name": "베리타스"}]


def rule_msc(r, ctx):
    """수학·과학·컴퓨팅 N학점(지정 과목 없음) · [과학]·[컴퓨팅] 영역 · 세 영역 각 1과목 + 더"""
    t, cur = r["text"], ctx["cur"]
    if cur != "new":
        return None
    if re.match(r"^\[과학\]·\[컴퓨팅\] 영역에서 (\d+)학점", t):
        n = _num(r"(\d+)학점", t)
        return [{"min_count": None, "min_credits": n, "extra": {"groups": [area_group("과학·컴퓨팅", "new")]}, "name": "과학·컴퓨팅"}]
    m = re.match(r"^수학·과학·컴퓨팅 합 (\d+)학점: 세 영역 각 1과목", t)
    if m:
        groups = [area_group(a, "new", min_count=1) for a in ("수학", "과학", "컴퓨팅")]
        return [{"min_count": 6, "min_credits": int(m.group(1)), "extra": {"groups": groups}, "name": "수학·과학·컴퓨팅"}]
    m = re.match(r"^학문의 토대 수학·과학·컴퓨팅 (\d+)학점 이상\(영역 필수: 수학 1과목 이상, 과학 두 분야 각 1과목 이상, 컴퓨팅 1과목 이상\)", t)
    if m:
        a = {"min_count": None, "min_credits": int(m.group(1)), "name": "수학·과학·컴퓨팅",
             "extra": {"groups": [area_group("수학·과학·컴퓨팅", "new", label="수학·과학·컴퓨팅"), area_group("수학", "new", min_count=1),
                                  area_group("컴퓨팅", "new", min_count=1)]}}
        b = {"id_suffix": "science", "min_count": None, "min_credits": None, "name": "과학 두 분야",
             "text": "과학 두 분야에서 각 1과목 이상(물리·화학·생물·지구과학)",
             "extra": {"groups": [area_group(x, "new") for x in ("물리", "화학", "생물", "지구과학")], "min_areas": 2}}
        return [a, b]
    m = re.match(r"^(?:학문의 토대\s*>\s*)?수학·과학·컴퓨팅\s*(\d+)\s*학점(?:\s*\((?:지정 과목 없음|과목 지정 없음)\))?(\s*필수\s*\+.*)?$", t)
    if m:
        n = int(m.group(1))
        groups = [area_group("수학·과학·컴퓨팅", "new")]
        if m.group(2):
            groups.append({"name": "학과가 요구하는 과목", "area": True, "cond": "전공선택예정 학과(부)·전공이 요구하는 교과목은 학과에 확인해 주세요."})
        return [{"min_count": None, "min_credits": n, "extra": {"groups": groups}, "name": "수학·과학·컴퓨팅"}]
    return None


def rule_pe(r, ctx):
    t, cur = r["text"], ctx["cur"]
    m = re.match(r"^지성의 확장\s*>\s*예술과 체육:\s*체육 영역\s*(\d+)\s*학점$", t)
    if m and cur == "new":
        return [{"min_count": None, "min_credits": int(m.group(1)), "extra": {"groups": [area_group("체육", "new")]}, "name": "체육"}]
    m = re.match(r"^선택 교양:\s*체육계열 과목\s*(\d+)\s*학점 필수$", t)
    if m and cur == "old":
        return [{"min_count": None, "min_credits": int(m.group(1)), "extra": {"groups": [area_group("체육", "old")]}, "name": "체육"}]
    m = re.match(r"^선택 교양:\s*체육실기\s*1개 교과목\s*1학점$", t)
    if m and cur == "old":
        return [{"min_count": 1, "min_credits": 1, "extra": {"groups": [area_group("체육", "old")]}, "name": "체육"}]
    return None


STAR_COND = "언어와 문학·문화와 예술·역사와 철학 영역의 권장과목 1과목이 필요해요."


def star_group(ctx) -> dict:
    """옛 학문의 세계 권장과목(★ 44과목, 조사 2차 인문대 college_common). 목록이 없으면 학생 확인"""
    star = ctx.get("star") or []
    if not star:
        return {"name": "권장과목", "area": True, "cond": STAR_COND}
    return {"name": "권장과목", "codes": [c["code"] for c in star], "area": True, "min_count": 1, "also": True}


def rule_world(r, ctx):
    """옛 학문의 세계: N개 영역 중 k개 · 묶음마다 3학점 · 영역 하나 3학점 · 세 영역 6학점(권장과목)"""
    t = r["text"]
    if ctx["cur"] != "old" or "학문의 세계" not in t:
        return None
    if "묶음마다" in t:
        bundles = re.findall(r"\[([^\]]+)\]", t)
        per = _num(r"묶음마다\s*(\d+)\s*학점", t)
        groups = []
        for b in bundles:
            names = [x.strip() for x in b.split("·")]
            if not all(n in OLD_AREAS for n in names):
                return None
            groups.append({"name": " · ".join(names), "prefixes": [p for n in names for p in OLD_AREAS[n]], "area": True, "min_credits": per})
        return [{"min_count": None, "min_credits": _num(r"(\d+)\s*학점:", t), "extra": {"groups": groups}, "name": "학문의 세계"}]
    m = re.match(r"^학문의 세계(?: 영역)?:?\s*(정치와 경제|인간과 사회)(?: 영역)?\s*(?:(\d)과목\s*\()?(\d+)학점", t)
    if m:
        cnt = int(m.group(2)) if m.group(2) else None
        return [{"min_count": cnt, "min_credits": int(m.group(3)), "extra": {"groups": [area_group(m.group(1), "old")]}, "name": m.group(1)}]
    m = re.match(r"^학문의 세계 (인간과 사회) 영역 1과목\((\d)학점\) 필수", t)
    if m:
        return [{"min_count": 1, "min_credits": int(m.group(2)), "extra": {"groups": [area_group(m.group(1), "old")]}, "name": m.group(1)}]
    m = re.match(r"^학문의 세계:\s*언어와 문학·문화와 예술·역사와 철학 영역에서 (\d+)학점\(권장과목", t)
    if m:
        g = {"name": "언어와 문학 · 문화와 예술 · 역사와 철학", "prefixes": [p for n in WORLD[:3] for p in OLD_AREAS[n]], "area": True}
        return [{"min_count": None, "min_credits": int(m.group(1)), "extra": {"groups": [g, star_group(ctx)]}, "name": "학문의 세계"}]
    n = _num(r"학문의 세계\s*(\d+)\s*학점", t)
    k = _num(r"중\s*(\d)\s*개\s*(?:영역|분야)\s*이상", t)
    if n and k:
        if re.search(r"7개 영역|언어와 문학, 문화와 예술, 역사와 철학, 정치와 경제, 인간과 사회, 자연과 기술, 생명과 환경", t):
            areas = WORLD
        elif re.search(r"5개 (?:영역|분야)", t):
            areas = WORLD[:5]
        else:
            return None
        groups = [area_group(a, "old") for a in areas]
        if "권장과목" in t:
            groups.append(star_group(ctx))
        return [{"min_count": None, "min_credits": n, "extra": {"groups": groups, "min_areas": k}, "name": "학문의 세계"}]
    return None


def rule_basics(r, ctx):
    """옛 학문의 기초 묶음: 수량·과학·컴퓨터 합 20학점(영역별 각 1과목 + 3과목 더) · 과학·컴퓨터 영역에서 3학점"""
    t = r["text"]
    if ctx["cur"] != "old":
        return None
    m = re.match(r"^학문의 기초 수량적 분석과 추론·과학적 사고와 실험·컴퓨터와 정보 활용 합 (\d+)학점: 영역별 각 1과목", t)
    if m:
        groups = [area_group(a, "old", min_count=1) for a in ("수량적 분석과 추론", "과학적 사고와 실험", "컴퓨터와 정보 활용")]
        return [{"min_count": 6, "min_credits": int(m.group(1)), "extra": {"groups": groups}, "name": "학문의 기초"}]
    m = re.match(r"^학문의 기초 <과학적 사고와 실험>·<컴퓨터와 정보 활용> 영역에서 (\d+)학점", t)
    if m:
        g = {"name": "과학적 사고와 실험 · 컴퓨터와 정보 활용", "prefixes": OLD_AREAS["과학적 사고와 실험"] + OLD_AREAS["컴퓨터와 정보 활용"], "area": True}
        return [{"min_count": None, "min_credits": int(m.group(1)), "extra": {"groups": [g]}, "name": "과학·컴퓨터"}]
    return None


WRITING2 = ("인문학", "사회과학", "과학기술")


def rule_writing(r, ctx):
    """대학 글쓰기 1 + 대학 글쓰기 2(택 1) [+ 말하기와 토론] → 과목마다 분야(각 1과목)"""
    t, cur, tables = r["text"], ctx["cur"], ctx["tables"]
    if "대학 글쓰기 1" not in t or "대학 글쓰기 2" not in t or cur is None:
        return None
    w1 = tables.find("대학 글쓰기 1", cur)
    if not w1:
        return None
    m = re.search(r"대학 글쓰기 2\s*:\s*(인문학|사회과학|과학기술)\s*글쓰기", t)
    kinds = [m.group(1)] if m else [k for k in WRITING2 if k in t] or list(WRITING2)
    w2 = [tables.find(f"대학 글쓰기 2: {k}글쓰기", cur) for k in kinds]
    if not all(w2):
        return None
    groups = [{"name": "대학 글쓰기 1", "courses": [w1], "min_count": 1},
              {"name": "대학 글쓰기 2", "courses": w2, "min_count": 1}]
    if "말하기와 토론" in t:
        sp = tables.find("말하기와 토론", cur)
        if not sp:
            return None
        groups.append({"name": "말하기와 토론", "courses": [sp], "min_count": 1})
    n = _num(r"(\d+)\s*학점", t)
    return [{"min_count": len(groups), "min_credits": None, "extra": {"groups": groups}, "courses": [],
             "name": "글쓰기와 말하기" if cur == "new" else "사고와 표현", "_credits_note": n}]


def rule_options(r, ctx):
    """조사 extra.options(번호 묶음 가운데 택 1) → 갈래 줄"""
    opts = (r.get("extra_research") or {}).get("options")
    if not opts or not all(isinstance(o, list) and o for o in opts):
        return None
    own = {c["code"]: c for c in r.get("courses") or []}
    tables = ctx["tables"]
    k = _num(r"택\s*(\d)", r["text"]) or 1
    paths = []
    for o in opts:
        cs = [dict(own.get(c) or tables.course(c)) for c in o]
        paths.append({"name": " + ".join(c.get("name") or c["code"] for c in cs), "codes": list(o), "courses": cs})
    return [{"min_count": k, "min_credits": None, "extra": {"paths": paths}}]


def rule_all_listed(r, ctx):
    """적힌 과목을 모두 들어야 하는 줄('수량적 분석과 추론 7학점: 경영학을 위한 수학(3), 통계학(3)·통계학실험(1)') → 과목 목록 줄"""
    t, cs = r["text"], r.get("courses") or []
    if not cs or re.search(r"또는|택|중\s*\d|중 1|대체|이상|권장|인정", t):
        return None
    names = [c.get("name") or "" for c in cs]
    if not all(n and n.split(":")[0] in t for n in names):
        return None
    return [{"min_count": len(set(names)), "min_credits": None, "extra": None}]


def rule_one_of(r, ctx):
    """'생명과학을 위한 수학 1 또는 2(중 1과목)' 같은 한 과목 고르기 → 과목 목록 줄(min_count 1)"""
    t, cs = r["text"], r.get("courses") or []
    m = re.search(r"([가-힣A-Za-z ]+?)\s*1\s*또는\s*2(?:\s*중\s*1과목)?\s*$", t)
    if not cs or not m:
        return None
    base = m.group(1).strip().split(":")[-1].strip()
    hit = [c for c in cs if (c.get("name") or "").startswith(base)]
    if len(hit) != len(cs):
        return None
    return [{"min_count": 1, "min_credits": None, "extra": None}]


def _pair_paths(names: list[list[str]], cur: str, tables: Tables) -> list[dict] | None:
    paths = []
    for group in names:
        cs = [tables.find(n, cur) for n in group]
        if not all(cs):
            return None
        paths.append({"name": " + ".join(c["name"] for c in cs), "codes": [c["code"] for c in cs], "courses": cs})
    return paths


MATH_PAIRS = [["생명과학을 위한 수학 1", "생명과학을 위한 수학 2"], ["수학 1", "수학연습 1", "수학 2", "수학연습 2"],
              ["고급수학 1", "고급수학연습 1", "고급수학 2", "고급수학연습 2"]]
SCIENCE_LABS = {"물리학": [["물리학", "물리학실험"]], "화학": [["화학", "화학실험"], ["고급화학", "화학실험"]], "생물학": [["생물학", "생물학실험"]],
                "대기과학": [["대기과학", "대기과학실험"]], "지구시스템과학": [["지구시스템과학", "지구시스템과학실험"]]}


def rule_composite(r, ctx):
    """'교양 36학점 이상(2025학번, 농생대 자연계…): 글쓰기와 말하기 4(…), 외국어 2과목 6, 수학·과학·컴퓨팅 14(수학 6 = … 중 한 짝,
    과학 8 = 물리학·화학(또는 고급화학)·생물학·대기과학·지구시스템과학 중 2과목, 실험 같은 학기), 지성의 열쇠 9(4영역 중 3영역), 베리타스 3'
    처럼 한 줄에 영역이 다 적힌 교양 → 영역마다 줄(교양 학점 · 글쓰기와 말하기 · 외국어 · 수학 · 과학 · 지성의 열쇠 · 베리타스)"""
    t, cur, tables = r["text"], ctx["cur"], ctx["tables"]
    m = re.match(r"^교양 (\d+)학점 이상\([^)]*\):\s*(.+)$", t) or re.match(r"^교양 (\d+)학점 이상:\s*(.+)$", t)
    if not m or cur != "new":
        return None
    total, body = int(m.group(1)), m.group(2)
    rows = [{"min_count": None, "min_credits": total, "sum": {"of": "ge"}, "name": "교양 학점", "courses": []}]
    if "글쓰기와 말하기" in body:
        w = rule_writing({"text": "대학 글쓰기 1 + 대학 글쓰기 2(인문학·사회과학·과학기술 중 1)"}, ctx)
        if not w:
            return None
        w[0].update({"id_suffix": "writing", "text": "글쓰기와 말하기 4학점: 대학 글쓰기 1 + 대학 글쓰기 2(인문학·사회과학·과학기술글쓰기 중 1)"})
        rows += w
    if re.search(r"외국어 2과목 6", body):
        note = (r.get("note") or "") + " " + t
        groups = [area_group("외국어", "new", min_count=2)]
        tc = teps_cond(note.replace("필수", "영어 1과목 필수") if "영어 1과목" not in note else note)
        if tc:
            groups.append(english_group("new", tables, tc))
        rows.append({"id_suffix": "foreign", "min_count": 2, "min_credits": 6, "name": "외국어", "courses": [],
                     "text": "외국어 2개 교과목 6학점" + (". 입학 때 TEPS 900점(New TEPS 525점) 이하이면 영어 1과목 필수" if tc else ""),
                     "extra": {"groups": groups}})
    mm = re.search(r"수학 (\d+) = 생명과학을 위한 수학 1·2 / 수학 1·2와 연습 / 고급수학 1·2와 연습 중 한 짝", body)
    if mm:
        paths = _pair_paths(MATH_PAIRS, "new", tables)
        if not paths:
            return None
        rows.append({"id_suffix": "math", "min_count": 1, "min_credits": None, "name": "수학", "courses": [],
                     "text": f"수학 {mm.group(1)}학점: 생명과학을 위한 수학 1·2 / 수학 1·2와 수학연습 1·2 / 고급수학 1·2와 고급수학연습 1·2 중 한 짝",
                     "extra": {"paths": paths}})
    ms = re.search(r"과학 (\d+) = ([^,]+?) 중 (\d)과목, 실험 같은 학기", body)
    if ms:
        subjects = [x.strip() for x in re.sub(r"\(또는 고급화학\)", "", ms.group(2)).split("·")]
        pairs = [pp for sname in subjects for pp in SCIENCE_LABS.get(sname, [None])]
        if None in pairs:
            return None
        paths = _pair_paths(pairs, "new", tables)
        if not paths:
            return None
        rows.append({"id_suffix": "science", "min_count": int(ms.group(3)), "min_credits": None, "name": "과학", "courses": [],
                     "text": f"과학 {ms.group(1)}학점: {ms.group(2)} 중 {ms.group(3)}과목(이론과 실험을 같은 학기에)", "extra": {"paths": paths}})
    mk = re.search(r"지성의 열쇠 (\d+)\((\d)영역 중 (\d)영역\)", body)
    if mk:
        rows.append({"id_suffix": "keys", "min_count": None, "min_credits": int(mk.group(1)), "name": "지성의 열쇠", "courses": [],
                     "text": f"지성의 열쇠 {mk.group(1)}학점: 4개 영역 중 {mk.group(3)}개 영역 이상",
                     "extra": {"groups": [area_group(a, "new") for a in KEYS], "min_areas": int(mk.group(3))}})
    mv = re.search(r"베리타스 (\d+)", body)
    if mv:
        rows.append({"id_suffix": "veritas", "min_count": None, "min_credits": int(mv.group(1)), "name": "베리타스", "courses": [],
                     "text": f"베리타스 {mv.group(1)}학점(베리타스 강좌 1·강좌 2·실천 중)",
                     "extra": {"groups": [{"name": "베리타스", "prefixes": list(NEW_AREAS["베리타스"]), "area": True}]}})
    if len(rows) < 4:
        return None
    return rows


GE_RULES = [rule_composite, rule_options, rule_writing, rule_total, rule_free, rule_foreign, rule_keys, rule_veritas, rule_msc, rule_pe,
            rule_world, rule_basics, rule_all_listed, rule_one_of]


# ---------------------------------------------------------------- 셀 수 있는지(앱 requirements.js 와 같은 판단)

GROUP_KEYS = {"groups", "not_counted", "min_groups", "min_areas", "min_in_one_group", "group"}


def countable(r: dict) -> bool:
    if r.get("status") != "확인":
        return False
    if r.get("sum") or r.get("same_as") or r.get("foreign"):  # 외국어진행강좌(update135 requirement_rules)
        return True
    e = r.get("extra")
    if e:
        keys = set(e)
        if e.get("groups") and keys <= GROUP_KEYS:
            return all(g.get("courses") is not None or g.get("codes") is not None or g.get("prefixes") or g.get("cond") for g in e["groups"])
        if e.get("paths") and keys == {"paths"} and r.get("min_count") is not None:
            return True
        return False
    return bool(r.get("courses")) and (r.get("min_count") is not None or r.get("min_credits") is not None)


# ---------------------------------------------------------------- 전공 학점 합 · 평점 줄

def rule_major_sum(r, prog):
    """'전공 N학점'·'전공선택 N학점'·'복수전공 … N학점'·'부전공 … N학점' 처럼 학점 합만 따지는 줄 → 전공 과목 학점 합.
    학과 칸(depts)을 못 정한 과정(요건 목록으로만 세는 17과정)은 뺀다. 다른 학과 인정 과목·대학원 과목은 학생이 아는 것이라 조건부로"""
    if not prog.get("depts"):
        return None
    t = r["text"]
    if r["type"] not in ("major_elective", "double", "minor"):
        return None
    if r.get("courses") or re.search(r"악기|트랙|필수전선|실기|영어 전공강좌|각론|영역마다|S/U|합:|합 \d|\(합|지정 전공교과목|지정 전공교과목 중", t):
        return None
    cls = ["전선"] if re.match(r"^(?:학과 개설 )?전공선택\s*[:\d]|^전선\s*(?:학점)?\s*:|^나머지 전공선택", t) and "학과 전공 과목으로" not in t else None
    if re.match(r"^나머지 전공선택|^그 밖에 지정 전공필수 없음", t):
        cls = None  # '단일 60·병행 48 을 채운다'는 전공 합
    roles = {}
    for role, pats in (("single", [r"단일(?:\(심화\))?\s*(\d+)", r"(\d+)\s*학점\(단일\)"]),
                       ("parallel", [r"(?:다전공\s*)?병행(?:·복수)?\s*(\d+)", r"(\d+)\s*학점\(병행"]),
                       ("double", [r"병행·복수\s*(\d+)", r"복수(?:전공)?\s*(\d+)\s*학점", r"·복수\s*(\d+)"])):
        for pat in pats:
            mm = re.search(pat, t)
            if mm:
                roles[role] = int(mm.group(1))
                break
    applies = set(r.get("applies_to") or [])
    if re.search(r"전필 \d+학점 모두", t):
        cls = ["전필"]  # '부전공: 전필 30학점 모두 이수'
    if roles and len(roles) > 1:
        s = {"of": "major", "by_role": {k: v for k, v in roles.items() if not applies or k in applies}}
        if not s["by_role"]:
            return None
    elif r.get("min_credits"):
        s = {"of": "major"}
    else:
        return None
    if cls:
        s["cls"] = cls
    if re.search(r"인정|타 ?학과|대학원|까지", t):
        s["note"] = "다른 학과 인정 과목·대학원 과목은 학과 승인이 필요해 세지 않았어요."
    return [{"sum": s, "extra": None}]


def rule_teaching(r, prog):
    """'교직 22학점 이상(교직이론 12 + 교직소양 7 + 교육실습 4 = 실질 23)' → 교과구분 교직 학점 합"""
    m = re.match(r"^교직 (\d+)학점 이상", r["text"])
    if r["type"] != "other" or not m:
        return None
    return [{"sum": {"of": "cls", "cls": ["교직"]}, "min_credits": int(m.group(1)), "extra": None, "name": "교직"}]


ENG_COMMON: dict[str, list[dict]] = {}  # 공과대학 공통과목(조사 1차 eng1 college_common.eng_common_2026_1, 2026학년도 1학기 시행 47과목) 영역 → 과목


def eng_common_from(round1: dict) -> dict:
    for c in round1.get("colleges") or []:
        ec = (c.get("college_common") or {}).get("eng_common_2026_1")
        if ec and ec.get("areas"):
            return {k: [{kk: x[kk] for kk in ("code", "name", "credits") if x.get(kk) is not None} for x in v] for k, v in ec["areas"].items()}
    return {}


def rule_eng_common(r, prog):
    """'공과대학 공통과목 3학점(건설환경공학개론 제외, 공학기타 영역 제외)'·'… 전 영역에서 3학점' → 공대 공통과목 목록(학점 합)"""
    t = r["text"]
    if not ENG_COMMON or r.get("courses") or not re.match(r"^공과대학 공통(?:과목|교과목)", t):
        return None
    n = _num(r"(\d+)\s*학점", t)
    if not n:
        return None
    areas = [a for a in ENG_COMMON if not ("공학기타" in t and a == "공학기타")]
    if not ("전 영역" in t or "공학기타" in t):
        return None
    skip = set(re.findall(r"([가-힣A-Za-z]+개론) 제외", t))
    cs = [c for a in areas for c in ENG_COMMON[a] if c.get("name") not in skip]
    return [{"courses": cs, "min_credits": n, "min_count": None, "extra": None,
             "note": ((r.get("note") or "") + " 공과대학 공통과목 목록은 2026학년도 1학기 시행 47과목(조사 1차 공과대학 공통)으로 넣었다(update127).").strip()}]


def rule_bio_research(r, prog):
    """생명과학부 '학위논문연구 전에: 생명과학연구실습 2회, 또는 연구실습 1회 + 자연대 인턴십 1회' → 연구실습 1과목 + 조건부 2과목째(인턴십은 편람 과목이 아님)"""
    if not r["text"].startswith("학위논문연구 전에: 생명과학연구실습 2회") or not r.get("courses"):
        return None
    cs = r["courses"]
    return [{"min_count": 1, "min_credits": None, "courses": [], "name": "연구실습",
             "extra": {"groups": [{"name": "생명과학연구실습", "courses": cs, "min_count": 1},
                                  {"name": "연구실습 2회째", "courses": cs, "min_count": 2,
                                   "cond": "연구실습을 1회만 했다면 자연대 인턴십(연구실 인턴) 1회로 채울 수 있어요(같은 학기 둘은 안 됨)."}]}}]


GPA_ONLY = re.compile(r"^(?:전체 평점 2\.0 이상, 전공\(복수·부·연합 등 포함\) 평점 2\.0 이상\(학칙 제83조\)|평점평균 2\.0 이상: 전 교과목, 그리고 전공 교과목\(복수·연합·연계·학생설계·부전공 포함\) 각각)$")


def rule_gpa(r, prog):
    if r["type"] != "other" or not GPA_ONLY.match(r["text"]):
        return None
    return [{"same_as": "grad-gpa", "extra": None}]


# ---------------------------------------------------------------- 교양 영역 과목 표(ge_areas.json, update128)

def area_names() -> dict[str, str]:
    """번호 앞자리 → 영역 이름(가장 좁은 이름: 'C10.' → '문화 해석과 상상', 'F21.' → '영어')"""
    out: dict[str, str] = {}
    for table in (OLD_AREAS, NEW_AREAS):
        for name, pres in sorted(table.items(), key=lambda kv: len(kv[1]), reverse=True):  # 넓은 묶음 먼저, 좁은 이름이 덮는다
            for pre in pres:
                out[pre] = name
    return out


def build_areas(course_map: dict, history: "Path | list") -> dict:
    """교양 영역마다 과목 목록(요건 시트의 영역 목록, 사용자 11/16 '영역이 나뉘면 영역 다 나눠줘야지… 최대한 정보를 다 넣어').
    학교 교양 영역·과목 대응표(2024·2025·2026 번호)와 지난 편람(data/history/)의 교양 과목 가운데 영역 번호 앞자리로 시작하는 것. 이름·학점은 가장 최근 학기 편람"""
    import json as _json
    names = area_names()
    seen: dict[str, dict] = {}
    # 학기 파일 목록(requirements_import.history_files: 요건 학번이 들을 수 있었던 학기만) 또는 폴더
    files = list(history) if isinstance(history, list) else sorted(history.glob("*.json"), key=lambda f: _term_rank(f.stem))
    latest: dict[str, tuple] = {}
    for f in files:
        for c in _json.loads(f.read_text(encoding="utf-8")).get("courses", []):
            if c[4] == "교양":
                latest[c[0]] = (c[1], c[3])
    def add(code: str, name: str | None):
        pre = code.split(".")[0] + "."
        if pre not in names or code in seen:
            return
        nm, cr = latest.get(code, (name, None))
        cr = int(cr) if cr is not None and float(cr).is_integer() else cr
        seen[code] = {"code": code, "name": nm or name or code, **({"credits": cr} if cr is not None else {})}
    for row in (course_map or {}).get("rows") or []:
        for y in ("2026", "2025", "2024"):
            if row.get(y):
                add(row[y]["code"], row[y].get("name"))
    for code, (nm, _) in latest.items():
        add(code, nm)
    areas: dict[str, dict] = {}
    for c in seen.values():
        pre = c["code"].split(".")[0] + "."
        areas.setdefault(pre, {"name": names[pre], "courses": []})["courses"].append(c)
    for a in areas.values():
        a["courses"].sort(key=lambda c: (c["name"], c["code"]))
    return {"source": "학교 교양 영역·과목 대응표(2024-2026, course_map.json)와 지난 편람(data/history/)의 교양 과목",
            "note": "교양 과목 번호의 앞자리가 곧 영역이다(docs/requirements.md 1-1절). 요건 시트가 영역마다 과목 목록을 보이는 데 쓴다. 이름·학점은 가장 최근 학기 편람",
            "areas": dict(sorted(areas.items()))}


def _term_rank(stem: str) -> int:
    m = re.match(r"^(\d{4})-(1|S|2|W)$", stem)
    return int(m.group(1)) * 4 + {"1": 0, "S": 1, "2": 2, "W": 3}[m.group(2)] if m else -1


# ---------------------------------------------------------------- 인문대학 공통(college_common 참조 줄)

HUM_GROUPS = [(2025, 2026), (2024, 2024), (2021, 2023), (2019, 2020)]  # 인문대 공통 교양이 같은 학번 묶음(조사 2차 college_common.ge_by_cohort)
OLD_SELECT = ["051.", "052.", "053.", "054.", "055.", "L0652.", "L0653.", "L0654.", "L0655.", "L0656."]


def _hum_row(rid: str, base: dict, **kw) -> dict:
    row = {"id": rid, "type": kw.pop("type", "ge"), "applies_to": list(base.get("applies_to") or []), "text": kw.pop("text"),
           "min_count": kw.pop("min_count", None), "min_credits": kw.pop("min_credits", None), "courses": kw.pop("courses", []),
           "status": kw.pop("status", "확인"), "src": list(base.get("src") or [])}
    row.update(kw)
    return row


def humanities_rows(lo: int, hi: int, base: dict, r1_rows: list[dict], tables: Tables, star: list[dict]) -> list[dict]:
    """인문대학 공통 교양·졸업 의무(조사 1차 인문대 college_common.requirements, 2차 college_common.ge_by_cohort·other) → 그 학번 묶음의 요건 줄"""
    out = []
    if lo >= 2025:
        keep = {"hum-ge25-writing", "hum-ge25-msc", "hum-ge25-keys", "hum-ge25-veritas", "hum-ge25-free", "hum-foreign-taught", "hum-life-seminar"}
        for r in r1_rows:
            if r.get("id") not in keep:
                continue
            row = _hum_row(r["id"], base, type="ge" if r["id"].startswith("hum-ge25") else r.get("type", "other"), text=r["text"],
                           min_count=r.get("min_count"), min_credits=r.get("min_credits"),
                           courses=[{k: c[k] for k in ("code", "name", "credits", "alt_codes") if c.get(k) is not None} for c in r.get("courses") or [] if c.get("code")],
                           status=r.get("status", "확인"))
            if r.get("note"):
                row["note"] = r["note"]
            out.append(row)
        lang2 = next((r for r in r1_rows if r.get("id") == "hum-ge25-2ndlang"), None)
        mid = [c["code"] for c in (lang2 or {}).get("courses") or [] if c.get("code")]
        out.append(_hum_row("hum-ge25-2ndlang", base, text=(lang2 or {}).get("text") or "제2외국어 9학점(3과목), 중급 이상 1과목 이상",
                            min_count=3, min_credits=9, name="제2외국어", auto="humanities",
                            extra={"groups": [{"name": "제2외국어", "prefixes": [f"F2{i}." for i in range(2, 10)], "area": True, "min_count": 3},
                                              {"name": "중급 이상", "codes": mid, "area": True, "min_count": 1, "also": True}]},
                            note="제2외국어가 전공인 학생은 영어와 전공 외국어를 뺀 다른 외국어·고전어로 채운다(앱은 가르지 않음)."))
        out.append(_hum_row("hum-ge25-english", base, text="영어 1~2과목, 3(6)학점: 입학 때 TEPS 801(New TEPS 453) 이상 1과목, 800(452) 이하 2과목",
                            min_count=1, min_credits=3, name="영어", auto="humanities",
                            extra={"groups": [{"name": "영어", "prefixes": ["F21."], "area": True, "min_count": 1},
                                              with_teps({"name": "영어 2과목", "prefixes": ["F21."], "area": True, "min_count": 2,
                                                         "cond": "입학 때 TEPS 800점(New TEPS 452점) 이하였다면 영어 2과목이 필요해요."})],
                                   "not_counted": [tables.course("F21.100")]}))
        out.append(_hum_row("hum-ge25-expansion", base, text="지성의 확장 2학점, 그 안에 소그룹 고전원전읽기 1 또는 2 를 1과목 이상(E52.103·E52.104)",
                            min_credits=2, name="지성의 확장", auto="humanities",
                            extra={"groups": [{"name": "지성의 확장", "prefixes": list(NEW_AREAS["지성의 확장"]), "area": True},
                                              {"name": "소그룹 고전원전읽기", "codes": ["E52.103", "E52.104"], "area": True, "min_count": 1, "also": True}]}))
        out.insert(0, _hum_row("hum-ge-total", base, text="교양 36학점 이상(인문대학 2025학번~)", min_credits=36, name="교양 학점",
                               sum={"of": "ge"}, auto="humanities"))
        return out
    eng_cr = 2 if hi <= 2020 else 3
    free = 4 if hi <= 2020 else 3
    span = f"{lo}~{hi}학번" if lo != hi else f"{lo}학번"
    olds = []
    lang2 = next((r for r in r1_rows if r.get("id") == "hum-ge25-2ndlang"), None)
    for c in (lang2 or {}).get("courses") or []:
        info = tables.by_code.get(c.get("code") or "")
        if info and info["row"].get("2024"):
            olds.append(info["row"]["2024"]["code"])
    out.append(_hum_row("hum-ge-total", base, text=f"교양 36학점 이상(인문대학 {span})", min_credits=36, name="교양 학점", sum={"of": "ge"}, auto="humanities"))
    out.append(_hum_row("hum-ge-writing", base, text="사고와 표현 4학점: 대학 글쓰기 1 + 대학 글쓰기 2(인문학·사회과학·과학기술 글쓰기 중 1)"))
    out.append(_hum_row("hum-ge-2ndlang", base, text="제2외국어 9학점(3과목), 그중 중급 이상 1과목 이상. 제2외국어가 전공이면 영어·전공어를 뺀 외국어·고전어",
                        min_count=3, min_credits=9, name="제2외국어", auto="humanities",
                        extra={"groups": [{"name": "제2외국어", "prefixes": list(OLD_AREAS["외국어"]), "area": True, "min_count": 3},
                                          {"name": "중급 이상", "codes": olds, "area": True, "min_count": 1, "also": True}],
                               "not_counted": [tables.course(c) for c in OLD_ENGLISH + ["L0441.000400"]]}))
    out.append(_hum_row("hum-ge-english", base, text=f"영어 1~2과목 {eng_cr}({eng_cr * 2})학점: 입학 때 TEPS 점수에 따라 대학영어 1·대학영어 2·고급영어 중 1~2과목",
                        min_count=1, min_credits=eng_cr, name="영어", auto="humanities",
                        extra={"groups": [{"name": "영어", "codes": list(OLD_ENGLISH), "area": True, "min_count": 1},
                                          {"name": "영어 2과목", "codes": list(OLD_ENGLISH), "area": True, "min_count": 2,
                                           "cond": "입학 때 TEPS 점수에 따라 영어 2과목이 필요할 수 있어요."}]}))
    world = [area_group(a, "old") for a in WORLD]
    if star:
        world.append({"name": "권장과목", "codes": [c["code"] for c in star], "area": True, "min_count": 1, "also": True})
    out.append(_hum_row("hum-ge-world", base, text="학문의 세계 15학점: 4개 영역 이상, 언어와 문학·문화와 예술·역사와 철학 영역 권장과목(★) 1과목",
                        min_credits=15, name="학문의 세계", auto="humanities", extra={"groups": world, "min_areas": 4}))
    out.append(_hum_row("hum-ge-world-split", base,
                        text="학문의 세계 배분: 언어와 문학·문화와 예술·역사와 철학 6 이상, 정치와 경제·인간과 사회 3 이상, 자연과 기술·생명과 환경 3 이상"
                             "(학문의 기초 수량적 분석과 추론·과학적 사고와 실험·컴퓨터와 정보 활용 1과목으로 대체 가능)",
                        name="학문의 세계 배분", auto="humanities",
                        extra={"groups": [{"name": "언어와 문학 · 문화와 예술 · 역사와 철학", "prefixes": [x for a in WORLD[:3] for x in OLD_AREAS[a]], "area": True, "min_credits": 6},
                                          {"name": "정치와 경제 · 인간과 사회", "prefixes": [x for a in WORLD[3:5] for x in OLD_AREAS[a]], "area": True, "min_credits": 3},
                                          {"name": "자연과 기술 · 생명과 환경", "area": True, "min_credits": 3,
                                           "prefixes": [x for a in WORLD[5:] + ["수량적 분석과 추론", "과학적 사고와 실험", "컴퓨터와 정보 활용"] for x in OLD_AREAS[a]]}]}))
    out.append(_hum_row("hum-ge-select", base, text="선택교양 2학점, 그 안에 소그룹 고전원전읽기 1 또는 2 1과목(054.008·054.009)", min_credits=2, name="선택교양",
                        auto="humanities", extra={"groups": [{"name": "선택교양", "prefixes": list(OLD_SELECT), "area": True},
                                                             {"name": "소그룹 고전원전읽기", "codes": ["054.008", "054.009"], "area": True, "min_count": 1, "also": True}]}))
    out.append(_hum_row("hum-ge-free", base, text=f"전체 교양 교과목 {free}학점(영어를 2과목 들으면 그만큼 줄어든다)", min_credits=free, name="자유 선택 교양",
                        sum={"of": "ge", "after": 36 - free}, auto="humanities"))
    out.append(_hum_row("hum-life", base, type="other", text="삶과 인문학(100.165, 1학점, 일선) 수강 의무: 인문대 신입생만(복수전공·편입·전과·자유전공학부 학생 미적용)",
                        min_count=1, courses=[tables.course("100.165", "삶과 인문학")], name="삶과 인문학"))
    out.append(_hum_row("hum-foreign-taught", base, type="other", text="외국어진행강좌 3과목 이상(서울대 개설 과목, 대학영어 같은 외국어 진행 교양 포함, 국외수학 불인정)",
                        min_count=3, name="외국어진행강좌"))
    return out


def expand_humanities(prog: dict, r1_rows: list[dict], tables: Tables, star: list[dict]) -> int:
    """인문대학 과정의 'college_common 참조' 줄(hum-common-ref)을 학번 묶음의 인문대 공통 요건 줄로 바꾼다. 판이 묶음에 걸치면 묶음 경계로 나눈다. 나눈 판 수"""
    out, n = [], 0
    for v in prog.get("versions") or []:
        ref = next((r for r in v.get("requirements") or [] if r.get("id") == "hum-common-ref"), None)
        if not ref or not by_entry(v):
            out.append(v)
            continue
        lo, hi = v["entry_years"]
        parts = [(max(lo, a), min(hi, b)) for a, b in HUM_GROUPS if max(lo, a) <= min(hi, b)]
        n += len(parts) - 1
        for a, b in parts:
            w = copy.deepcopy(v)
            w["entry_years"] = [a, b]
            if len(parts) > 1:
                w["split"] = "인문대학 공통 교양이 학번마다 달라 나눔(update127)"
            reqs = []
            for r in w["requirements"]:
                if r.get("id") == "hum-common-ref":
                    reqs.extend(humanities_rows(a, b, r, r1_rows, tables, star))
                else:
                    reqs.append(r)
            w["requirements"] = reqs
            out.append(w)
    prog["versions"] = out
    return n


def round1_humanities(round1: dict) -> list[dict]:
    for c in round1.get("colleges") or []:
        if c.get("agent") == "hum":
            return (c.get("college_common") or {}).get("requirements") or []
    return []


# ---------------------------------------------------------------- 판 나누기 · 권장과목

SPLIT_YEAR = 2025


def by_entry(v: dict) -> bool:
    """주전공 판을 입학 연도로 고르는 판인가(교양 규정은 늘 입학 연도라 이런 판만 학번으로 나눈다). '입학 연도(복수전공은 전공 진입 연도 …)'도 주전공은 입학 연도.
    전공 진입 연도·교과 개편 학기·졸업 시기로 고르는 판은 나누지 않는다"""
    b = v.get("basis")
    return b is None or str(b).startswith("입학 연도") or str(b).startswith("미확인(입학 연도")


def old_ge(v: dict, ge_table: dict | None, ge_key: str | None) -> None:
    """나뉜 옛 학번 판: 2025학번 교양 글이 든 줄은 그 학번 규정이 아니라 '부분'(학과·학부대학 자료로 확인)으로 두고,
    학부대학 교양 학점 표(ge_credits.json)에서 그 학번들의 교양 학점이 하나로 같으면 '교양 학점' 합 줄을 더한다.
    합 줄을 더했으면 2025학번 교양 글 줄은 뺀다(update135, 프론트엔드 11/17: 22학번 판에 '교양, 확인 필요' 줄이 하나 더 서고 그 시트에 2025학번 교양 틀)"""
    lo, hi = v["entry_years"]
    reqs = []
    first = None
    for r in v.get("requirements") or []:
        if r.get("type") == "ge" and any(c in r["text"] for c in NEW_CUES):
            r = dict(r, status="부분", note=((r.get("note") or "") + f" 이 판({lo}~{hi}학번)에는 2025학번 교양 글이 들어 있다: 그 학번 교양 영역 규정은 조사 자료에 없음(update127)").strip())
            first = first or r
        reqs.append(r)
    table = ((ge_table or {}).get("table") or {}).get(ge_key or "") or {}
    vals = {table.get(str(y)) for y in range(lo, hi + 1)}
    if first and len(vals) == 1 and None not in vals:
        n = vals.pop()
        reqs.insert(reqs.index(first), {"id": f"{first['id']}-old-total", "type": "ge", "applies_to": list(first.get("applies_to") or []),
                                        "text": f"교양 {n}학점 이상({lo}~{hi}학번, 학부대학 교양 이수규정의 단과대·학과 교양 학점)", "min_count": None,
                                        "min_credits": n, "courses": [], "status": "확인", "src": list(first.get("src") or []),
                                        "sum": {"of": "ge"}, "name": "교양 학점", "auto": "old_total"})
        reqs = [r for r in reqs if not (r.get("type") == "ge" and r.get("auto") != "old_total" and any(c in r["text"] for c in NEW_CUES))]
    v["requirements"] = reqs


FIRST_COHORT, LAST_COHORT = 2019, 2026  # 요건 자료가 덮는 학번(requirements_import LO, HI)


def ge_by_entry(v: dict, ge_table: dict | None, ge_key: str | None) -> int:
    """전공 진입 연도·교과 개편 학기·졸업 시기로 고르는 판(by_entry 가 아님)에 2025학번 교양 글이 든 것(update128, 사용자 11/16 '최대한 정보를 다 넣어'):
    교양은 늘 입학 연도 규정이라 판은 그대로 두고 교양 줄만 입학 연도로 나눈다. 새 줄은 줄의 entry_years [2025, 끝](apply 가 영역별로 나눈다),
    옛 학번 줄(id 끝 '-old')은 [2019, 2024](old_ge 와 같게 '부분' + 학부대학 교양 학점이 하나로 같으면 합 줄). 화면 계산(requirements.js rowsForEntry)이
    학생 입학 연도로 거른다. 나눈 줄 수"""
    hi = max(v["entry_years"][1], LAST_COHORT)
    hit = [r for r in v.get("requirements") or [] if r.get("type") == "ge" and any(c in r["text"] for c in NEW_CUES)]
    if not hit:
        return 0
    old = {"entry_years": [FIRST_COHORT, SPLIT_YEAR - 1], "requirements": [dict(copy.deepcopy(r), id=f"{r['id']}-old") for r in hit]}
    old_ge(old, ge_table, ge_key)
    for r in old["requirements"]:
        if r["id"].endswith("-old-old-total"):
            r["id"] = r["id"][: -len("-old-old-total")] + "-old-total"
        r["entry_years"] = [FIRST_COHORT, SPLIT_YEAR - 1]
    reqs = []
    for r in v["requirements"]:
        if r is hit[0]:
            reqs += [dict(x, entry_years=[SPLIT_YEAR, hi]) for x in hit] + old["requirements"]
        elif r not in hit:
            reqs.append(r)
    v["requirements"] = reqs
    return len(hit)


def split_new_ge(prog: dict, ge_table: dict | None = None) -> int:
    """판이 2024·2025학번에 걸치고 그 판의 교양 줄이 2025 새 교양(학문의 토대·지성의 열쇠 …)이면 판을 [2025, hi]·[lo, 2024]로 나눈다
    (2025학번 교양 개편. 조사 자료는 학과 규정이 같으면 판을 나누지 않았다). 옛 쪽은 줄을 그대로 둔다(그 학번 교양 규정은 조사 자료에 없어 확인 필요 그대로).
    입학 연도로 고르는 판만. 다른 것으로 고르는 판은 판 대신 교양 줄을 입학 연도로 나눈다(ge_by_entry, update128). 나눈 판 수"""
    out, n = [], 0
    for v in prog.get("versions") or []:
        lo, hi = v["entry_years"]
        ge = [r["text"] for r in v.get("requirements") or [] if r.get("type") == "ge"]
        newish = bool(ge) and any(any(c in t for c in NEW_CUES) for t in ge) and not any(any(c in t for c in OLD_CUES) for t in ge)
        if lo < SPLIT_YEAR <= hi and newish and by_entry(v):
            a, b = copy.deepcopy(v), copy.deepcopy(v)
            a["entry_years"], b["entry_years"] = [SPLIT_YEAR, hi], [lo, SPLIT_YEAR - 1]
            a["split"] = b["split"] = "2025학번 교양 개편으로 나눔(update127)"
            old_ge(b, ge_table, prog.get("ge_key"))
            out += [a, b]
            n += 1
        else:
            if hi < SPLIT_YEAR and newish:
                # 옛 학번만 걸린 판에 2025학번 교양 글이 든 것도 같게. 전공 진입·졸업 같은 다른 기준으로 고르는 판도 그 끝이 2024 이하면
                # 입학은 그보다 앞이라 옛 교양이다(update128)
                old_ge(v, ge_table, prog.get("ge_key"))
            elif hi >= SPLIT_YEAR and newish and not by_entry(v) and (lo < SPLIT_YEAR or str(v.get("basis") or "").startswith("전공 진입")):
                # 2025 앞뒤 학번이 같이 걸리는 판만(교과 개편·졸업 시기 판은 화면이 입학 연도로 고르므로 2025 부터인 판엔 옛 학번이 없다.
                # 전공 진입 판은 2025 진입이라도 2024 입학이 있다)
                ge_by_entry(v, ge_table, prog.get("ge_key"))
            out.append(v)
    prog["versions"] = out
    return n


def star_list(round2: dict, tables: Tables) -> list[dict]:
    """2019~2024학번 학문의 세계 권장과목(★ 44과목, 조사 2차 인문대 college_common.recommended_courses_2019_2024: 학교 교양 영역·교과목 비교표 표시).
    옛 번호를 대표로, 2025 번호와 대응표의 다른 해 번호를 alt_codes 로"""
    for c in round2.get("colleges") or []:
        rc = ((c.get("college_common") or {}).get("recommended_courses_2019_2024") or {}).get("courses")
        if not rc:
            continue
        out = []
        for x in rc:
            if not x.get("code_old"):
                continue
            co = tables.course(x["code_old"], x.get("name"))
            alts = list(dict.fromkeys((co.get("alt_codes") or []) + ([x["code_2025"]] if x.get("code_2025") else [])))
            alts = [a for a in alts if a != co["code"]]
            if alts:
                co["alt_codes"] = alts
            out.append(co)
        return out
    return []


# ---------------------------------------------------------------- 적용

def _replace(r: dict, specs: list[dict], auto: str) -> list[dict]:
    out = []
    for i, sp in enumerate(specs):
        row = copy.deepcopy(r)
        if r.get("extra") is not None and "extra_research" not in row:
            row["extra_research"] = r["extra"]
        row.pop("extra", None)
        suffix = sp.pop("id_suffix", None)
        sp.pop("_credits_note", None)
        for k, v in sp.items():
            if v is None and k in ("extra",):
                row.pop(k, None)
            else:
                row[k] = v
        if suffix:
            row["id"] = f"{r['id']}-{suffix}"
            row["courses"] = []
        elif i:
            row["id"] = f"{r['id']}-{i + 1}"
        if row.get("extra") is None:
            row.pop("extra", None)
        row["auto"] = auto
        out.append(row)
    return out


def apply(prog: dict, tables: Tables, star: list[dict] | None = None) -> dict:
    """과정 하나의 판마다 셀 수 없는 줄을 규칙으로 바꾼다. 바꾼 줄 수를 규칙 이름별로 돌려준다"""
    done: dict[str, int] = {}
    for v in prog.get("versions") or []:
        ge_total = (v.get("credits") or {}).get("ge")
        reqs = []
        for r in v.get("requirements") or []:
            if r.get("auto") or r.get("status") != "확인" or countable(r) or r.get("type") == "rule":
                reqs.append(r)
                continue
            work = dict(r)
            work["extra_research"] = r.get("extra")
            specs, name = None, None
            if r["type"] == "ge" or (r["type"] == "distribution" and r["text"].startswith("지성의 열쇠")):
                years = r.get("entry_years") or v["entry_years"]  # 입학 연도로 나눈 교양 줄(ge_by_entry)은 줄의 학번으로
                ctx = {"cur": curriculum(r["text"], years), "years": years, "ge_total": ge_total,
                       "tables": tables, "star": star or []}
                for rule in GE_RULES:
                    specs = rule(work, ctx)
                    if specs:
                        name = rule.__name__
                        break
            else:
                for rule in (rule_major_sum, rule_gpa, rule_teaching, rule_eng_common, rule_bio_research):
                    specs = rule(work, prog)
                    if specs:
                        name = rule.__name__
                        break
            if not specs:
                reqs.append(r)
                continue
            new = _replace(r, specs, name)
            if not all(countable(x) for x in new):
                reqs.append(r)
                continue
            reqs.extend(new)
            done[name] = done.get(name, 0) + 1
        v["requirements"] = reqs
    return done


# ---------------------------------------------------------------- 전공 학점 줄(update135)

def _major_total(r: dict) -> bool:
    """이미 전공 전체 학점을 세는 줄인가(교과구분을 가리지 않는 전공 합, 단일전공에 걸린 것)"""
    s = r.get("sum")
    if not isinstance(s, dict) or s.get("of") != "major" or s.get("cls"):
        return False
    roles = s.get("by_role") or {}
    return "single" in roles or (r.get("min_credits") is not None and "single" in (r.get("applies_to") or ["single"]))


def add_major_totals(prog: dict) -> int:
    """판 학점(credits)이 '확인'이고 단일전공 학점이 있는데 전공 전체 학점을 세는 줄이 없으면 '전공 학점' 줄을 맨 앞에 더한다
    (사용자 11/17 '졸업 요건 모르는 건 … 알아내라': 동물생명공학 '단일전공 이수 48'이 요건 목록에 없었다). 단일·병행만(복수·부전공은 그 줄이 따로 있다).
    전공 과목은 학과(depts)·번호 앞자리로 가리니(requirements.js isMajorCourse) 학과를 못 정한 과정은 뺀다. 더한 줄 수"""
    if not prog.get("depts"):
        return 0
    n = 0
    for v in prog.get("versions") or []:
        cr = v.get("credits") or {}
        if cr.get("status") != "확인" or not cr.get("single") or any(_major_total(r) for r in v.get("requirements") or []):
            continue
        roles = {k: cr[k] for k in ("single", "parallel") if cr.get(k)}
        par = roles.get("parallel")
        text = (f"전공 {roles['single']}학점 이상" + ("" if par is None else f"(다른 전공과 함께 이수해도 {par}학점)" if par == roles["single"]
                                                      else f"(단일전공). 다른 전공과 함께 이수하면 주전공 {par}학점 이상"))
        row = {"id": "major-total", "type": "other", "applies_to": list(roles), "text": text, "min_count": None, "min_credits": None,
               "courses": [], "status": "확인", "src": list(cr.get("src") or []), "sum": {"of": "major", "by_role": roles},
               "name": "전공 학점", "auto": "major_total"}
        v["requirements"] = [row] + list(v.get("requirements") or [])
        n += 1
    return n

