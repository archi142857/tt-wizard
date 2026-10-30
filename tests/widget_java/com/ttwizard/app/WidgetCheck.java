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
 *   java -cp <out> com.ttwizard.app.WidgetCheck <자료.json>
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
