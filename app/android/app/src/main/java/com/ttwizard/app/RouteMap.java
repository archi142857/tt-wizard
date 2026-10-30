package com.ttwizard.app;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.Iterator;
import java.util.List;
import java.util.Map;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * 동선 지도 위젯의 자료와 셈 — 백엔드 세션(10/30 update71). 화면 코드 없이 시험한다(tests/widget_java 의 WidgetCheck).
 * 앱 묶음에 넣은 자료 셋을 읽어 세계 좌표(웹 메르카토르 0~1. 앱 화면 app.js 의 decodeWorld 와 같다)로 둔다:
 *   data/basemap.json  바탕 지도(docs/basemap.md: 면 = [소수 자리, 고리…], 선 = [OSM 길 종류, polyline], 등고선 = [높이 m, polyline])
 *   data/routes.json   건물 사이 걷는 길("a|b" → polyline 소수 5자리. 한쪽 방향만 있으면 거꾸로 읽는다: engine.js routeLine 과 같다)
 *   data/campus.json   건물 자리(buildings: id → [이름, 위도, 경도])
 * 그리기는 DayMapBitmap.
 */
final class RouteMap {

    /** 바탕의 도형 하나: 면(고리 여럿, 첫 고리가 바깥)이나 선·등고선(고리 하나). kind 는 선의 OSM 길 종류, bb = [x0, y0, x1, y1] */
    static final class Shape {
        final double[][] rings;
        final String kind;
        final double[] bb;

        Shape(double[][] rings, String kind) {
            this.rings = rings;
            this.kind = kind;
            double x0 = 1, y0 = 1, x1 = 0, y1 = 0;
            for (double[] r : rings) {
                for (int i = 0; i + 1 < r.length; i += 2) {
                    x0 = Math.min(x0, r[i]);
                    x1 = Math.max(x1, r[i]);
                    y0 = Math.min(y0, r[i + 1]);
                    y1 = Math.max(y1, r[i + 1]);
                }
            }
            this.bb = new double[] { x0, y0, x1, y1 };
        }

        boolean meets(double x0, double y0, double x1, double y1) {
            return bb[2] >= x0 && bb[0] <= x1 && bb[3] >= y0 && bb[1] <= y1;
        }
    }

    final Map<String, List<Shape>> areas = new HashMap<>();
    final Map<String, List<Shape>> lines = new HashMap<>();
    final List<Shape> contours = new ArrayList<>(); // 계곡선(index)만: 위젯 크기에서는 주곡선이 너무 촘촘하다
    final Map<String, double[]> where = new HashMap<>();
    private JSONObject paths;

    private RouteMap() {}

    /** 자료 셋(없거나 깨진 것은 null 로 두고 그 부분만 빠진다: 바탕이 없으면 길과 핀만) */
    static RouteMap parse(String basemap, String campus, String routes) {
        RouteMap m = new RouteMap();
        try {
            if (basemap != null) m.readBasemap(new JSONObject(basemap));
        } catch (JSONException | RuntimeException e) {
            m.areas.clear();
            m.lines.clear();
            m.contours.clear();
        }
        try {
            JSONObject b = campus == null ? null : new JSONObject(campus).optJSONObject("buildings");
            for (Iterator<String> it = b == null ? null : b.keys(); it != null && it.hasNext(); ) {
                String id = it.next();
                JSONArray v = b.optJSONArray(id);
                if (v == null || v.isNull(1) || v.isNull(2)) continue;
                m.where.put(id, new double[] { x(v.optDouble(2, 0)), y(v.optDouble(1, 0)) });
            }
        } catch (JSONException | RuntimeException e) {
            m.where.clear();
        }
        try {
            m.paths = routes == null ? null : new JSONObject(routes).optJSONObject("paths");
        } catch (JSONException | RuntimeException e) {
            m.paths = null;
        }
        return m;
    }

    private void readBasemap(JSONObject b) {
        JSONObject area = b.optJSONObject("area");
        for (Iterator<String> it = area == null ? null : area.keys(); it != null && it.hasNext(); ) {
            String k = it.next();
            JSONArray list = area.optJSONArray(k);
            List<Shape> out = new ArrayList<>();
            for (int i = 0; list != null && i < list.length(); i++) {
                JSONArray f = list.optJSONArray(i);
                if (f == null || f.length() < 2) continue;
                int prec = f.optInt(0, 5);
                double[][] rings = new double[f.length() - 1][];
                for (int r = 1; r < f.length(); r++) rings[r - 1] = decode(f.optString(r, ""), prec);
                out.add(new Shape(rings, ""));
            }
            areas.put(k, out);
        }
        JSONObject line = b.optJSONObject("line");
        for (Iterator<String> it = line == null ? null : line.keys(); it != null && it.hasNext(); ) {
            String k = it.next();
            JSONArray list = line.optJSONArray(k);
            List<Shape> out = new ArrayList<>();
            for (int i = 0; list != null && i < list.length(); i++) {
                JSONArray f = list.optJSONArray(i);
                if (f != null && f.length() >= 2) out.add(new Shape(new double[][] { decode(f.optString(1, ""), 5) }, f.optString(0, "")));
            }
            lines.put(k, out);
        }
        JSONObject contour = b.optJSONObject("contour");
        JSONArray index = contour == null ? null : contour.optJSONArray("index");
        for (int i = 0; index != null && i < index.length(); i++) {
            JSONArray f = index.optJSONArray(i);
            if (f != null && f.length() >= 2) contours.add(new Shape(new double[][] { decode(f.optString(1, ""), 5) }, f.optString(0, "")));
        }
    }

