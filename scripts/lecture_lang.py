"""지난 학기 편람 엑셀(data/raw/history/<학기>.xls)의 '강의언어' 칸 → data/requirements/lecture_lang.json.

  python scripts/lecture_lang.py                       # 2019-1 ~ (요건 자료가 덮는 학번이 들을 수 있었던 학기)
  python scripts/lecture_lang.py --raw <폴더> --from 2019

졸업 요건의 '외국어진행강좌 3과목'(학과마다 다름)을 세려면 학기마다 어떤 강좌가 외국어로 진행됐는지 알아야 한다.
지난 편람 JSON(data/history/)은 강의 언어를 담지 않아서(웹 화면 형식) 엑셀에서 따로 뽑는다.
한국어가 아닌 강좌만 둔다: {"terms": {"2025-1": {"<교과목번호>": "001 002 005:중국어"}}} (강좌번호를 띄어 쓰고, 영어가 아니면 ':언어').
엑셀은 scripts/fetch_history.py 가 학기마다 한 번씩 받는 강좌검색 '엑셀 저장' 파일(강좌별 상세 팝업은 부르지 않는다).
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw" / "history"
OUT = ROOT / "data" / "requirements" / "lecture_lang.json"
ORDER = {"1": 0, "S": 1, "2": 2, "W": 3}


def term_key(stem: str) -> tuple[int, int] | None:
    m = re.match(r"^(\d{4})-(1|S|2|W)$", stem)
    return (int(m.group(1)), ORDER[m.group(2)]) if m else None


def read_langs(path: Path) -> dict[str, dict[str, str]]:
    """엑셀 하나 → {교과목번호: {강좌번호: 언어}}(한국어·빈칸 빼고)"""
    raw = pd.read_excel(path, header=None, dtype=str)
    head = next(i for i in range(min(10, len(raw))) if "교과목번호" in [str(x).strip() for x in raw.iloc[i].tolist()])
    cols = [str(x).strip() for x in raw.iloc[head].tolist()]
    at = {name: cols.index(name) for name in ("교과목번호", "강좌번호", "강의언어")}
    out: dict[str, dict[str, str]] = {}
    for row in raw.iloc[head + 1:].itertuples(index=False):
        code, sec, lang = (str(row[at[k]]).strip() for k in ("교과목번호", "강좌번호", "강의언어"))
        if not code or code == "nan" or lang in ("", "nan", "한국어"):
            continue
        sec = sec.zfill(3) if sec.isdigit() else sec
        out.setdefault(code, {})[sec] = lang
    return out


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--raw", default=str(RAW))
    ap.add_argument("--from", dest="start", type=int, default=2019)
    ap.add_argument("-o", "--output", default=str(OUT))
    args = ap.parse_args(argv)
    files = sorted((p for p in Path(args.raw).glob("*.xls*") if term_key(p.stem) and term_key(p.stem)[0] >= args.start),
                   key=lambda p: term_key(p.stem))
    if not files:
        print(f"엑셀이 없다: {args.raw} (python scripts/fetch_history.py --from {args.start})")
        return 1
    terms: dict[str, dict] = {}
    for p in files:
        got = read_langs(p)
        terms[p.stem] = {code: " ".join(sec if lang == "영어" else f"{sec}:{lang}" for sec, lang in sorted(secs.items()))
                         for code, secs in sorted(got.items())}
        print(f"  {p.stem}: 외국어 강좌 {sum(len(v) for v in got.values())}개 ({len(got)}과목)")
    payload = {"source": "서울대학교 수강신청 시스템 강좌검색 '엑셀 저장'의 강의언어 칸(학기마다 한 번 받은 지난 편람)",
               "note": "한국어가 아닌 강좌만. 외국어진행강좌 요건을 세는 데 쓴다(docs/requirements.md)",
               "terms": terms}
    Path(args.output).write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"저장: {args.output} ({len(terms)}학기)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
