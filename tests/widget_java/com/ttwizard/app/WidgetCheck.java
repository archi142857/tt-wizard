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

    private static String hero(WidgetData.Hero h) {
        String[] kinds = { "leave", "walk", "end", "start" };
        return "{\"kind\":" + q(kinds[h.kind]) + ",\"at\":" + (h.minute < 0 ? "null" : q(WidgetData.hm(h.minute))) + ",\"walk\":" + h.walk
            + ",\"from\":" + q(h.from) + ",\"late\":" + h.late + "}";
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
