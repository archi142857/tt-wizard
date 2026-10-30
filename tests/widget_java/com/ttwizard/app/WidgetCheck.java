package com.ttwizard.app;

import java.io.PrintStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Calendar;
import java.util.List;
import java.util.TimeZone;

/**
 * tests/test_widgets.py 가 부른다: 화면이 만든 위젯 자료(node 로 web/js/timetables.js 의 widgetData 를 돌린 JSON)를 앱의 WidgetData 로 읽고
 * 정한 시각마다 무엇을 보일지 JSON 으로 찍는다. 안드로이드 화면 코드 없이(org.json 은 tests/widget_java 의 작은 것) 돈다.
 *   java -cp <out> com.ttwizard.app.WidgetCheck <자료.json> [basemap.json campus.json routes.json]
 * 뒤 셋을 주면 동선 지도 위젯의 자료 읽기(RouteMap)와 그날 지도의 짜임(plan)을 실제 자료로 본다(update71).
 */
public final class WidgetCheck {

    private static final TimeZone SEOUL = TimeZone.getTimeZone("Asia/Seoul");

    private static Calendar at(int y, int m, int d, int hh, int mm) {
        Calendar c = Calendar.getInstance(SEOUL);
        c.clear();
        c.set(y, m - 1, d, hh, mm, 0);
        return c;
    }

    private static String q(String s) {
        StringBuilder out = new StringBuilder("\"");
        for (char ch : s.toCharArray()) {
            if (ch == '"' || ch == '\\') out.append('\\').append(ch);
            else if (ch < 0x20) out.append(String.format("\\u%04x", (int) ch));
            else out.append(ch);
        }
        return out.append('"').toString();
    }

    private static String next(WidgetData d, Calendar now) {
        WidgetData.Term t = d.termOn(now);
        if (t == null) return "null";
        WidgetData.Next n = WidgetData.next(t, now);
        if (n == null) return "{\"sem\":" + q(t.sem) + ",\"next\":null}";
        String[] kinds = { "today", "now", "later" };
        WidgetData.Lesson l = n.lesson;
        return "{\"sem\":" + q(t.sem) + ",\"kind\":" + q(kinds[n.kind]) + ",\"name\":" + q(l.name) + ",\"start\":" + q(WidgetData.hm(l.start))
            + ",\"day\":" + WidgetData.ymd(n.day) + ",\"ahead\":" + n.daysAhead + ",\"current\":" + (n.current == null ? "null" : q(n.current.name))
            + ",\"leave\":" + (l.leave() < 0 ? "null" : q(WidgetData.hm(l.leave()))) + ",\"walk\":" + l.walk + ",\"late\":" + l.late + "}";
    }

    private static String change(WidgetData d, Calendar now) {
        Calendar c = Calendar.getInstance(SEOUL);
        c.setTimeInMillis(d.nextChange(now));
        return q(String.format("%d-%02d-%02d %02d:%02d", c.get(Calendar.YEAR), c.get(Calendar.MONTH) + 1, c.get(Calendar.DAY_OF_MONTH),
            c.get(Calendar.HOUR_OF_DAY), c.get(Calendar.MINUTE)));
    }

    private static String hero(WidgetData.Hero h) {
        String[] kinds = { "leave", "walk", "end", "start" };
        return "{\"kind\":" + q(kinds[h.kind]) + ",\"at\":" + (h.minute < 0 ? "null" : q(WidgetData.hm(h.minute))) + ",\"walk\":" + h.walk
            + ",\"from\":" + q(h.from) + ",\"late\":" + h.late + "}";
    }

    private static WidgetData.Lesson placed(String b, int walk) {
        return new WidgetData.Lesson("x", b.isEmpty() ? "" : b + "동", "etc", 540, 600, 0, walk, true, 0, b, b.equals("Y") ? 9 : -1);
    }

    private static String legs(List<WidgetData.Leg> list) {
        StringBuilder s = new StringBuilder("[");
        for (WidgetData.Leg l : list) s.append(s.length() == 1 ? "" : ",").append(q(l.from + ">" + l.to + ":" + l.num));
        return s.append("]").toString();
    }

