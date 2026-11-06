# data

이 폴더 자료의 조건은 루트 README '라이선스와 자료 조건' 표에 있다. 걷는 길에서 나온 파일의 조건은 여기에도 적는다.

| 파일 | 내용 | 조건 |
| --- | --- | --- |
| `travel.csv`, `travel_slope.csv`, `route_stats.csv`, `route_paths.json` | 캠퍼스 마법 지도 보행 그래프(OpenStreetMap 바탕)에 `graph_patch/` 를 더한 그래프 위에서 계산한 건물 사이 걷는 시간과 경로 모양 | ODbL 1.0, © OpenStreetMap 기여자·캠퍼스 마법 지도(전문 `../web/licenses/odbl.txt`, 자세한 것은 `magicmap/README.md`) |
| 위 가운데 경사를 반영한 값: `travel_slope.csv`, `route_stats.csv` 의 `route_slope_min`·`slope_factor`·`minutes` | 경사는 국토지리정보원 수치지형도로 구했다 | 위 조건에 더해 공공누리 제1유형 출처 표시(`../web/licenses/kogl-type1.txt`) |

웹 화면이 받는 `web/data/campus.json`(이동시간 행렬)과 `routes.json`(경로 모양)도 이 파일들로 만들어 같은 조건을 따른다.