    /** 건물 자리(세계 좌표 {x, y}), 모르면 null */
    double[] at(String b) {
        return b == null ? null : where.get(b);
    }

    /** a → b 걷는 길 [x0, y0, x1, y1, …]. routes 에 없으면 두 건물을 곧게 잇고(앱 화면과 같다), 자리도 모르면 null */
    double[] path(String a, String b) {
        String s = paths == null ? null : paths.optString(a + "|" + b, null);
        if (s != null) return decode(s, 5);
        s = paths == null ? null : paths.optString(b + "|" + a, null);
        if (s != null) return reverse(decode(s, 5));
        double[] p = at(a), q = at(b);
        return p != null && q != null ? new double[] { p[0], p[1], q[0], q[1] } : null;
    }

    static double[] reverse(double[] pts) {
        double[] out = new double[pts.length];
        for (int i = 0; i + 1 < pts.length; i += 2) {
            out[pts.length - 2 - i] = pts[i];
            out[pts.length - 1 - i] = pts[i + 1];
        }
        return out;
    }

    /** 경도 → 세계 x(0~1) */
    static double x(double lon) {
        return (lon + 180) / 360;
    }

    /** 위도 → 세계 y(0~1, 북쪽이 0) */
    static double y(double lat) {
        double phi = Math.toRadians(lat);
        return (1 - Math.log(Math.tan(Math.PI / 4 + phi / 2)) / Math.PI) / 2;
    }

    /** 세계 y → 위도(선 굵기를 미터로 셀 때) */
    static double lat(double y) {
        return Math.toDegrees(Math.atan(Math.sinh(Math.PI * (1 - 2 * y))));
    }

    /** Google polyline(소수 prec 자리) → [x0, y0, x1, y1, …] 세계 좌표. 깨진 끝은 거기까지만 */
    static double[] decode(String s, int prec) {
        double f = Math.pow(10, prec);
        double[] out = new double[32];
        int n = 0, i = 0;
        long lat = 0, lon = 0;
        while (i < s.length()) {
            long[] d = new long[2];
            for (int k = 0; k < 2; k++) {
                int sh = 0, b;
                long r = 0;
                do {
                    if (i >= s.length()) return Arrays.copyOf(out, n);
                    b = s.charAt(i++) - 63;
                    r |= (long) (b & 31) << sh;
                    sh += 5;
                } while (b >= 32);
                d[k] = (r & 1) != 0 ? ~(r >> 1) : r >> 1;
            }
            lat += d[0];
            lon += d[1];
            if (n + 2 > out.length) out = Arrays.copyOf(out, out.length * 2);
            out[n++] = x(lon / f);
            out[n++] = y(lat / f);
        }
        return Arrays.copyOf(out, n);
    }

    // ------------------------------------------------------------ 그날 지도의 짜임(DayMapBitmap 이 그대로 그린다)

    static final double MAX_ZOOM = 17, ONE_ZOOM = 16; // 앱 화면: 그날 경로에 맞추되 17 까지, 수업이 없는 날은 출발 자리를 16 으로

    /** 그날 지도에 그릴 것과 자리: 길(세계 좌표), 출발 자리, 핀 묶음(그림 화소), 세계 → 화소 변환과 그 배율의 CSS 화소당 m */
    static final class Plan {
        final List<double[]> lines = new ArrayList<>();
        final List<Boolean> back = new ArrayList<>(); // 마지막 수업 뒤 돌아가는 길(파선)
        double[] home; // 출발·도착 자리(세계), 모르면 null
        final List<float[]> spots = new ArrayList<>(); // 핀 자리(화소)
        final List<String> labels = new ArrayList<>(); // 핀 글 '1', '2·3'
        double scale;
        double ox;
        double oy;
        double metersPerPx;

        float x(double wx) {
            return (float) (wx * scale - ox);
        }

        float y(double wy) {
            return (float) (wy * scale - oy);
        }
    }

