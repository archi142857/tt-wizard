"""scripts/ 가 같이 쓰는 작은 도구. 표준 라이브러리만 쓴다(export_web.py 는 따로 설치하지 않고 돈다).

  console_safe()                       윈도 콘솔(cp949)이 못 찍는 글자가 있어도 멈추지 않게. main 맨 앞에서 부른다
  read_rows(path)                      CSV → dict 목록(BOM 이 있어도 된다). 파일이 없으면 []
  write_csv(path, rows)                dict 목록 → CSV. 엑셀이 한글을 읽도록 BOM 을 붙이고, 열은 처음 나온 차례로
  encode_polyline / decode_polyline    Google polyline(화면 web/js/engine.js 의 decodePolyline 과 같은 방식)
  OSM_META                             OpenStreetMap 에서 받은 GeoJSON 의 머리 meta(출처와 ODbL)
"""

from __future__ import annotations

import csv
import sys
from pathlib import Path


# OpenStreetMap 에서 온 자료는 ODbL 로만 낼 수 있고 파일에도 그렇게 적는다(ODbL 4.2). 저장소의 MIT(LICENSE)는 코드에만 걸린다
OSM_META = {"source": "© OpenStreetMap contributors", "license": "ODbL 1.0",
            "license_url": "https://opendatacommons.org/licenses/odbl/1-0/", "copyright": "https://www.openstreetmap.org/copyright"}


def console_safe() -> None:
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(errors="replace")


def read_rows(path: Path | str | None) -> list[dict]:
    if not path or not Path(path).exists():
        return []
    with open(path, newline="", encoding="utf-8-sig") as f:
        return list(csv.DictReader(f))


def write_csv(path: Path, rows: list[dict]) -> None:
    if not rows:
        return
    fields = list(dict.fromkeys(k for r in rows for k in r))
    with open(path, "w", newline="", encoding="utf-8-sig") as f:
        w = csv.DictWriter(f, fieldnames=fields)
        w.writeheader()
        w.writerows(rows)


def _encode_number(v: int) -> str:
    v = ~(v << 1) if v < 0 else v << 1
    out = []
    while v >= 0x20:
        out.append(chr((0x20 | (v & 0x1F)) + 63))
        v >>= 5
    out.append(chr(v + 63))
    return "".join(out)


def encode_polyline(latlon, prec: int = 5, *, dedupe: bool = False) -> str:
    """[(lat, lon), ...] → polyline 문자열. 소수 prec 자리(5 = 약 1 m, 6 = 약 0.1 m). dedupe 면 같은 점이 이어질 때 하나만 적는다."""
    f = 10**prec
    out, plat, plon, first = [], 0, 0, True
    for lat, lon in latlon:
        ilat, ilon = round(lat * f), round(lon * f)
        if dedupe and not first and ilat == plat and ilon == plon:
            continue
        out.append(_encode_number(ilat - plat) + _encode_number(ilon - plon))
        plat, plon, first = ilat, ilon, False
    return "".join(out)


def decode_polyline(text: str, prec: int = 5) -> list[tuple[float, float]]:
    """polyline 문자열 → [(lat, lon), ...]."""
    out, i, lat, lon, f = [], 0, 0, 0, 10**prec
    while i < len(text):
        vals = []
        for _ in range(2):
            shift = result = 0
            while True:
                b = ord(text[i]) - 63
                i += 1
                result |= (b & 0x1F) << shift
                shift += 5
                if b < 0x20:
                    break
            vals.append(~(result >> 1) if result & 1 else result >> 1)
        lat += vals[0]
        lon += vals[1]
        out.append((lat / f, lon / f))
    return out