    private static String stops(List<WidgetData.Stop> list) {
        StringBuilder s = new StringBuilder("[");
        for (WidgetData.Stop x : list) s.append(s.length() == 1 ? "" : ",").append(q(x.b + ":" + x.label()));
        return s.append("]").toString();
    }

    /** 실제 자료(앱에 넣는 data/*.json)로 읽기와 그날 지도의 짜임: 정문 → 첫·가운데·끝 건물(번호 1·2·3) → 정문, 4×2 위젯 그림(800×330 화소, dp 2.5) */
    private static String real(String basemap, String campus, String routes) throws Exception {
        RouteMap m = RouteMap.parse(read(basemap), read(campus), read(routes));
        String[] ids = new String(Files.readAllBytes(Paths.get(campus)), StandardCharsets.UTF_8).replaceAll("(?s).*?\"ids\":\\[(.*?)\\].*", "$1").replace("\"", "").split(",");
        List<String> rooms = new ArrayList<>();
        for (String id : ids) if (!id.equals("GATE")) rooms.add(id); // 출발 지점(정문)이 아닌 지점
        String home = "GATE";
        String[] picks = { rooms.get(1), rooms.get(rooms.size() / 2), rooms.get(rooms.size() - 1) };
        List<WidgetData.Lesson> day = new ArrayList<>();
        for (int i = 0; i < 3; i++) day.add(new WidgetData.Lesson("x" + i, picks[i] + "동", "etc", 540 + i * 90, 615 + i * 90, 0, 5, i == 0, 0, picks[i], i == 2 ? 5 : -1));
        RouteMap.Plan p = m.plan(day, home, 800, 330, 2.5f);
        StringBuilder spots = new StringBuilder("[");
        for (float[] xy : p.spots) spots.append(spots.length() == 1 ? "" : ",").append("[").append(xy[0]).append(",").append(xy[1]).append("]");
        double[] path = m.path(picks[0], picks[1]);
        // 그린 선과 점선(update73): 구간마다 그린 선의 첫 변(원래 화소)·그린 첫 점, 점선 {선 끝 x, y, 핀 x, y}
        StringBuilder drawn = new StringBuilder("["), stubs = new StringBuilder("[");
        for (int i = 0; i < p.drawn.size(); i++) {
            double[] w = p.lines.get(i);
            float[] d = p.drawn.get(i);
            drawn.append(i == 0 ? "" : ",").append("[").append(p.x(w[0])).append(",").append(p.y(w[1])).append(",").append(p.x(w[2])).append(",")
                .append(p.y(w[3])).append(",").append(d[0]).append(",").append(d[1]).append(",").append(d[d.length - 2]).append(",").append(d[d.length - 1])
                .append(",").append(d.length / 2).append("]");
            stubs.append(i == 0 ? "" : ",").append("[");
            for (int k = 0; k < p.stubs.get(i).size(); k++) {
                float[] st = p.stubs.get(i).get(k);
                stubs.append(k == 0 ? "" : ",").append("[").append(st[0]).append(",").append(st[1]).append(",").append(st[2]).append(",").append(st[3]).append("]");
            }
            stubs.append("]");
        }
        return "{\"buildings\":" + m.areas.get("building").size() + ",\"roads\":" + m.lines.get("road").size() + ",\"contours\":" + m.contours.size()
            + ",\"where\":" + m.where.size() + ",\"picks\":" + q(String.join("|", picks)) + ",\"lines\":" + p.lines.size() + ",\"back\":" + p.back
            + ",\"labels\":" + q(String.join("|", p.labels)) + ",\"spots\":" + spots + "]" + ",\"home\":[" + p.x(p.home[0]) + "," + p.y(p.home[1]) + "]"
            + ",\"zoom\":" + Math.log(p.scale / 640.0) / Math.log(2) + ",\"mpp\":" + p.metersPerPx
            + ",\"path\":[" + path.length / 2 + "," + RouteMap.lat(path[1]) + "," + (path[0] * 360 - 180) + "," + RouteMap.lat(path[path.length - 1]) + ","
            + (path[path.length - 2] * 360 - 180) + "],\"drawn\":" + drawn + "],\"stubs\":" + stubs + "]}";
    }

    private static String floats(float[] a) {
        StringBuilder s = new StringBuilder("[");
        for (int i = 0; i < a.length; i++) s.append(i == 0 ? "" : ",").append(Math.round(a[i] * 1000) / 1000.0);
        return s.append("]").toString();
    }

