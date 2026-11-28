// 바탕 지도 타일(백엔드 update156. 사용자 11/28 '지금 지도 최적화가 필요해보여. 너무 느리고 버벅임').
// 그림 규칙(층 차례·색·폭: app.js 의 drawBasemap, 프론트엔드)은 그대로 두고, 이 모듈은 언제·어디를 그릴지만 정한다(docs/basemap.md '타일로 그리기').
//  - 화면을 256px 타일로 나눠 한 번 그린 타일은 다시 그리지 않는다. 끌기·관성·두 손가락 동안 바탕을 통째로 다시 그리지 않는다
//    (전에는 화면보다 10% 넓은 캔버스 하나라서 그 밖으로 끌 때마다, 그리고 손을 뗄 때마다 바탕 전체를 그렸다. 돌린 지도는 대각선 정사각형이라 더 컸다).
//  - 새 타일은 기다리는 줄에 넣고 프레임 사이에 화면 가운데에 가까운 것부터 그린다(손가락을 따라가는 프레임을 막지 않게).
//  - 배율은 지도의 zoomSnap(0.25) 단계마다 그 배율로 그린다: 선 폭·점선·보이는 배율이 캔버스 하나로 그리던 때와 같다.
//    새 배율의 타일이 다 그려질 때까지 앞 배율의 타일을 늘이거나 줄여 그 자리에 둔다(빈 바탕이 번쩍이지 않게).
//  - 돌릴 수 있는 동안(map._rotOn, app.js 167판)은 화면 가운데를 둘러싼 원을 덮는 범위를 그린다(어느 각도에도 모서리가 비지 않게).
// Leaflet 1.9.4(BSD-2)의 GridLayer 위에 우리가 쓴 것이다. 타일 하나는 캔버스 하나고, 이웃 타일과 1px 겹쳐 확대·축소 중에 이음매가 보이지 않게 한다.

const STEP = 0.25; // 타일 배율 단계(지도 zoomSnap 과 같게. 지도가 0 이면 이 값)
const OVERLAP = 1; // 이웃 타일과 겹치는 화소(CSS)
const BUDGET_IDLE = 12; // 한 번에 그리는 시간(ms): 지도가 멈췄을 때
const BUDGET_BUSY = 4; // 끌거나 확대하는 동안(한 장은 넘어도 그린다)

/** 배율을 타일 단계로 */
export function snapZoom(zoom, step = STEP) {
  return Math.round(zoom / step) * step;
}

/** 타일 범위에 쓸 화면 반폭(CSS px): 돌릴 수 있으면 대각선 원을 덮는 정사각형, 아니면 화면 반. margin 만큼 둘레를 더 그린다 */
export function viewHalf(size, rotOn, margin = 0) {
  if (rotOn) {
    const r = Math.hypot(size.x, size.y) / 2 + margin;
    return { x: r, y: r };
  }
  return { x: size.x / 2 + margin, y: size.y / 2 + margin };
}

// ---- 그리기 줄: 지도 둘(작은 지도·전체 화면 지도)의 타일을 한 줄로 그린다
const jobs = [];
let posted = false, port = null;

/** 다음 그리기를 건다. 지도가 움직이는 동안은 프레임마다 한 번, 그 프레임을 그린 뒤에(손가락을 따라가는 프레임이 먼저) */
function kick() {
  if (posted) return;
  posted = true;
  if (!port && typeof MessageChannel !== "undefined") {
    const ch = new MessageChannel();
    ch.port1.onmessage = run;
    if (typeof ch.port1.unref === "function") ch.port1.unref(); // node(시험)에서 포트가 프로세스를 붙잡지 않게. 브라우저에는 없다
    port = ch.port2;
  }
  const post = () => (port ? port.postMessage(0) : setTimeout(run, 0));
  if (busyNow() && typeof requestAnimationFrame !== "undefined") requestAnimationFrame(post);
  else post();
}

const busyNow = () => jobs.some((j) => j.layer._busy > 0);

/** 다음에 그릴 타일: 지금 배율의 타일부터, 그 지도 가운데에 가까운 것부터 */
function pick() {
  let best = -1, key = Infinity;
  const centers = new Map();
  for (let i = 0; i < jobs.length; i++) {
    const j = jobs[i], layer = j.layer, map = layer._map;
    if (!map || j.tile._ttwGone) { jobs.splice(i, 1); i--; continue; }
    let c = centers.get(layer);
    if (!c) {
      const p = map.project(map.getCenter(), layer._tileZoom), s = layer.getTileSize();
      c = { x: p.x / s.x, y: p.y / s.y };
      centers.set(layer, c);
    }
    const far = Math.hypot(j.coords.x + 0.5 - c.x, j.coords.y + 0.5 - c.y) + (j.coords.z === layer._tileZoom ? 0 : 1e6);
    if (far < key) { key = far; best = i; }
  }
  return best < 0 ? null : jobs.splice(best, 1)[0];
}

