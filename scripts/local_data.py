"""높이 자료와 공개 자료를 나눈다 (백엔드 update82, 11/3).

법무 11/3 '그대로 갈 때' 1 + 사용자 11/3 "내리자": 수치지형도로 만든 높이 정보(등고선, 고도 표, 노드 고도, 3D·2D 지형)는
웹·앱 묶음·공개 저장소에 두지 않는다. 관리기관 보안 분류표의 '인터넷·휴대폰으로 1:5,000 이상 지도의 등고선·표고값 표시 불가'와
간행심사·국외반출 허가 전의 배포라서다(법무_검토 2절 '그대로 갈 때', docs/elevation_method.md '높이 자료는 PC 에만').

규칙
  PC 에만(data/local/, git 에 없음)  높이 값(해발 m)과 높이에서 나온 값(높이차·오르막·내리막·경사 %)이 든 파일, 3D·2D 지형 모형
  공개(저장소·웹·앱)                  같은 파일에서 그 열·칸을 뺀 것. 이동시간 표(평지·경사 반영), 거리, 계단 길이, 층(1층/2층)은 둔다
높이 자료를 만드는 스크립트(building_elevation.py, graph_slopes.py, slope_travel.py, campus_model.py)는 DEM 이 있는 PC 에서만 돈다.
온전한 것은 LOCAL 에 쓰고, 공개 파일은 여기 함수로 열을 빼서 쓴다. tests/test_public_data.py 가 공개 파일에 높이가 없는지 본다.
"""
from __future__ import annotations

import csv
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
LOCAL = DATA / "local"  # .gitignore. 높이 자료는 여기에만

# 공개 파일에서 빼는 열·칸(이름). 높이 값과 높이에서 나온 값
BUILDING_HEIGHT = ["first_floor_est_m", "lobby_est_m", "entrance_min_m", "entrance_max_m", "ground_min_m", "ground_max_m",
                   "ground_span_m", "point_ground_m", "samples", "dem"]
ENTRANCE_HEIGHT = ["ground_m", "rel_to_1f_m"]
ROUTE_HEIGHT = ["ascent_m", "descent_m", "net_rise_m"]
NODE_HEIGHT = ["ele"]
EDGE_HEIGHT = ["eleFrom", "eleTo", "rise", "grade", "ascent", "descent", "maxGrade"]
LINK_HEIGHT = ["max_grade"]
# 공개 파일 어디에도 있으면 안 되는 이름(시험이 본다)
HEIGHT_NAMES = set(BUILDING_HEIGHT + ENTRANCE_HEIGHT + ROUTE_HEIGHT + NODE_HEIGHT + EDGE_HEIGHT + LINK_HEIGHT) - {"samples", "dem"}


def local_path(public: Path) -> Path:
    """공개 파일 자리 → 같은 이름의 PC 쪽 자리(data/ 아래 같은 하위 폴더)"""
    return LOCAL / Path(public).resolve().relative_to(DATA.resolve())


def strip_fields(fields: list[str], drop: list[str]) -> list[str]:
    return [f for f in fields if f not in drop]


def write_public_csv(rows: list[dict], fields: list[str], drop: list[str], path: Path, encoding: str = "utf-8-sig") -> list[str]:
    """rows 를 drop 열을 뺀 csv 로. 돌려주는 것은 쓴 열"""
    keep = strip_fields(fields, drop)
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", newline="", encoding=encoding) as f:
        w = csv.DictWriter(f, fieldnames=keep, extrasaction="ignore")
        w.writeheader()
        w.writerows(rows)
    return keep


def strip_graph(graph: dict) -> dict:
    """그래프(nodes·edges·meta)에서 노드 고도와 엣지의 높이·경사 칸을 뺀 사본. meta 의 높이 설명도 뺀다"""
    out = {k: v for k, v in graph.items() if k not in ("nodes", "edges", "meta")}
    out["nodes"] = [{k: v for k, v in n.items() if k not in NODE_HEIGHT} for n in graph.get("nodes", [])]
    out["edges"] = [{k: v for k, v in e.items() if k not in EDGE_HEIGHT} for e in graph.get("edges", [])]
    if "meta" in graph:
        meta = {k: v for k, v in graph["meta"].items() if k not in ("elevation", "nodes.ele", "edges")}
        meta["height"] = ("노드 고도·엣지 높이차·경사는 이 공개 파일에 없다(수치지형도로 만든 높이 정보, 2026-11-03 법무 의견). "
                          "surface 는 남긴다. 온전한 것은 DEM 이 있는 PC 의 data/local/magicmap/roads_graph_slope.json")
        out["meta"] = meta
    # 처음 칸 순서(nodes, edges, meta)를 지킨다
    return {k: out[k] for k in list(graph) if k in out} | {k: v for k, v in out.items() if k not in graph}


def dump_graph(graph: dict, path: Path) -> None:
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    Path(path).write_text(json.dumps(graph, ensure_ascii=False), encoding="utf-8")
