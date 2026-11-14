package com.ttwizard.app;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Calendar;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.TimeZone;

/**
 * tests/test_notify.py 가 부른다: 화면이 만든 위젯 자료로 폰 알림(update109)의 수업 알림(ClassAlerts)과 편람 알림(BookNews)을 정한 시각마다 셈해 JSON 으로 찍는다.
 *   java -cp <out> com.ttwizard.app.NotifyCheck <위젯 자료.json>
 */
public final class NotifyCheck {

    private static final TimeZone SEOUL = TimeZone.getTimeZone("Asia/Seoul");

    private static Calendar at(int y, int m, int d, int hh, int mm) {
        Calendar c = Calendar.getInstance(SEOUL);
        c.clear();
        c.set(y, m - 1, d, hh, mm, 0);
        return c;
    }

    private static String q(String s) {
        if (s == null) return "null";
        StringBuilder out = new StringBuilder("\"");
        for (char ch : s.toCharArray()) {
            if (ch == '"' || ch == '\\') out.append('\\').append(ch);
            else if (ch < 0x20) out.append(String.format("\\u%04x", (int) ch));
            else out.append(ch);
        }
        return out.append('"').toString();
    }

    private static String when(long ms) {
        Calendar c = Calendar.getInstance(SEOUL);
        c.setTimeInMillis(ms);
        return String.format("%04d-%02d-%02d %02d:%02d", c.get(Calendar.YEAR), c.get(Calendar.MONTH) + 1, c.get(Calendar.DAY_OF_MONTH),
            c.get(Calendar.HOUR_OF_DAY), c.get(Calendar.MINUTE));
    }

    private static String alerts(List<ClassAlerts.Alert> list) {
        List<String> out = new ArrayList<>();
        for (ClassAlerts.Alert a : list) {
            out.add("{\"at\":" + q(when(a.at)) + ",\"depart\":" + q(when(a.depart)) + ",\"title\":" + q(a.title) + ",\"text\":" + q(a.text)
                + ",\"url\":" + q(a.url) + "}");
        }
        return "[" + String.join(",", out) + "]";
    }

    private static String notes(BookNews.Result r) {
        if (r == null) return "null";
        List<String> out = new ArrayList<>();
        for (BookNews.Note n : r.notes) out.add("{\"title\":" + q(n.title) + ",\"text\":" + q(n.text) + ",\"url\":" + q(n.url) + "}");
        List<String> terms = new ArrayList<>();
        for (String t : r.terms) terms.add(q(t));
        return "{\"notes\":[" + String.join(",", out) + "],\"seen\":" + q(r.seen) + ",\"terms\":[" + String.join(",", terms) + "]}";
    }

