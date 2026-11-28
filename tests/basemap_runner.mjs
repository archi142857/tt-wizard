// tests/test_basemap.py 가 부른다: 바탕 지도 타일(web/js/basemap.js)의 배율 단계·그릴 범위·남길 타일·그리기 줄을 가짜 Leaflet 으로 본다.
// 실제 그림(캔버스)과 Leaflet 의 타일 관리는 브라우저에서만 돈다. 여기서는 우리가 바꾼 셈만 본다. 맞으면 "ok" 를 찍고, 틀리면 assert 가 멈춘다.
import assert from "node:assert/strict";
import { baseTiles, snapZoom, viewHalf, pendingTiles } from "../web/js/basemap.js";

// ---- 가짜 브라우저 조각
const painted = [];
globalThis.document = {
  createElement: () => {
    const c = { width: 0, height: 0, style: {}, setAttribute() {} };
    c.getContext = () => ({ canvas: c });
    return c;
  },
};

// ---- 가짜 Leaflet: GridLayer 의 부모 메서드는 부른 것만 적어 둔다
const P = (x, y) => ({ x, y, subtract: (q) => P(x - q.x, y - q.y), add: (q) => P(x + q.x, y + q.y), floor: () => P(Math.floor(x), Math.floor(y)) });
const calls = [];
class GridLayer {
  static extend(proto) {
    class C extends GridLayer {}
    Object.assign(C.prototype, proto);
    C.prototype.options = { ...GridLayer.prototype.options, ...proto.options };
    return C;
  }
  getTileSize() { return P(256, 256); }
}
GridLayer.prototype.options = {};
Object.assign(GridLayer.prototype, {
  onAdd() { calls.push("onAdd"); },
  onRemove() { calls.push("onRemove"); },
  getEvents() { return { zoom: "z", move: "m" }; },
  _update() { calls.push("_update"); },
  _updateLevels() { calls.push("_updateLevels"); },
  _resetGrid() { calls.push("_resetGrid"); },
  _setZoomTransforms() { calls.push("_setZoomTransforms"); },
  _removeTile(key) { delete this._tiles[key]; },
  _initTile() {},
  _tileReady(coords, err, tile) { calls.push(["_tileReady", tile]); },
});
const L = { GridLayer, point: P, bounds: (a, b) => ({ min: a, max: b }) };

// ---- 배율 단계와 범위
assert.equal(snapZoom(15.12), 15);
assert.equal(snapZoom(15.13), 15.25);
assert.equal(snapZoom(16.874), 16.75);
assert.equal(snapZoom(15.6, 0.5), 15.5);
assert.deepEqual(viewHalf({ x: 400, y: 300 }, false, 10), { x: 210, y: 160 });
assert.deepEqual(viewHalf({ x: 400, y: 300 }, true, 10), { x: 260, y: 260 }); // 대각선 500 의 반 + 10

const draws = [];
const layer = baseTiles(L, { draw: (ctx, v) => draws.push([v.map.getZoom(), v.bounds.min.x, v.bounds.min.y, v.bounds.getSize().x, v.m]), lat: 37.46, margin: 0, ratio: () => 2 });
const map = {
  options: { zoomSnap: 0.25 }, _rotOn: false, _animatingZoom: false,
  getZoom: () => 16.1, getSize: () => P(400, 300), getCenter: () => ({ lat: 37.46, lng: 126.95 }),
  getZoomScale: (a, b) => 2 ** (a - b),
  project: () => P(1000.4, 2000.6),
};
layer._map = map;
layer._tiles = {};

assert.equal(layer._clampZoom(16.1), 16); // 지도 zoomSnap 단계
map.options.zoomSnap = 0.5;
assert.equal(layer._clampZoom(16.3), 16.5);
map.options.zoomSnap = 0.25;

// 그릴 범위: 지도 배율 16.1, 타일 배율 16 이면 화면 반을 2^0.1 로 나눈 만큼
layer._tileZoom = 16;
let b = layer._getTiledPixelBounds({});
const s = 2 ** 0.1;
assert.ok(Math.abs(b.max.x - b.min.x - 400 / s) < 1e-9 && Math.abs(b.max.y - b.min.y - 300 / s) < 1e-9);
map._rotOn = true; // 돌릴 수 있으면 대각선 원
b = layer._getTiledPixelBounds({});
assert.ok(Math.abs(b.max.x - b.min.x - 500 / s) < 1e-9 && Math.abs(b.max.y - b.min.y - 500 / s) < 1e-9);
map._rotOn = false;

