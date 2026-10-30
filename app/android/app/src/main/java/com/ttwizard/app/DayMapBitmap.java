package com.ttwizard.app;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.DashPathEffect;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.PorterDuff;
import android.graphics.PorterDuffXfermode;
import android.graphics.Typeface;
import android.util.Log;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.lang.ref.SoftReference;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * 동선 지도 위젯의 지도 그림 — 백엔드 세션(10/30 update71, 사용자: "그 날의 동선 지도 위젯도 하나 만들자").
 * 앱 화면의 요일 동선 지도(app.js renderMap·drawBasemap)를 위젯 크기로 옮겼다:
 *   바탕  땅·숲·잔디·캠퍼스·물·보행 면·도로면과 길·건물·계곡선(drawBasemap 과 같은 차례·색. 보행로 점선·계단·높이 글은 작아서 뺀다)
 *   길    수업 가는 길은 route 4px 실선 + card 2px 테두리, 마지막 수업 뒤 출발·도착 자리로 돌아가는 길은 route-home 3px 파선(8 6) + 같은 파선
 *         card 테두리를 진행 방향 오른쪽으로 7px 비켜 수업 가는 길 아래 층에(update73, 디자인: 같은 길을 되짚어도 가려지지 않게).
 *         길은 건물 문 앞에서 끝나고 핀은 건물 자리라, 선 끝에서 핀 가운데까지 그 선 색 둥근 점으로 잇는다(앱 '선 끝과 핀', update73)
 *   핀    수업은 accent 원(24px, card 2px 테두리)에 번호(12 굵게, 같은 건물은 '2·3'), 출발·도착 자리는 home 원에 집 모양
 * 그날 경로 전체가 들어오게 맞추고(배율은 17 까지, 수업이 없으면 출발 자리를 가운데에 16), 핀이 잘리지 않게 가장자리를 비운다.
 * 아래 오른쪽은 출처 글(레이아웃의 w_attr)이 덮으므로 더 비운다. 라이트·다크 두 장을 그리고 layout(-night)/widget_map.xml 이 한 장을 보인다.
 * 자료는 앱에 넣은 것(public/data/*.json)을 한 번 읽어 둔다(RouteMap). 앱이 켤 때 새로 받는 자료는 화면만 쓴다.
 * 색은 웹 화면 기본 테마 토큰과 같은 값(TOKENS 차례, tests/test_widgets.py 가 web/style.css 와 견준다).
 */
final class DayMapBitmap {

    private static final String TAG = "TTWWidget";

    /** 색 차례(웹 토큰 이름). LIGHT·DARK 는 이 차례의 값 */
    static final String[] TOKENS = {
        "map-land", "map-campus", "map-campus-line", "map-green", "map-park", "map-grass", "map-pitch", "map-water", "map-contour-index",
        "map-walk-area", "map-road", "map-road-line", "map-road-secondary", "map-road-secondary-line", "map-road-primary", "map-road-primary-line",
        "map-road-trunk", "map-road-trunk-line", "map-ped", "map-ped-line", "map-building", "map-building-line",
        "route", "route-home", "card", "accent", "on-color", "home", "on-home",
    };
    private static final int LAND = 0, CAMPUS = 1, CAMPUS_LINE = 2, GREEN = 3, PARK = 4, GRASS = 5, PITCH = 6, WATER = 7, CONTOUR = 8,
        WALK = 9, ROAD = 10, ROAD_LINE = 11, ROAD_SECONDARY = 12, ROAD_PRIMARY = 14, ROAD_TRUNK = 16, PED = 18, PED_LINE = 19,
        BUILDING = 20, BUILDING_LINE = 21, ROUTE = 22, ROUTE_HOME = 23, CARD = 24, ACCENT = 25, ON_COLOR = 26, HOME = 27, ON_HOME = 28;

    static final int[] LIGHT = {
        0xFFF2EFE9, 0xFFF5F6FF, 0xFFD7DCFA, 0xFFC9E2C2, 0xFFD3EACB, 0xFFD7EDCF, 0xFFBFE4D2, 0xFFAFC9F2, 0xFFCAC4D6,
        0xFFFBFBFE, 0xFFFFFFFF, 0xFFC3C0D0, 0xFFF2F1C4, 0xFFC2C08A, 0xFFF9D9AF, 0xFFD2AE78,
        0xFFF7BBA8, 0xFFD99683, 0xFFE3E4F4, 0xFFB3B6D2, 0xFFD3C8BE, 0xFFAE9F91,
        0xFF4F70FF, 0xFF1D2A78, 0xFFFFFFFF, 0xFF415FEC, 0xFFFFFFFF, 0xFF1D2A78, 0xFFEEF0FF,
    };
    static final int[] DARK = {
        0xFF17171B, 0xFF1C1D25, 0xFF2B2E40, 0xFF1B261F, 0xFF1E2A21, 0xFF1F2B22, 0xFF1B2D27, 0xFF1C2B45, 0xFF32313C,
        0xFF22222A, 0xFF3B3C45, 0xFF0D0D10, 0xFF5E5E3E, 0xFF3B3B27, 0xFF7A6142, 0xFF4A3B28,
        0xFF7D4E43, 0xFF4C2F28, 0xFF35364A, 0xFF121218, 0xFF463F39, 0xFF605750,
        0xFF758BE7, 0xFFCED1D9, 0xFF1E2026, 0xFF4D6CE0, 0xFFFFFFFF, 0xFFCED1D9, 0xFF16171B,
    };

    private static final float MAX_DENSITY = 2.5f; // WeekBitmap 과 같다(위젯 갱신 자료를 가볍게)
    // 캠퍼스 안 찻길 폭(m, OSM highway 값). app.js ROAD_M 과 같다
    private static final Map<String, Float> ROAD_M = new HashMap<>();

    static {
        ROAD_M.put("service", 4.5f);
        ROAD_M.put("residential", 6f);
        ROAD_M.put("living_street", 5f);
        ROAD_M.put("unclassified", 6f);
        ROAD_M.put("tertiary", 7f);
        ROAD_M.put("tertiary_link", 6f);
    }

    private static SoftReference<RouteMap> cache = new SoftReference<>(null);

    private DayMapBitmap() {}

    /** 앱에 넣은 자료를 읽은 RouteMap(한 번 읽어 둔다. 메모리가 모자라면 시스템이 버리고 다음에 다시 읽는다) */
    static synchronized RouteMap data(Context c) {
        RouteMap m = cache.get();
        if (m == null) {
            m = RouteMap.parse(asset(c, "public/data/basemap.json"), asset(c, "public/data/campus.json"), asset(c, "public/data/routes.json"));
            cache = new SoftReference<>(m);
        }
        return m;
    }

    private static String asset(Context c, String name) {
        try (InputStream in = c.getAssets().open(name)) {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[64 * 1024];
            int n;
            while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
            return new String(out.toByteArray(), StandardCharsets.UTF_8);
        } catch (IOException e) {
            Log.w(TAG, "no " + name, e);
            return null;
        }
    }

    /** 그릴 것이 있는지(구간이나 핀이 하나라도 자리를 안다) */
    static boolean drawable(RouteMap m, List<WidgetData.Lesson> day, String home) {
        if (m.at(home) != null) return true;
        for (WidgetData.Stop s : WidgetData.stops(day, home)) if (m.at(s.b) != null) return true;
        return false;
    }

    static Bitmap draw(Context c, RouteMap m, List<WidgetData.Lesson> day, String home, float widthDp, float heightDp, boolean dark) {
        int[] ink = dark ? DARK : LIGHT;
        android.util.DisplayMetrics screen = c.getResources().getDisplayMetrics();
        float dp = Math.min(screen.density, MAX_DENSITY);
        // 위젯 갱신의 그림 한도(화면 넓이 × 4바이트 × 1.5) 안에 두 장이 들게 한 장을 화면 넓이의 0.6 배까지로(WeekBitmap 과 같다)
        float area = Math.max(widthDp, 60) * Math.max(heightDp, 60) * dp * dp, cap = 0.6f * screen.widthPixels * screen.heightPixels;
        if (cap > 0 && area > cap) dp *= (float) Math.sqrt(cap / area);
        int w = Math.max(1, Math.round(Math.max(widthDp, 60) * dp)), h = Math.max(1, Math.round(Math.max(heightDp, 60) * dp));
        Bitmap bmp = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888);
        Canvas canvas = new Canvas(bmp);
        canvas.drawColor(ink[LAND]);

        // 그날 구간과 핀(앱 화면과 같은 차례·번호), 맞춘 배율: RouteMap.plan(화면 코드 없이 시험한다)
        RouteMap.Plan plan = m.plan(day, home, w, h, dp);
        if (plan == null) return bmp; // 그릴 것이 없다(부르는 쪽이 drawable 로 먼저 본다)
        List<Boolean> back = plan.back;
        double[] homeAt = plan.home;
        double metersPerPx = plan.metersPerPx;
        Frame view = new Frame(plan.scale, plan.ox, plan.oy, w, h);

        drawBase(canvas, m, view, ink, dp, metersPerPx);

        // 길(앱 화면과 같은 층, app.js makeMap 의 칸): 점선 테두리(맨 아래) → 돌아가는 길(오른쪽으로 7 비킨 파선) → 그 점선 → 수업 가는 길 → 그 점선 → 핀
        Paint line = new Paint(Paint.ANTI_ALIAS_FLAG);
        line.setStyle(Paint.Style.STROKE);
        line.setStrokeJoin(Paint.Join.ROUND);
        List<float[]> drawn = plan.drawn;
        // 선 끝과 핀을 잇는 점선의 테두리: 점마다 card 1(점보다 2 굵은 같은 간격의 점), 어느 선도 덮지 않게 맨 아래
        for (int i = 0; i < drawn.size(); i++) stubs(canvas, plan.stubs.get(i), back.get(i), ink[CARD], 2 * dp, dp, line);
        // 마지막 수업 뒤 출발·도착 자리로 가는 길: route-home 3 파선(8 6) + 같은 파선 card 테두리 7(app.js drawReturn), 수업 가는 길 아래 층
        DashPathEffect dash = new DashPathEffect(new float[] { 8 * dp, 6 * dp }, 0);
        line.setStrokeCap(Paint.Cap.BUTT);
        line.setPathEffect(dash);
        for (int i = 0; i < drawn.size(); i++) {
            if (!back.get(i)) continue;
            Path p = path(drawn.get(i));
            line.setColor(ink[CARD]);
            line.setStrokeWidth(7 * dp);
            canvas.drawPath(p, line);
            line.setColor(ink[ROUTE_HOME]);
            line.setStrokeWidth(3 * dp);
            canvas.drawPath(p, line);
        }
        line.setPathEffect(null);
        for (int i = 0; i < drawn.size(); i++) if (back.get(i)) stubs(canvas, plan.stubs.get(i), true, ink[ROUTE_HOME], 0, dp, line);
        // 수업 가는 길: route 4 실선 + card 2 테두리
        line.setStrokeCap(Paint.Cap.ROUND);
        for (int pass = 0; pass < 2; pass++) {
            line.setColor(pass == 0 ? ink[CARD] : ink[ROUTE]);
            line.setStrokeWidth((pass == 0 ? 8 : 4) * dp);
            for (int i = 0; i < drawn.size(); i++) if (!back.get(i)) canvas.drawPath(path(drawn.get(i)), line);
        }
        for (int i = 0; i < drawn.size(); i++) if (!back.get(i)) stubs(canvas, plan.stubs.get(i), false, ink[ROUTE], 0, dp, line);

        // 핀: 출발·도착 자리 먼저, 그 위에 수업
        Paint fill = new Paint(Paint.ANTI_ALIAS_FLAG);
        Paint edge = new Paint(Paint.ANTI_ALIAS_FLAG);
        edge.setStyle(Paint.Style.STROKE);
        edge.setStrokeWidth(2 * dp);
        edge.setColor(ink[CARD]);
        float r = 12 * dp;
        if (homeAt != null) {
            float hx = view.x(homeAt[0]), hy = view.y(homeAt[1]);
            fill.setColor(ink[HOME]);
            canvas.drawCircle(hx, hy, r, fill);
            canvas.drawCircle(hx, hy, r - dp, edge);
            // 집: app.js HOME_PIN(24 격자 'M4 11l8-7 8 7v9H4z', 선 3)을 12px 로
            float u = 12 * dp / 24f, left = hx - 6 * dp, top = hy - 6 * dp;
            Path house = new Path();
            house.moveTo(left + 4 * u, top + 11 * u);
            house.lineTo(left + 12 * u, top + 4 * u);
            house.lineTo(left + 20 * u, top + 11 * u);
            house.lineTo(left + 20 * u, top + 20 * u);
            house.lineTo(left + 4 * u, top + 20 * u);
            house.close();
            Paint icon = new Paint(Paint.ANTI_ALIAS_FLAG);
            icon.setStyle(Paint.Style.STROKE);
            icon.setStrokeWidth(3 * u);
            icon.setStrokeJoin(Paint.Join.ROUND);
            icon.setStrokeCap(Paint.Cap.ROUND);
            icon.setColor(ink[ON_HOME]);
            canvas.drawPath(house, icon);
        }
        Paint num = new Paint(Paint.ANTI_ALIAS_FLAG);
        num.setTypeface(Typeface.DEFAULT_BOLD);
        num.setTextSize(12 * dp);
        num.setTextAlign(Paint.Align.CENTER);
        num.setColor(ink[ON_COLOR]);
        Paint.FontMetrics fm = num.getFontMetrics();
        List<float[]> spots = plan.spots;
        for (int g = 0; g < spots.size(); g++) {
            String label = plan.labels.get(g);
            float px = spots.get(g)[0], py = spots.get(g)[1];
            float half = Math.max(r, num.measureText(label) / 2 + 5 * dp); // 글이 길면('2·3') 알약으로
            fill.setColor(ink[ACCENT]);
            canvas.drawRoundRect(px - half, py - r, px + half, py + r, r, r, fill);
            canvas.drawRoundRect(px - half + dp, py - r + dp, px + half - dp, py + r - dp, r - dp, r - dp, edge);
            canvas.drawText(label, px, py - (fm.ascent + fm.descent) / 2, num);
        }
        // 지도 모서리를 둥글게(8, 위젯 바탕 16 의 안쪽): 바깥을 지운다
        float rad = 8 * dp;
        Path corners = new Path();
        corners.setFillType(Path.FillType.EVEN_ODD);
        corners.addRect(0, 0, w, h, Path.Direction.CW);
        corners.addRoundRect(0, 0, w, h, rad, rad, Path.Direction.CW);
        Paint clear = new Paint(Paint.ANTI_ALIAS_FLAG);
        clear.setXfermode(new PorterDuffXfermode(PorterDuff.Mode.CLEAR));
        canvas.drawPath(corners, clear);
        return bmp;
    }

    /** 화소 점들(x0, y0, x1, y1, …)을 잇는 선 */
    private static Path path(float[] pts) {
        Path p = new Path();
        if (pts.length < 2) return p;
        p.moveTo(pts[0], pts[1]);
        for (int i = 2; i + 1 < pts.length; i += 2) p.lineTo(pts[i], pts[i + 1]);
        return p;
    }

    /**
     * 선 끝과 핀을 잇는 점선(app.js drawStubs): 그 선 색의 둥근 점, 수업 가는 길은 굵기 4·간격 7, 돌아가는 길은 3·6. grow 는 테두리를 그릴 때
     * 점에 더하는 굵기(card 1 이면 2), 점 간격은 그대로라 테두리 점이 색 점과 같은 자리에 선다
     */
    private static void stubs(Canvas canvas, List<float[]> list, boolean home, int color, float grow, float dp, Paint paint) {
        if (list.isEmpty()) return;
        paint.setColor(color);
        paint.setStrokeWidth((home ? 3 : 4) * dp + grow);
        paint.setStrokeCap(Paint.Cap.ROUND);
        paint.setPathEffect(new DashPathEffect(new float[] { 0.1f * dp, (home ? 6 : 7) * dp }, 0));
        for (float[] s : list) {
            Path p = new Path();
            p.moveTo(s[0], s[1]);
            p.lineTo(s[2], s[3]);
            canvas.drawPath(p, paint);
        }
        paint.setPathEffect(null);
    }

    /** 세계 좌표 → 그림 화소 */
    private static final class Frame {
        final double scale;
        final double ox;
        final double oy;
        final double wx0;
        final double wy0;
        final double wx1;
        final double wy1;

        Frame(double scale, double ox, double oy, int w, int h) {
            this.scale = scale;
            this.ox = ox;
            this.oy = oy;
            double pad = 12 / scale; // 선 굵기만큼 넉넉히
            this.wx0 = ox / scale - pad;
            this.wy0 = oy / scale - pad;
            this.wx1 = (ox + w) / scale + pad;
            this.wy1 = (oy + h) / scale + pad;
        }

        float x(double wx) {
            return (float) (wx * scale - ox);
        }

        float y(double wy) {
            return (float) (wy * scale - oy);
        }

        boolean sees(RouteMap.Shape f) {
            return f.meets(wx0, wy0, wx1, wy1);
        }

        Path path(double[] pts, boolean close) {
            Path p = new Path();
            add(p, pts, close);
            return p;
        }

        void add(Path p, double[] pts, boolean close) {
            if (pts.length < 2) return;
            p.moveTo(x(pts[0]), y(pts[1]));
            for (int i = 2; i + 1 < pts.length; i += 2) p.lineTo(x(pts[i]), y(pts[i + 1]));
            if (close) p.close();
        }
    }

    /** 바탕(app.js drawBasemap 과 같은 차례와 색). 선 굵기는 m 를 이 배율의 화소로, 가장 가는 값 아래로는 가늘어지지 않는다 */
    private static void drawBase(Canvas canvas, RouteMap m, Frame v, int[] ink, float dp, double metersPerPx) {
        Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
        fill(canvas, v, m.areas.get("green"), ink[GREEN], 0, 0, paint);
        fill(canvas, v, m.areas.get("park"), ink[PARK], 0, 0, paint);
        fill(canvas, v, m.areas.get("grass"), ink[GRASS], 0, 0, paint);
        fill(canvas, v, m.areas.get("campus"), ink[CAMPUS], ink[CAMPUS_LINE], 1.2f * dp, paint);
        fill(canvas, v, m.areas.get("pitch"), ink[PITCH], 0, 0, paint);
        stroke(canvas, v, m.contours, ink[CONTOUR], 1.1f * dp, paint, null);
        fill(canvas, v, m.areas.get("water"), ink[WATER], 0, 0, paint);
        fill(canvas, v, m.areas.get("walk"), ink[WALK], 0, 0, paint);
        fill(canvas, v, m.areas.get("road"), ink[ROAD], ink[ROAD_LINE], 0.9f * dp, paint);
        fill(canvas, v, m.areas.get("road_secondary"), ink[ROAD_SECONDARY], ink[ROAD_SECONDARY + 1], 0.9f * dp, paint);
        fill(canvas, v, m.areas.get("road_primary"), ink[ROAD_PRIMARY], ink[ROAD_PRIMARY + 1], 0.9f * dp, paint);
        fill(canvas, v, m.areas.get("road_trunk"), ink[ROAD_TRUNK], ink[ROAD_TRUNK + 1], 0.9f * dp, paint);
        List<RouteMap.Shape> roads = m.lines.get("road"), peds = m.lines.get("pedestrian");
        // 찻길·보행자 길: 테두리 색 굵은 선 위에 바탕 색 가는 선(app.js 의 px(폭 m, 최소, 더함))
        stroke(canvas, v, roads, ink[ROAD_LINE], 0, paint, f -> width(roadM(f), 2.6f, 2, metersPerPx) * dp);
        stroke(canvas, v, peds, ink[PED_LINE], width(5, 2.6f, 2, metersPerPx) * dp, paint, null);
        stroke(canvas, v, roads, ink[ROAD], 0, paint, f -> width(roadM(f), 1.6f, 0, metersPerPx) * dp);
        stroke(canvas, v, peds, ink[PED], width(5, 1.6f, 0, metersPerPx) * dp, paint, null);
        fill(canvas, v, m.areas.get("building"), ink[BUILDING], ink[BUILDING_LINE], 0.8f * dp, paint);
    }

    private static float roadM(RouteMap.Shape f) {
        Float m = ROAD_M.get(f.kind);
        return m == null ? 5f : m;
    }

    /** 폭 meters 를 CSS 화소로: 가장 가는 값 min, 더하는 값 extra(app.js px) */
    private static float width(float meters, float min, float extra, double metersPerPx) {
        return (float) Math.max(min, meters / metersPerPx) + extra;
    }

    private interface Width {
        float of(RouteMap.Shape f);
    }

    /** 면마다 칠하고(구멍은 even-odd, 면끼리는 따로: 겹친 두 건물이 서로 뚫지 않게) 테두리를 긋는다 */
    private static void fill(Canvas canvas, Frame v, List<RouteMap.Shape> list, int color, int lineColor, float lineWidth, Paint paint) {
        if (list == null) return;
        paint.setStrokeJoin(Paint.Join.ROUND);
        for (RouteMap.Shape f : list) {
            if (!v.sees(f)) continue;
            Path p = new Path();
            p.setFillType(Path.FillType.EVEN_ODD);
            for (double[] ring : f.rings) v.add(p, ring, true);
            paint.setStyle(Paint.Style.FILL);
            paint.setColor(color);
            canvas.drawPath(p, paint);
            if (lineWidth > 0) {
                paint.setStyle(Paint.Style.STROKE);
                paint.setStrokeWidth(lineWidth);
                paint.setColor(lineColor);
                canvas.drawPath(p, paint);
            }
        }
    }

    private static void stroke(Canvas canvas, Frame v, List<RouteMap.Shape> list, int color, float width, Paint paint, Width widthOf) {
        if (list == null) return;
        paint.setStyle(Paint.Style.STROKE);
        paint.setStrokeCap(Paint.Cap.ROUND);
        paint.setStrokeJoin(Paint.Join.ROUND);
        paint.setColor(color);
        for (RouteMap.Shape f : list) {
            if (!v.sees(f)) continue;
            paint.setStrokeWidth(widthOf != null ? widthOf.of(f) : width);
            canvas.drawPath(v.path(f.rings[0], false), paint);
        }
    }
}
