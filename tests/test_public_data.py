"""공개 자료에 높이 정보가 없다 (백엔드 update82, 2026-11-03).

법무 '그대로 갈 때' 1 + 사용자 11/3 "내리자": 수치지형도로 만든 높이 정보(등고선, 고도 표, 노드 고도, 3D·2D 지형)는 웹·앱 묶음·공개 저장소에
두지 않는다. 높이 값(m)과 높이에서 나온 값(높이차·오르막·내리막·경사 %)이 든 것은 PC 의 data/local/(git 에 없음)에만 두고,
공개 파일은 그 열·칸을 뺀 것이다(scripts/local_data.py). 높이 자료를 만드는 스크립트를 다시 돌린 뒤 공개 파일에 다시 들어가면 여기서 걸린다.
"""
import csv
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
import local_data as ld  # noqa: E402

DATA = ROOT / "data"
# git 에 없는 곳(.gitignore): 원본·PC 자료
PRIVATE = ("local", "topo", "dem", "raw", "experiments", "field/tracks")


def _public_files(exts):
    for p in sorted(DATA.rglob("*")):
        rel = p.relative_to(DATA).as_posix()
        if p.is_file() and p.suffix in exts and not any(rel == d or rel.startswith(d + "/") for d in PRIVATE):
            yield p


def _keys(obj, out):
    if isinstance(obj, dict):
        for k, v in obj.items():
            out.add(k)
            _keys(v, out)
    elif isinstance(obj, list):
        for v in obj:
            _keys(v, out)
    return out


def test_gitignore_keeps_local_heights_off_the_repo():
    ignore = (ROOT / ".gitignore").read_text(encoding="utf-8").splitlines()
    assert "data/local/" in ignore and "data/dem/" in ignore and "data/topo/" in ignore


def test_public_tables_have_no_height_columns():
    """공개 csv 에 높이 열이 없다(건물 고도·출입구 고도·노드 고도·엣지 경사·쌍마다의 오르막과 높이차)"""
    bad = {}
    for p in _public_files({".csv"}):
        with open(p, newline="", encoding="utf-8-sig") as f:
            head = next(csv.reader(f), [])
        hit = sorted(set(h.strip() for h in head) & ld.HEIGHT_NAMES)
        if hit or re.search(r"(^|_)ele(_|$)", ",".join(head)):
            bad[p.relative_to(ROOT).as_posix()] = hit or head
    assert not bad, bad
    assert not (DATA / "magicmap" / "graph_nodes_elevation.csv").exists() and not (DATA / "magicmap" / "graph_edges_slope.csv").exists()


def test_public_json_has_no_heights():
    """공개 json·geojson 에 높이 칸이 없다(그래프 노드 ele·엣지 eleFrom·rise·grade…, 접속선 max_grade, 출입구 ground_m …)"""
    bad = {}
    for p in _public_files({".json", ".geojson"}):
        hit = sorted(_keys(json.loads(p.read_text(encoding="utf-8-sig")), set()) & ld.HEIGHT_NAMES)
        if hit:
            bad[p.relative_to(ROOT).as_posix()] = hit
    assert not bad, bad


def test_basemap_has_no_contours_and_web_has_no_terrain_model():
    """바탕 지도에 등고선이 없고(앱·웹·위젯이 그리는 것), 웹에 3D·2D 지형 모형이 없다(campus_model.py 는 data/local/model/ 에 쓴다)"""
    base = json.loads((DATA / "basemap.json").read_text(encoding="utf-8"))
    assert "contour" not in base and not [n for g in base["src_layers"] for n in g["layers"] if n.startswith("contour")]
    assert not (ROOT / "web" / "model").exists()
    for doc in ("README.md", "web/README.md"):
        assert "tt-wizard/model/" not in (ROOT / doc).read_text(encoding="utf-8"), doc  # 웹 주소로 건 모형 링크
    import campus_model
    assert campus_model.OUT == ld.LOCAL / "model" and campus_model.GRAPH == ld.LOCAL / "magicmap" / "roads_graph_slope.json"


def test_scripts_write_heights_only_locally():
    """높이 자료를 만드는 스크립트의 기본 출력은 data/local/ 이고, 공개 자리에는 열을 뺀 판을 쓴다"""
    import building_elevation as be
    import graph_slopes as gs
    import slope_travel as st
    assert (be.OUT_CSV, be.OUT_ENT) == (ld.LOCAL / "buildings_elevation.csv", ld.LOCAL / "building_entrances.csv")
    assert (gs.OUT_JSON, gs.OUT_NODES, gs.OUT_EDGES) == tuple(ld.LOCAL / "magicmap" / n for n in
                                                             ("roads_graph_slope.json", "graph_nodes_elevation.csv", "graph_edges_slope.csv"))
    assert st.OUT_STATS == ld.LOCAL / "route_stats.csv" and st.GRAPH == ld.LOCAL / "magicmap" / "roads_graph_slope.json"
    assert ld.local_path(DATA / "magicmap" / "roads_graph_slope.json") == gs.OUT_JSON


def test_strip_graph_and_public_csv(tmp_path):
    graph = {"nodes": [{"id": 1, "lng": 1.0, "lat": 2.0, "ele": 80.5}],
             "edges": [{"id": 1, "from": 1, "to": 1, "distance": 3.0, "surface": "ground", "eleFrom": 1, "eleTo": 2, "rise": 1,
                        "grade": 33, "ascent": 1, "descent": 0, "maxGrade": 40}],
             "meta": {"elevation": "DEM", "nodes.ele": "m", "edges": "…", "source": "마법 지도"}}
    pub = ld.strip_graph(graph)
    assert list(pub) == ["nodes", "edges", "meta"] and pub["nodes"] == [{"id": 1, "lng": 1.0, "lat": 2.0}]
    assert pub["edges"] == [{"id": 1, "from": 1, "to": 1, "distance": 3.0, "surface": "ground"}]
    assert pub["meta"]["source"] == "마법 지도" and "height" in pub["meta"] and not {"elevation", "nodes.ele", "edges"} & set(pub["meta"])
    assert graph["nodes"][0]["ele"] == 80.5  # 원본은 그대로
    rows = [{"building": "1", "lat": "37.4", "first_floor_est_m": "93.9", "note": ""}]
    keep = ld.write_public_csv(rows, ["building", "lat", "first_floor_est_m", "note"], ld.BUILDING_HEIGHT, tmp_path / "b.csv")
    assert keep == ["building", "lat", "note"]
    assert (tmp_path / "b.csv").read_text(encoding="utf-8-sig").splitlines() == ["building,lat,note", "1,37.4,"]