// ---- 남길 타일: 새 배율을 다 그리기 전에는 마지막으로 다 그린 배율을 남긴다
const tile = (x, y, z, o = {}) => ({ coords: { x, y, z }, el: {}, current: true, loaded: 1, active: true, ...o });
layer._tiles = { a: tile(0, 0, 15.75), b: tile(1, 0, 15.75) };
layer._tileZoom = 15.75;
layer._pruneTiles();
assert.equal(layer._readyZoom, 15.75);
layer._tileZoom = 16;
layer._tiles.a.current = layer._tiles.b.current = false;
layer._tiles.c = tile(0, 0, 16, { loaded: 0, active: false });
layer._tiles.d = tile(5, 5, 16, { current: false });
layer._pruneTiles();
assert.deepEqual(Object.keys(layer._tiles).sort(), ["a", "b", "c"]); // 16 의 범위 밖(d)만 빠지고 15.75 는 남는다
layer._tiles.c.loaded = 1;
layer._tiles.c.active = true;
layer._pruneTiles();
assert.deepEqual(Object.keys(layer._tiles), ["c"]); // 16 을 다 그렸다
assert.equal(layer._readyZoom, 16);

// 배율이 바뀌면 다른 배율의 아직 못 그린 타일은 버린다
layer._tiles = { e: tile(0, 0, 16.25, { loaded: 0 }), f: tile(1, 0, 16.25), g: tile(0, 0, 16.5, { loaded: 0 }) };
layer._tileZoom = 16.5;
layer._abortLoading();
assert.deepEqual(Object.keys(layer._tiles).sort(), ["f", "g"]);
assert.ok(layer._tiles.f && !layer._tiles.e);

// _setView 는 정수가 아니라 단계로 타일 배율을 고른다. 두 손가락 동안(noUpdate)은 범위·타일을 건드리지 않는다
calls.length = 0;
layer._tiles = {};
layer._setView({}, 16.4, false, false);
assert.equal(layer._tileZoom, 16.5);
assert.ok(calls.includes("_update") && calls.includes("_setZoomTransforms"));
calls.length = 0;
layer._setView({}, 15.3, true, true);
assert.equal(layer._tileZoom, 16.5);
assert.deepEqual(calls, ["_setZoomTransforms"]);

// 멈췄을 때 지도 배율이 단계가 다르면 그 배율로(손을 뗀 배율이 이미 단계에 맞을 때)
calls.length = 0;
layer._tileZoom = 16.5;
map.getZoom = () => 16;
layer._onMoveEnd();
assert.equal(layer._tileZoom, 16);
layer._zooming = true; // 두 손가락으로 배율을 바꾸는 동안은 만들지 않는다
calls.length = 0;
layer._onMoveEnd();
assert.deepEqual(calls, []);
layer._zooming = false;

// ---- 그리기 줄: 첫 화면은 바로, 그다음은 줄에서 가운데에 가까운 것부터
layer._syncPaint = true;
layer._tiles = {};
draws.length = 0;
const t0 = layer.createTile({ x: 3, y: 7, z: 16 }, () => {});
assert.equal(draws.length, 1);
assert.deepEqual(draws[0], [16, 768, 1792, 257, 2]); // 타일 왼쪽 위 화소 좌표, 1px 겹침, 화소 배수
assert.equal(t0.width, 514);
layer._update(); // 첫 화면을 만들었다
assert.equal(layer._syncPaint, false);

layer._tileZoom = 16;
map.project = () => P(256 * 10.5, 256 * 20.5); // 가운데 타일 (10, 20)
draws.length = 0;
const far = layer.createTile({ x: 14, y: 20, z: 16 }, () => {});
const near = layer.createTile({ x: 10, y: 21, z: 16 }, () => {});
const gone = layer.createTile({ x: 10, y: 20, z: 16 }, () => {});
gone._ttwGone = true; // 그리기 전에 빠진 타일
assert.equal(pendingTiles(), 3);
await new Promise((r) => setTimeout(r, 50));
assert.equal(pendingTiles(), 0);
assert.deepEqual(draws.map((d) => [d[1] / 256, d[2] / 256]), [[10, 21], [14, 20]]); // 가까운 것 먼저, 빠진 타일은 안 그림
assert.ok(far && near);

// 다시 그리기: 그린 타일만, 화면 밖 타일은 줄로
draws.length = 0;
const el = document.createElement("canvas");
el.width = 514;
layer._tiles = { k: { coords: { x: 10, y: 21, z: 16 }, el, loaded: 1 }, u: { coords: { x: 11, y: 21, z: 16 }, el: document.createElement("canvas"), loaded: 0 } };
layer._onScreen = () => true;
layer.refresh();
assert.equal(draws.length, 1);
assert.equal(draws[0][4], 2); // 타일 캔버스 크기에서 화소 배수

console.log("ok");