function run() {
  posted = false;
  const t0 = performance.now();
  const budget = busyNow() ? BUDGET_BUSY : BUDGET_IDLE;
  for (;;) {
    const j = pick();
    if (!j) break;
    j.layer._paint(j);
    if (performance.now() - t0 >= budget) break;
  }
  if (jobs.length) kick();
}

function enqueue(job) {
  const i = jobs.findIndex((j) => j.tile === job.tile);
  if (i >= 0) { // 같은 타일을 다시 그리라면 하나로(처음 그리기의 done 은 남긴다)
    if (!job.done) job.done = jobs[i].done;
    jobs.splice(i, 1);
  }
  jobs.push(job);
  kick();
}

/** 줄에 남은 일 수(시험용) */
export const pendingTiles = () => jobs.length;

/** 바탕 지도 타일 층을 만든다.
 *  draw(ctx, view): 타일 하나를 그린다. view = { map, bounds, m } 는 app.js drawBasemap(ctx, map, b, m) 이 쓰는 꼴 그대로다
 *    (map.getZoom() = 타일 배율, map.getPixelOrigin() = (0, 0), map.getCenter().lat = lat, bounds.min = 타일 왼쪽 위의 화소 좌표, bounds.getSize() = 타일 크기).
 *  lat: 선 폭(m → 화소)을 셈할 위도. 타일마다 같아야 이음매에서 폭이 같다
 *  ratio(): 화소 배수(기본 화면 배수, 2 까지. 캔버스 하나일 때와 같다)
 *  margin: 화면 둘레로 더 그려 두는 폭(CSS px). 끌 때 가장자리가 비는 것을 줄인다 */