    public static void main(String[] args) throws Exception {
        TimeZone.setDefault(SEOUL);
        WidgetData d = WidgetData.parse(new String(Files.readAllBytes(Paths.get(args[0])), StandardCharsets.UTF_8));
        Map<String, ClassAlerts.Period> none = new HashMap<>();
        Map<String, ClassAlerts.Period> cal = new HashMap<>();
        cal.put("2026-2", new ClassAlerts.Period(20260901, 20261215, new HashSet<>(Arrays.asList(20261026))));
        Calendar mon8 = at(2026, 10, 26, 8, 0);
        StringBuilder o = new StringBuilder("{");
        o.append("\"leads\":").append(Arrays.toString(ClassAlerts.LEADS)).append(",\"lead7\":").append(ClassAlerts.lead(7));
        o.append(",\"monMorning\":").append(alerts(ClassAlerts.next(d, none, 10, mon8, mon8.getTimeInMillis())));
        o.append(",\"afterFirst\":").append(alerts(ClassAlerts.next(d, none, 10, at(2026, 10, 26, 9, 9), at(2026, 10, 26, 9, 8).getTimeInMillis())));
        o.append(",\"dueLate\":").append(alerts(ClassAlerts.due(d, none, 10, at(2026, 10, 26, 10, 36), at(2026, 10, 26, 9, 9).getTimeInMillis())));
        o.append(",\"dueStale\":").append(alerts(ClassAlerts.due(d, none, 10, at(2026, 10, 26, 10, 55), at(2026, 10, 26, 9, 9).getTimeInMillis())));
        o.append(",\"holiday\":").append(alerts(ClassAlerts.next(d, cal, 10, mon8, mon8.getTimeInMillis())));
        Calendar after = at(2026, 12, 16, 8, 0);
        o.append(",\"termOver\":").append(alerts(ClassAlerts.next(d, cal, 10, after, after.getTimeInMillis())));
        o.append(",\"leadZero\":").append(alerts(ClassAlerts.next(d, none, 0, mon8, mon8.getTimeInMillis())));
        Calendar tue = at(2027, 3, 2, 8, 0);
        o.append(",\"noRoom\":").append(alerts(ClassAlerts.next(d, none, 15, tue, tue.getTimeInMillis())));
        // 편람 알림
        List<BookNews.Watch> w = BookNews.watches(d);
        List<String> ws = new ArrayList<>();
        for (BookNews.Watch x : w) ws.add(q(x.sem + "|" + x.key + "|" + x.name));
        o.append(",\"watch\":[").append(String.join(",", ws)).append("]");
        String writing = "", stats = ""; // 항목 열쇠는 위젯 자료를 만들 때마다 달라서 이름으로 찾는다
        for (BookNews.Watch x : w) {
            if (x.name.equals("대학 글쓰기 1")) writing = x.key;
            if (x.name.equals("통계학")) stats = x.key;
        }
        String base = "{\"v\":1,\"terms\":[{\"id\":\"2027-1\",\"name\":\"2027년 1학기\"},{\"id\":\"2026-2\",\"name\":\"2026년 2학기\"}],"
            + "\"changes\":[{\"id\":\"2026-11-13_0008\",\"term\":\"2026-2\",\"basis\":\"수강편람 11월 13일 00:08 기준\",\"sections\":{\"" + writing + "\":{\"what\":\"시간\",\"now\":\"월 10:00–11:15\",\"was\":\"월 11:00–12:15\"}}}]}";
        BookNews.Result first = BookNews.check(base, w, null, null);
        o.append(",\"first\":").append(notes(first));
        String one = "{\"v\":1,\"terms\":[{\"id\":\"2027-S\",\"name\":\"2027년 여름학기\"},{\"id\":\"2027-1\",\"name\":\"2027년 1학기\"},{\"id\":\"2026-2\",\"name\":\"2026년 2학기\"}],"
            + "\"changes\":[{\"id\":\"2026-11-13_0008\",\"term\":\"2026-2\",\"basis\":\"수강편람 11월 13일 00:08 기준\",\"sections\":{\"" + writing + "\":{\"what\":\"시간\",\"now\":\"월 10:00–11:15\",\"was\":\"월 11:00–12:15\"}}},"
            + "{\"id\":\"2026-11-20_0900\",\"term\":\"2026-2\",\"basis\":\"수강편람 11월 20일 09:00 기준\",\"sections\":{\"" + writing + "\":{\"what\":\"강의실\",\"now\":\"C동 101호\",\"was\":\"B동 303호\"},\"남의-001\":{\"what\":\"빠짐\"}}}]}";
        o.append(",\"one\":").append(notes(BookNews.check(one, w, first.seen, first.terms)));
        String many = "{\"v\":1,\"terms\":[{\"id\":\"2027-1\",\"name\":\"2027년 1학기\"},{\"id\":\"2026-2\",\"name\":\"2026년 2학기\"}],"
            + "\"changes\":[{\"id\":\"2026-11-21_1000\",\"term\":\"2026-2\",\"basis\":\"수강편람 11월 21일 10:00 기준\",\"sections\":{\"" + writing + "\":{\"what\":\"시간과 강의실\",\"now\":\"화 10:00–11:15 C동 101호\",\"was\":\"월 11:00–12:15 B동 303호\"}}},"
            + "{\"id\":\"2026-11-22_1000\",\"term\":\"2026-2\",\"basis\":\"수강편람 11월 22일 10:00 기준\",\"sections\":{\"" + stats + "\":{\"what\":\"빠짐\"}}}]}";
        o.append(",\"many\":").append(notes(BookNews.check(many, w, "2026-11-20_0900", first.terms)));
        String gone = "{\"v\":1,\"terms\":[],\"changes\":[{\"id\":\"2026-11-23_1000\",\"term\":\"2026-2\",\"basis\":\"수강편람 11월 23일 10:00 기준\",\"sections\":{\"" + stats + "\":{\"what\":\"빠짐\"}}}]}";
        o.append(",\"gone\":").append(notes(BookNews.check(gone, w, "2026-11-22_1000", first.terms)));
        o.append(",\"bad\":").append(notes(BookNews.check("{not json", w, "x", first.terms)));
        o.append("}");
        System.out.write(o.toString().getBytes(StandardCharsets.UTF_8));
        System.out.flush();
    }
}