    /**
     * 그날(day, 시작 차례) 지도의 짜임. w×h 화소 그림, dp = 화소 / CSS px. 그릴 것이 없으면 null.
     * 그날 경로 전체가 들어오게 맞추고(배율 17 까지, 길이 없고 핀이 하나면 16), 핀(반지름 12 + 테두리)이 잘리지 않게 가장자리 18, 아래는 출처 글이 덮어 26 을 비운다.
     * 겹치는 핀(가운데끼리 24 보다 가까움)은 앞 번호 자리에 묶는다(앱 화면 groupStops 처럼 '1·2')
     */
    Plan plan(List<WidgetData.Lesson> day, String home, int w, int h, float dp) {
        Plan p = new Plan();
        double x0 = 1, y0 = 1, x1 = 0, y1 = 0;
        for (WidgetData.Leg lg : WidgetData.legs(day, home)) {
            double[] pts = path(lg.from, lg.to);
            if (pts == null || pts.length < 4) continue;
            p.lines.add(pts);
            p.back.add(lg.num == 0);
            for (int i = 0; i + 1 < pts.length; i += 2) {
                x0 = Math.min(x0, pts[i]);
                x1 = Math.max(x1, pts[i]);
                y0 = Math.min(y0, pts[i + 1]);
                y1 = Math.max(y1, pts[i + 1]);
            }
        }
        List<WidgetData.Stop> stops = new ArrayList<>();
        for (WidgetData.Stop s : WidgetData.stops(day, home)) if (at(s.b) != null) stops.add(s);
        p.home = at(home);
        List<double[]> pins = new ArrayList<>();
        for (WidgetData.Stop s : stops) pins.add(at(s.b));
        if (p.home != null) pins.add(p.home);
        for (double[] q : pins) {
            x0 = Math.min(x0, q[0]);
            x1 = Math.max(x1, q[0]);
            y0 = Math.min(y0, q[1]);
            y1 = Math.max(y1, q[1]);
        }
        if (x1 < x0) return null;
        double one = 256.0 * dp; // 세계 1 = 256 × 2^배율 CSS px
        boolean single = p.lines.isEmpty() && pins.size() <= 1;
        double[] t = fit(new double[] { x0, y0, x1, y1 }, w, h, new double[] { 18 * dp, 18 * dp, 18 * dp, 26 * dp },
            one * Math.pow(2, single ? ONE_ZOOM : MAX_ZOOM));
        p.scale = t[0];
        p.ox = t[1];
        p.oy = t[2];
        double zoom = Math.log(p.scale / one) / Math.log(2);
        p.metersPerPx = 156543.034 * Math.cos(Math.toRadians(lat((y0 + y1) / 2))) / Math.pow(2, zoom);
        float r = 12 * dp;
        List<List<Integer>> groups = new ArrayList<>();
        for (WidgetData.Stop s : stops) {
            double[] q = at(s.b);
            float px = p.x(q[0]), py = p.y(q[1]);
            int into = -1;
            for (int g = 0; g < p.spots.size() && into < 0; g++) {
                if (Math.hypot(p.spots.get(g)[0] - px, p.spots.get(g)[1] - py) < 2 * r) into = g;
            }
            if (into < 0) {
                p.spots.add(new float[] { px, py });
                groups.add(new ArrayList<>(s.nums));
            } else {
                groups.get(into).addAll(s.nums);
            }
        }
        for (List<Integer> nums : groups) {
            java.util.Collections.sort(nums);
            StringBuilder label = new StringBuilder();
            for (int n : nums) label.append(label.length() == 0 ? "" : "·").append(n);
            p.labels.add(label.toString());
        }
        return p;
    }

    /**
     * 점들의 범위 bb = [x0, y0, x1, y1] 을 w×h 화소 그림에 맞춘다: 가장자리 여백 pad = {왼, 위, 오른, 아래}(화소), 배율은 maxScale(세계 1 = 화소) 위로
     * 키우지 않고, 남는 자리에서 가운데. 반환 {scale, ox, oy}: 화소 = 세계 × scale − o
     */
    static double[] fit(double[] bb, double w, double h, double[] pad, double maxScale) {
        double bw = Math.max(bb[2] - bb[0], 1e-12), bh = Math.max(bb[3] - bb[1], 1e-12);
        double iw = Math.max(1, w - pad[0] - pad[2]), ih = Math.max(1, h - pad[1] - pad[3]);
        double scale = Math.min(maxScale, Math.min(iw / bw, ih / bh));
        double cx = (bb[0] + bb[2]) / 2, cy = (bb[1] + bb[3]) / 2;
        double px = pad[0] + iw / 2, py = pad[1] + ih / 2;
        return new double[] { scale, cx * scale - px, cy * scale - py };
    }
}