export function baseTiles(L, { draw, lat, pane = "ttw-base", tileSize = 256, margin = 96, keepBuffer = 1, ratio = null } = {}) {
  const pixelRatio = ratio || (() => Math.min(2, (typeof window !== "undefined" && window.devicePixelRatio) || 1));
  const Tiles = L.GridLayer.extend({
    options: {
      pane, tileSize, keepBuffer, noWrap: true, minZoom: 0, maxZoom: 24,
      updateWhenIdle: false, updateWhenZooming: false, updateInterval: 150, className: "ttw-base-tiles",
    },

    onAdd(map) {
      this._busy = 0;
      this._readyZoom = undefined;
      this._syncPaint = true; // 처음 보이는 타일은 바로 그린다(지도를 열 때 바탕이 비어 보이지 않게, 캔버스 하나일 때처럼)
      L.GridLayer.prototype.onAdd.call(this, map);
    },

    // 애니메이션 없이 다시 맞출 때(요일을 바꾸면 fitBounds 를 몇 번) Leaflet 은 타일을 다 버리고 새로 받는다. 우리 타일은 그린 그림이라 버리지 않는다:
    // 같은 배율이면 그대로 쓰고, 배율이 바뀌면 새 배율을 다 그릴 때까지 남긴다. 층의 기준점(origin)은 그대로 두고 _setZoomTransforms 가 새 화소 원점에 맞춘다
    _invalidateAll() {},

    _update(center) {
      L.GridLayer.prototype._update.call(this, center);
      if (this._made) this._syncPaint = false; // 첫 화면의 타일을 만들었다. 그다음부터는 줄에서
    },

    onRemove(map) {
      for (let i = jobs.length - 1; i >= 0; i--) if (jobs[i].layer === this) jobs.splice(i, 1);
      L.GridLayer.prototype.onRemove.call(this, map);
    },

    // 지도가 움직이는 동안은 프레임마다 조금만 그린다(처리기는 프로토타입의 것이라 층을 뺄 때 Leaflet 이 그대로 떼어 낸다)
    getEvents() {
      const ev = L.GridLayer.prototype.getEvents.call(this);
      ev.movestart = this._ttwBusy;
      ev.zoomstart = this._ttwZoomStart;
      ev.zoomend = this._ttwZoomEnd;
      ev.moveend = this._ttwMoveEnd;
      return ev;
    },
    _ttwBusy() {
      this._busy = 1;
    },
    _ttwZoomStart() {
      this._busy = 1;
      this._zooming = true;
    },
    _ttwZoomEnd() {
      this._zooming = false;
    },
    _ttwMoveEnd(e) {
      this._busy = 0;
      this._zooming = false;
      if (jobs.length) kick();
      this._onMoveEnd(e);
    },

    // 옮기는 동안(throttle)과 멈췄을 때 새 타일을 만든다. 두 손가락으로 배율을 바꾸는 동안은 만들지 않는다:
    // 지금 배율의 타일을 늘이거나 줄여 두고, 손을 떼면 새 배율로 그린다(줄이는 동안 지난 배율로 넓은 땅을 그리면 타일이 몇 배로 늘었다)
    // 멈췄는데 타일 배율이 지도 배율과 다르면 그 배율로 새로 그린다: 두 손가락을 놓은 배율이 이미 단계에 맞으면(최소 배율에 걸릴 때 등)
    // Leaflet 은 'zoom' 없이 끝내고, Leaflet 의 _update 는 1 단계 넘게 차이 날 때만 배율을 바꾼다
    _onMoveEnd() {
      const map = this._map;
      if (!map || map._animatingZoom || this._zooming) return;
      if (this._clampZoom(map.getZoom()) !== this._tileZoom) this._setView(map.getCenter(), map.getZoom());
      else this._update();
    },

    // 배율: 지도처럼 0.25 단계(Leaflet 은 정수로 반올림한다)
    _clampZoom(zoom) {
      const step = (this._map && this._map.options.zoomSnap) || STEP;
      return snapZoom(zoom, step);
    },

    // Leaflet _setView 와 같은 차례에 타일 배율만 _clampZoom 으로(정수 반올림 대신)
    _setView(center, zoom, noPrune, noUpdate) {
      let tz = this._clampZoom(zoom);
      if (tz > this.options.maxZoom || tz < this.options.minZoom) tz = undefined;
      const changed = this.options.updateWhenZooming && tz !== this._tileZoom;
      if (!noUpdate || changed) {
        this._tileZoom = tz;
        this._abortLoading();
        this._updateLevels();
        this._resetGrid();
        if (tz !== undefined) this._update(center);
        if (!noPrune) this._pruneTiles();
        this._noPrune = !!noPrune;
      }
      this._setZoomTransforms(center, zoom);
    },

    // 배율이 바뀌면 앞 배율에서 아직 못 그린 타일은 버린다(그린 것은 새 배율이 다 될 때까지 남긴다)
    _abortLoading() {
      for (const k in this._tiles) {
        const t = this._tiles[k];
        if (t.coords.z !== this._tileZoom && !t.loaded) this._removeTile(k);
      }
    },

    // 그릴 범위(타일 배율의 화소 좌표): 돌릴 수 있는 동안은 대각선 원, 둘레 margin
    _getTiledPixelBounds(center) {
      const map = this._map;
      const zoom = map._animatingZoom ? Math.max(map._animateToZoom, map.getZoom()) : map.getZoom();
      const scale = map.getZoomScale(zoom, this._tileZoom);
      const c = map.project(center, this._tileZoom).floor();
      const h = viewHalf(map.getSize(), !!map._rotOn, margin), half = L.point(h.x / scale, h.y / scale);
      return L.bounds(c.subtract(half), c.add(half));
    },

    // 남길 타일: 지금 배율에서 범위(keepBuffer 포함) 안의 것. 지금 배율을 다 그리기 전에는 마지막으로 다 그렸던 배율의 타일을 남긴다
    // (Leaflet 은 정수 배율의 부모·자식 타일로 남기는데 0.25 단계에서는 맞지 않아서)
    _pruneTiles() {
      if (!this._map) return;
      const z = this._tileZoom;
      let ready = true;
      for (const k in this._tiles) {
        const t = this._tiles[k];
        if (t.coords.z === z && t.current && !t.active) { ready = false; break; }
      }
      if (ready) this._readyZoom = z;
      for (const k in this._tiles) {
        const t = this._tiles[k];
        const keep = t.coords.z === z ? t.current : !ready && t.coords.z === this._readyZoom && t.loaded;
        if (!keep) this._removeTile(k);
      }
    },

    _removeTile(key) {
      const t = this._tiles[key];
      if (t) t.el._ttwGone = true;
      L.GridLayer.prototype._removeTile.call(this, key);
    },

    // 이웃과 1px 겹치게(확대·축소로 늘일 때 틈이 보이지 않게)
    _initTile(tile) {
      L.GridLayer.prototype._initTile.call(this, tile);
      const s = this.getTileSize();
      tile.style.width = `${s.x + OVERLAP}px`;
      tile.style.height = `${s.y + OVERLAP}px`;
    },

    createTile(coords, done) {
      const tile = document.createElement("canvas"), s = this.getTileSize(), m = pixelRatio();
      tile.width = Math.round((s.x + OVERLAP) * m);
      tile.height = Math.round((s.y + OVERLAP) * m);
      tile.setAttribute("aria-hidden", "true");
      const job = { layer: this, tile, coords: { x: coords.x, y: coords.y, z: coords.z }, done, m };
      this._made = true;
      if (this._syncPaint) {
        // 바로 그리되 다 됐다는 알림은 Leaflet 이 타일을 등록한 뒤에(_addTile 이 createTile 다음에 _tiles 에 넣는다)
        job.done = null;
        this._paint(job);
        tile._ttwInstant = true;
        Promise.resolve().then(() => done(null, tile));
      } else enqueue(job);
      return tile;
    },

    // 바로 그린 타일은 흐려졌다 나타나지 않게(캔버스 하나일 때처럼 한 번에). 줄에서 그린 타일은 Leaflet 대로 0.2초 동안 나타난다
    _tileReady(coords, err, tile) {
      const map = this._map;
      if (!map) return; // 층을 뺀 뒤에 온 알림(Leaflet 은 뺀 뒤 this._map 을 읽다 멈춘다)
      if (tile && tile._ttwInstant && map._fadeAnimated) {
        map._fadeAnimated = false;
        try { L.GridLayer.prototype._tileReady.call(this, coords, err, tile); } finally { map._fadeAnimated = true; }
        return;
      }
      L.GridLayer.prototype._tileReady.call(this, coords, err, tile);
    },

    _paint(job) {
      const { tile, coords } = job, s = this.getTileSize(), w = s.x + OVERLAP, hgt = s.y + OVERLAP;
      const ctx = tile.getContext("2d");
      try {
        if (ctx) {
          const view = {
            m: job.m,
            map: { getZoom: () => coords.z, getPixelOrigin: () => ({ x: 0, y: 0 }), getCenter: () => ({ lat }) },
            bounds: { min: { x: coords.x * s.x, y: coords.y * s.y }, getSize: () => ({ x: w, y: hgt }) },
          };
          draw(ctx, view);
        }
      } finally {
        if (job.done) job.done(null, tile); // 그리다 멈춰도 타일은 다 된 것으로(줄이 서지 않게. 바탕색만 보인다)
      }
    },

    /** 바탕을 다시 그린다(자료가 왔을 때, 라이트·다크가 바뀔 때). 있는 타일은 그대로 두고 그 위에 다시 그린다.
     *  now(기본): 화면에 걸린 타일은 바로(한 번에) 그린다(캔버스 하나일 때처럼 색이 한꺼번에 바뀐다). 나머지는 줄에 */
    refresh(now = true) {
      if (!this._map) return this;
      const size = this._map.getSize();
      for (const k in this._tiles) {
        const t = this._tiles[k];
        if (!t.loaded) continue; // 아직 줄에 있는 타일은 그때 새 자료·색으로 그린다
        const job = { layer: this, tile: t.el, coords: t.coords, done: null, m: t.el.width / (this.getTileSize().x + OVERLAP) };
        if (now && t.coords.z === this._tileZoom && this._onScreen(t, size)) this._paint(job);
        else enqueue(job);
      }
      return this;
    },

    /** 그릴 범위(위도·경도). 이 밖의 타일은 만들지 않는다 */
    setDataBounds(bounds) {
      this.options.bounds = bounds;
      return this;
    },

    _onScreen(t, size) {
      const map = this._map, s = this.getTileSize();
      const nw = map.unproject(L.point(t.coords.x * s.x, t.coords.y * s.y), t.coords.z);
      const se = map.unproject(L.point((t.coords.x + 1) * s.x, (t.coords.y + 1) * s.y), t.coords.z);
      const a = map.latLngToContainerPoint(nw), b = map.latLngToContainerPoint(se), pad = map._rotOn ? Math.hypot(size.x, size.y) / 2 : 0;
      return Math.max(a.x, b.x) >= -pad && Math.min(a.x, b.x) <= size.x + pad && Math.max(a.y, b.y) >= -pad && Math.min(a.y, b.y) <= size.y + pad;
    },
  });
  return new Tiles();
}