    private static String read(String path) throws Exception {
        return new String(Files.readAllBytes(Paths.get(path)), StandardCharsets.UTF_8);
    }

    private static WidgetData.Lesson lesson(int start, int end) {
        return new WidgetData.Lesson("x", "", "etc", start, end, 0, -1, true, 0);
    }

    public static void main(String[] args) throws Exception {
        String json = new String(Files.readAllBytes(Paths.get(args[0])), StandardCharsets.UTF_8);
        WidgetData d = WidgetData.parse(json);
        StringBuilder out = new StringBuilder("{");
        WidgetData.Term a = d.terms.get(0);
        out.append("\"terms\":").append(d.terms.size()).append(",\"colors\":").append(q(d.colors));
        out.append(",\"first\":{\"sem\":").append(q(a.sem)).append(",\"label\":").append(q(a.label)).append(",\"title\":").append(q(a.title))
            .append(",\"from\":").append(a.from).append(",\"to\":").append(a.to).append(",\"untimed\":").append(a.untimed)
            .append(",\"monday\":").append(a.days.get(0).size()).append(",\"place\":").append(q(a.days.get(0).get(0).place)).append("}");
        // 정한 시각마다 다음 수업(2026-10-26 은 월요일)
        String[][] cases = {
            { "monMorning", "2026-10-26 08:00" }, { "monFirst", "2026-10-26 10:00" }, { "monLast", "2026-10-26 11:30" },
            { "monAfter", "2026-10-26 13:00" }, { "friEvening", "2026-10-30 18:00" }, { "sunday", "2026-11-01 12:00" },
            { "winter", "2026-12-25 12:00" }, { "summer", "2026-08-20 12:00" }, { "lastDay", "2026-12-21 18:00" },
        };
        out.append(",\"next\":{");
        for (int i = 0; i < cases.length; i++) {
            String[] p = cases[i][1].split("[- :]");
            Calendar now = at(Integer.parseInt(p[0]), Integer.parseInt(p[1]), Integer.parseInt(p[2]), Integer.parseInt(p[3]), Integer.parseInt(p[4]));
            out.append(i == 0 ? "" : ",").append(q(cases[i][0])).append(":").append(next(d, now));
        }
        out.append("},\"change\":[").append(change(d, at(2026, 10, 26, 8, 0))).append(",").append(change(d, at(2026, 10, 26, 10, 0)))
            .append(",").append(change(d, at(2026, 10, 26, 12, 30))).append(",").append(change(d, at(2026, 12, 25, 9, 0))).append("]");
        // 오늘 수업 행 고르기: 수업 다섯(9~10, 10~11, ...), 들어가는 행 3
        List<WidgetData.Lesson> five = new ArrayList<>();
        for (int h = 9; h < 14; h++) five.add(lesson(h * 60, h * 60 + 50));
        int[][] rows = { WidgetData.rowsToShow(five, 8 * 60, 3), WidgetData.rowsToShow(five, 10 * 60 + 55, 3), WidgetData.rowsToShow(five, 12 * 60 + 10, 3),
            WidgetData.rowsToShow(five, 15 * 60, 3), WidgetData.rowsToShow(five, 8 * 60, 1), WidgetData.rowsToShow(five.subList(0, 2), 9 * 60 + 55, 3) };
        out.append(",\"rows\":[");
        for (int i = 0; i < rows.length; i++) out.append(i == 0 ? "" : ",").append(Arrays.toString(rows[i]).replace(" ", ""));
        out.append("]");
        // 주간 격자: 보일 요일·시각, 겹치는 수업의 줄
        out.append(",\"grid\":{\"days\":").append(WidgetData.dayCount(a)).append(",\"hours\":").append(Arrays.toString(WidgetData.hours(a, 5)).replace(" ", ""));
        List<WidgetData.Lesson> clash = Arrays.asList(lesson(540, 615), lesson(570, 660), lesson(600, 640), lesson(700, 750));
        int[] lane = new int[4], lanes = new int[4];
        WidgetData.laneOf(clash, lane, lanes);
        out.append(",\"lane\":").append(Arrays.toString(lane).replace(" ", "")).append(",\"lanes\":").append(Arrays.toString(lanes).replace(" ", "")).append("}");
        // 다음 수업 위젯의 큰 줄(update70): 그날 첫 수업은 나설 시각, 앞 수업에서는 걷는 분과 앞 건물·늦음, 마지막 수업 중이면 끝 시각, 걷기를 모르면 시작 시각
        String[][] heroAt = { { "monMorning", "2026-10-26 08:00" }, { "monFirst", "2026-10-26 10:00" }, { "monLast", "2026-10-26 11:30" },
            { "winter", "2026-12-25 12:00" } };
        out.append(",\"hero\":{");
        for (int i = 0; i < heroAt.length; i++) {
            String[] p = heroAt[i][1].split("[- :]");
            Calendar now = at(Integer.parseInt(p[0]), Integer.parseInt(p[1]), Integer.parseInt(p[2]), Integer.parseInt(p[3]), Integer.parseInt(p[4]));
            WidgetData.Term t = d.termOn(now);
            out.append(i == 0 ? "" : ",").append(q(heroAt[i][0])).append(":").append(hero(WidgetData.hero(t, WidgetData.next(t, now))));
        }
        List<List<WidgetData.Lesson>> week = new ArrayList<>();
        for (int k = 0; k < 7; k++) week.add(new ArrayList<>());
        week.get(0).add(new WidgetData.Lesson("x", "", "etc", 600, 650, 0, -1, true, 0)); // 강의실 미정: 걷기를 모른다
        WidgetData.Term unknown = new WidgetData.Term("2026-2", "", "", 20260901, 20261221, week, 0);
        Calendar mon = at(2026, 10, 26, 8, 0);
        out.append(",\"unknown\":").append(hero(WidgetData.hero(unknown, WidgetData.next(unknown, mon)))).append("}");
        out.append(",\"buildings\":").append(q(d.home + "|" + a.days.get(0).get(0).b + "|" + a.days.get(0).get(1).b));
        // 누르면 여는 주소: 학기와 요일(월 0 … 일 6). 모르는 꼴은 붙이지 않는다
        String base = "https://x/#tab=mine";
        out.append(",\"url\":[").append(q(WidgetData.openUrl(base, "2026-2", 4))).append(",").append(q(WidgetData.openUrl(base, null, -1)))
            .append(",").append(q(WidgetData.openUrl(base, "2026-X", 7))).append(",").append(q(WidgetData.openUrl(base, "2027-W", 0))).append("]");
        // 과목명 끝 번호 붙이기(앱 화면의 glueTail 과 같다): 앞 낱말과 번호가 한 줄(여기서는 글자 수)에 들면 U+00A0, 아니면 그대로
        Object[][] glue = { { "대학 글쓰기 1", 9 }, { "대학 글쓰기 1", 4 }, { "화학", 9 }, { "수학 100", 9 }, { "English II", 20 },
            { "Data Science A", 20 }, { "수학 및 연습 \u2161", 20 }, { "1", 9 }, { "물리학실험 2", 9 } };
        List<String> asked = new ArrayList<>();
        out.append(",\"glue\":[");
        for (int i = 0; i < glue.length; i++) {
            int limit = (Integer) glue[i][1];
            String got = WidgetData.glueTail((String) glue[i][0], s -> { asked.add(s); return s.length() <= limit; });
            out.append(i == 0 ? "" : ",").append(q(got.replace("\u00A0", "~")));
        }
        out.append("],\"asked\":").append(q(asked.isEmpty() ? "" : asked.get(0)));
        // 동선 지도 위젯(update71): 그날 걷는 구간·핀·걷기 합
        List<WidgetData.Lesson> monday = a.days.get(0);
        out.append(",\"legs\":").append(legs(WidgetData.legs(monday, d.home))).append(",\"stops\":").append(stops(WidgetData.stops(monday, d.home)))
            .append(",\"dayWalk\":").append(WidgetData.dayWalk(monday));
        List<WidgetData.Lesson> mixed = Arrays.asList(placed("X", 5), placed("", -1), placed("X", 0), placed("Y", 7));
        out.append(",\"mixedLegs\":[").append(legs(WidgetData.legs(mixed, "H"))).append(",").append(legs(WidgetData.legs(mixed, "")))
            .append(",").append(legs(WidgetData.legs(mixed, "X"))).append("],\"mixedStops\":[").append(stops(WidgetData.stops(mixed, "H")))
            .append(",").append(stops(WidgetData.stops(mixed, "X"))).append("],\"mixedWalk\":").append(WidgetData.dayWalk(mixed));
        // 자료 읽기: 작은 바탕·건물·길. 한쪽 방향 길은 거꾸로, 없는 길은 곧게, 자리도 모르면 null
        RouteMap tiny = RouteMap.parse("{\"area\":{\"building\":[[5,\"_p~iF~ps|U_ulL~ugC\"]]},\"line\":{\"road\":[[\"service\",\"_p~iF~ps|U\"]]},"
            + "\"contour\":{\"index\":[[50,\"_p~iF~ps|U\"]]}}", "{\"buildings\":{\"A\":[\"a\",38.5,-120.2],\"B\":[\"b\",40.7,-120.95],\"C\":[\"c\",null,null]}}",
            "{\"paths\":{\"A|B\":\"_p~iF~ps|U_ulLnnqC_mqNvxq`@\"}}");
        double[] ab = tiny.path("A", "B"), ba = tiny.path("B", "A"), ac = tiny.path("A", "C"), bq = tiny.path("B", "Q");
        out.append(",\"tiny\":{\"areas\":").append(tiny.areas.get("building").size()).append(",\"lines\":").append(tiny.lines.get("road").size())
            .append(",\"contours\":").append(tiny.contours.size()).append(",\"where\":").append(tiny.where.size())
            .append(",\"ab\":").append(ab.length / 2).append(",\"abFirst\":[").append(RouteMap.lat(ab[1])).append(",").append(ab[0] * 360 - 180).append("]")
            .append(",\"baFirst\":[").append(RouteMap.lat(ba[1])).append(",").append(ba[0] * 360 - 180).append("]")
            .append(",\"straight\":").append(bq == null ? "null" : String.valueOf(bq.length)).append(",\"noC\":").append(ac == null ? "null" : "1");
        double[] fit = RouteMap.fit(new double[] { 0.1, 0.1, 0.2, 0.3 }, 200, 100, new double[] { 10, 10, 10, 20 }, 1e9);
        double[] capped = RouteMap.fit(new double[] { 0.5, 0.5, 0.5, 0.5 }, 200, 100, new double[] { 10, 10, 10, 20 }, 1000);
        out.append(",\"fit\":[").append(fit[0]).append(",").append(0.15 * fit[0] - fit[1]).append(",").append(0.2 * fit[0] - fit[2]).append("]")
            .append(",\"capped\":[").append(capped[0]).append(",").append(0.5 * capped[0] - capped[1]).append(",").append(0.5 * capped[0] - capped[2]).append("]}");
        out.append(",\"offset\":[").append(floats(RouteMap.offset(new float[] { 0, 0, 10, 0, 10, 10 }, 7, 0.5f))).append(",")
            .append(floats(RouteMap.offset(new float[] { 0, 0, 10, 0, 0, 0 }, 7, 0.5f))).append(",")
            .append(floats(RouteMap.offset(new float[] { 0, 0, 0.2f, 0, 10, 0 }, 7, 0.5f))).append(",")
            .append(floats(RouteMap.offset(new float[] { 5, 5 }, 7, 0.5f))).append("]");
        if (args.length >= 4) out.append(",\"real\":").append(real(args[1], args[2], args[3]));
        // 깨진 자료는 읽지 않는다
        String[] bad = { "", "{}", "[]", "{\"v\":0,\"terms\":[]}", "{\"v\":1,\"terms\":[", "{\"v\":1,\"terms\":[{\"from\":\"2026-9-1\",\"to\":\"2026-12-21\",\"days\":[]}]}" };
        out.append(",\"bad\":[");
        for (int i = 0; i < bad.length; i++) {
            WidgetData x = WidgetData.parse(bad[i]);
            out.append(i == 0 ? "" : ",").append(x == null ? "null" : String.valueOf(x.terms.size()));
        }
        out.append("]}");
        new PrintStream(System.out, true, "UTF-8").println(out); // 윈도의 기본 글자판과 상관없이 UTF-8
    }
}
