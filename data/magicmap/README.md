# 캠퍼스 마법 지도 자료

출처: **캠퍼스 마법 지도 (https://moreadorecampus.com/)**

'캠퍼스 마법 지도' 개발자 신용범 님이 2026년 9월 29일 메일로 보내 준 자료와, 이 저장소에서 거기에 고도·경사를 붙인 결과.

**자료 조건: [ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/). © [OpenStreetMap 기여자](https://www.openstreetmap.org/copyright), © [캠퍼스 마법 지도](https://moreadorecampus.com/).**
보행 그래프는 OpenStreetMap 도로 자료를 바탕으로 빠진 보행로·연결을 손으로 보강한 것이라(개발자 2026-11-05 메일) OSM 의 파생 데이터베이스입니다.
받은 세 파일과 이 저장소가 거기서 만든 것(아래 '만든 자료', `../travel.csv`·`../travel_slope.csv`·`../route_stats.csv`·`../route_paths.json`, 웹의 `campus.json`·`routes.json`)이
모두 여기에 들고, 다른 분이 이 자료를 쓸 때의 조건은 ODbL 입니다. 전문은 `../../web/licenses/odbl.txt` 에 있습니다.
경사를 반영한 값에는 국토지리정보원 수치지형도 몫이 있어 공공누리 제1유형 출처도 같이 적습니다(`../../web/licenses/kogl-type1.txt`).
이 저장소의 MIT(`LICENSE`)는 이 자료에 걸리지 않습니다(루트 README '라이선스와 자료 조건').

TT Wizard 는 이 저장소에 싣는 것(2026-09-29)과 스토어 무료 배포(2026-11-05, iOS 도 같은 조건)를 제공자에게 허락받았고, 광고나 유료 기능에 쓰게 되면 제공자와 다시 협의하기로 했습니다.
보고서·웹앱 화면·스토어 설명·README 에 위 출처를 적습니다.

마법 지도의 건물 GeoJSON 원본은 받은 자료에 포함돼 있지 않다.

## 받은 자료 (고치지 않는다)

| 파일 | 내용 |
| --- | --- |
| `roads_graph_updated.json` | 도로 그래프. `nodes`: `id`, `lng`, `lat` (WGS84) / `edges`: `id`, `from`, `to`, `distance`(m, 두 노드 사이 직선), `kind`(footway·service·road·steps·cycleway), `oneway`, `walkable`, `costFactor`, `isTunnel`. 엣지는 방향마다 따로 들어 있다 |
| `roads.geojson` | 도로 선형 (지도에 그리는 용도, 그래프 엣지 id와 연결돼 있지 않다) |
| `building_pair_times.csv` | 건물 목록 109개 지점의 모든 방향 쌍 11,772행: `from`, `to`, `distance_m`, `time_s`. 출입구에서 그래프까지의 접속 거리 + 그래프 최단 경로 거리, 시간 = 거리 ÷ 1.1 m/s (경사·건물 안·층간 이동은 반영 안 함) |

## 만든 자료

| 파일 | 만드는 스크립트 | 내용 |
| --- | --- | --- |
| `roads_graph_slope.json` | `scripts/graph_slopes.py` | 받은 그래프와 같은 구조에 엣지 `surface`(지면·터널·다리)를 더한 것. 노드 `ele`, 엣지 `eleFrom`·`eleTo`·`rise`·`grade`·`ascent`·`descent`·`maxGrade` 는 2026-11-03 부터 이 공개 판에서 빼고 PC 의 `data/local/magicmap/` 에만 둔다(수치지형도로 만든 높이 정보, `docs/elevation_method.md` '높이 자료는 PC 에만'. 마법 지도 개발자께 드릴 때는 PC 의 온전한 판). 우리가 더한 길·출입구 접속선·끊긴 갈림목을 이은 조각(`../graph_patch/`)도 들어 있다: 노드 9,194번·엣지 19,351번부터, `src: "ttwizard"` (출입구 노드는 `building`·`entrance`, 엣지는 `osm`·`split_of`·`connector`·`role`: `entrance_link` 접속선, `junction` 갈림목 조각). 받은 엣지 가운데 실제로 없다고 본 것(건물을 뚫는 선, 공사 구역)에는 `blocked`(이유)가 붙는다. 다른 값은 받은 그대로다 |
| (`graph_nodes_elevation.csv`, `graph_edges_slope.csv`) | 〃 | 노드 고도·엣지 경사 표. 2026-11-03 부터 PC 의 `data/local/magicmap/` 에만 |
| `../travel.csv` | `scripts/slope_travel.py` | 시간표 알고리즘 입력(`from,to,minutes,source`): 우리 경로의 평지 시간(source `route`). 2026-10-02 까지는 이 표의 시간을 그대로 옮겨 썼다(source `magicmap`, 그 스크립트는 10/22 에 지웠다. 견줄 때는 `slope_travel.py --base magicmap`). 표와 우리 경로의 차이는 `docs/travel_time_method.md` '표와 우리 경로' |

경사 계산 방법은 `docs/elevation_method.md`의 '도로 그래프 경사'.
