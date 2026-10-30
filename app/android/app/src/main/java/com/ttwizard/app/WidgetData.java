package com.ttwizard.app;

import java.util.ArrayList;
import java.util.Calendar;
import java.util.Collections;
import java.util.List;
import java.util.function.Predicate;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * 홈 화면 위젯이 읽는 자료와 '지금 무엇을 보일지' — 백엔드 세션(10/30).
 * 자료는 app/src/native.js 가 기기 저장소의 대표 시간표로 web/js/timetables.js 의 widgetDataFromStore 를 돌려 TTWWidget.update 로 넘기고
 * WidgetPlugin 이 기기 안(SharedPreferences)에 둔 JSON 이다(update68):
 *   { v, colors: "item"|"cls", home, terms: [{ sem, label, title, from, to, days: [[{ name, place, b, start, end, color, cls, walk, from, late }] × 7], untimed }] }
 * (b = 건물 id, home = 출발·도착 지점 id: 동선 지도 위젯이 길을 그린다. update70 에서 더함, 없으면 "".
 *  back = 그날 마지막 위치 확정 수업에만, 출발·도착 지점으로 돌아가는 분: 동선 지도 위젯의 걷기 합. update71)
 * 위젯은 앱이 꺼져 있어도 이 자료와 기기 시각만으로 그린다. 이 클래스는 안드로이드 화면 코드를 쓰지 않는다(org.json 과 Calendar 만).
 */
final class WidgetData {

    static final int MAX_CHARS = 256 * 1024; // 이보다 긴 자료는 읽지 않는다

    /** 수업 하나(그날 시작 차례) */
    static final class Lesson {
        final String name;
        final String place; // "301동 118호", 강의실 미정이면 ""
        final String cls; // "req" | "elec" | "gen" | "etc"
        final int start;
        final int end; // 자정부터 분
        final int color; // 0~7
        final int walk; // 앞 자리에서 걷는 분, 모르면 -1
        final boolean fromHome; // 그날 첫 위치 확정 수업(출발 지점에서 걷는다)
        final int late; // 앞 수업에서 오면 늦는 분
        final String b; // 건물 id(이동시간 지점 "301"), 강의실 미정이면 ""
        final int back; // 그날 마지막 위치 확정 수업이면 출발·도착 지점으로 돌아가는 분, 아니면(모르면) -1

        Lesson(String name, String place, String cls, int start, int end, int color, int walk, boolean fromHome, int late) {
            this(name, place, cls, start, end, color, walk, fromHome, late, "", -1);
        }

        Lesson(String name, String place, String cls, int start, int end, int color, int walk, boolean fromHome, int late, String b, int back) {
            this.b = b == null ? "" : b;
            this.back = back;
            this.name = name;
            this.place = place;
            this.cls = cls;
            this.start = start;
            this.end = end;
            this.color = color;
            this.walk = walk;
            this.fromHome = fromHome;
            this.late = late;
        }

        /** 출발 지점에서 이 수업에 가려면 나서야 하는 시각(분). 모르면 -1 */
        int leave() {
            return fromHome && walk >= 0 ? start - walk : -1;
        }
    }

    /** 대표 시간표가 있는 학기 하나 */
    static final class Term {
        final String sem;
        final String label; // "2026년 2학기"
        final String title; // 대표 시간표 이름
        final int from;
        final int to; // 위젯이 이 학기를 보이는 날들(yyyymmdd)
        final List<List<Lesson>> days; // 월(0)~일(6)
        final int untimed;

        Term(String sem, String label, String title, int from, int to, List<List<Lesson>> days, int untimed) {
            this.sem = sem;
            this.label = label;
            this.title = title;
            this.from = from;
            this.to = to;
            this.days = days;
            this.untimed = untimed;
        }

        boolean timed() {
            for (List<Lesson> d : days) if (!d.isEmpty()) return true;
            return false;
        }

        /** 그날(달력)의 수업. 학기 기간 밖이면 빈 목록 */
        List<Lesson> on(Calendar date) {
            int day = ymd(date);
            if (day < from || day > to) return Collections.emptyList();
            return days.get(weekday(date));
        }
    }

    final String colors; // "item" | "cls"
    final String home; // 출발·도착 지점 id(모르면 "")
    final List<Term> terms;

    private WidgetData(String colors, String home, List<Term> terms) {
        this.colors = colors;
        this.home = home == null ? "" : home;
        this.terms = terms;
    }

    /** 자료 JSON → WidgetData. 비었거나 깨졌으면 null(위젯은 '앱을 열면 시간표가 보여요') */
    static WidgetData parse(String json) {
        if (json == null || json.isEmpty() || json.length() > MAX_CHARS) return null;
        try {
            JSONObject root = new JSONObject(json);
            if (root.optInt("v", 0) < 1) return null;
            JSONArray rawTerms = root.optJSONArray("terms");
            List<Term> terms = new ArrayList<>();
            for (int i = 0; rawTerms != null && i < rawTerms.length(); i++) {
                Term t = term(rawTerms.optJSONObject(i));
                if (t != null) terms.add(t);
            }
            return new WidgetData("cls".equals(root.optString("colors")) ? "cls" : "item", root.optString("home", ""), terms);
        } catch (JSONException e) {
            return null;
        }
    }

    private static Term term(JSONObject o) {
        if (o == null) return null;
        int from = parseDay(o.optString("from")), to = parseDay(o.optString("to"));
        JSONArray rawDays = o.optJSONArray("days");
        if (from < 0 || to < from || rawDays == null) return null;
        List<List<Lesson>> days = new ArrayList<>();
        for (int d = 0; d < 7; d++) {
            List<Lesson> list = new ArrayList<>();
            JSONArray raw = rawDays.optJSONArray(d);
            for (int i = 0; raw != null && i < raw.length(); i++) {
                JSONObject x = raw.optJSONObject(i);
                if (x == null) continue;
                int start = x.optInt("start", -1), end = x.optInt("end", -1);
                if (start < 0 || end <= start || end > 24 * 60) continue;
                int walk = x.isNull("walk") ? -1 : x.optInt("walk", -1);
                list.add(new Lesson(x.optString("name", ""), x.optString("place", ""), x.optString("cls", "etc"), start, end,
                    Math.floorMod(x.optInt("color", 0), 8), walk, !"class".equals(x.optString("from")), Math.max(0, x.optInt("late", 0)),
                    x.optString("b", ""), x.isNull("back") ? -1 : x.optInt("back", -1)));
            }
            Collections.sort(list, (a, b) -> a.start != b.start ? Integer.compare(a.start, b.start) : Integer.compare(a.end, b.end));
            days.add(list);
        }
        return new Term(o.optString("sem", ""), o.optString("label", ""), o.optString("title", ""), from, to, days, Math.max(0, o.optInt("untimed", 0)));
    }

    /** "2026-09-01" → 20260901, 아니면 -1 */
    static int parseDay(String s) {
        if (s == null || !s.matches("\\d{4}-\\d{2}-\\d{2}")) return -1;
        return Integer.parseInt(s.substring(0, 4)) * 10000 + Integer.parseInt(s.substring(5, 7)) * 100 + Integer.parseInt(s.substring(8, 10));
    }

    static int ymd(Calendar c) {
        return c.get(Calendar.YEAR) * 10000 + (c.get(Calendar.MONTH) + 1) * 100 + c.get(Calendar.DAY_OF_MONTH);
    }

    /** 월 = 0 … 일 = 6 */
    static int weekday(Calendar c) {
        return (c.get(Calendar.DAY_OF_WEEK) + 5) % 7;
    }

    static int minuteOfDay(Calendar c) {
        return c.get(Calendar.HOUR_OF_DAY) * 60 + c.get(Calendar.MINUTE);
    }

    /** 그날 0시 */
    static Calendar startOfDay(Calendar c) {
        Calendar d = (Calendar) c.clone();
        d.set(Calendar.HOUR_OF_DAY, 0);
        d.set(Calendar.MINUTE, 0);
        d.set(Calendar.SECOND, 0);
        d.set(Calendar.MILLISECOND, 0);
        return d;
    }

    /** 오늘 보일 학기: 오늘이 든 학기, 없으면 가장 먼저 시작하는 앞으로의 학기(개강 전). 없으면 null */
    Term termOn(Calendar now) {
        int day = ymd(now);
        Term next = null;
        for (Term t : terms) {
            if (t.from <= day && day <= t.to) return t;
            if (t.from > day && (next == null || t.from < next.from)) next = t;
        }
        return next;
    }

    /** 다음 수업 위젯이 보일 것 */
    static final class Next {
        static final int TODAY = 0; // 오늘 남은 수업(지금 수업 중이면 그다음)
        static final int NOW = 1; // 지금 수업이 오늘 마지막
        static final int LATER = 2; // 오늘은 끝: 다음 수업 날의 첫 수업

        final int kind;
        final Lesson lesson;
        final Lesson current; // 지금 수업 중이면 그 수업(아니면 null)
        final Calendar day; // 그 수업의 날(0시)
        final int daysAhead; // 오늘부터 며칠 뒤

        Next(int kind, Lesson lesson, Lesson current, Calendar day, int daysAhead) {
            this.kind = kind;
            this.lesson = lesson;
            this.current = current;
            this.day = day;
            this.daysAhead = daysAhead;
        }
    }

    /** 지금 시각에 보일 다음 수업. 학기에 수업이 없거나 학기가 끝나 가는 날까지 없으면 null */
    static Next next(Term t, Calendar now) {
        Calendar today = startOfDay(now);
        int min = minuteOfDay(now);
        Lesson current = null;
        for (Lesson l : t.on(today)) {
            if (l.start > min) return new Next(Next.TODAY, l, current, today, 0);
            if (l.end > min) current = l;
        }
        if (current != null) return new Next(Next.NOW, current, current, today, 0);
        Calendar d = (Calendar) today.clone();
        for (int ahead = 1; ahead <= 400; ahead++) {
            d.add(Calendar.DAY_OF_MONTH, 1);
            if (ymd(d) > t.to) return null;
            List<Lesson> list = t.on(d);
            if (!list.isEmpty()) return new Next(Next.LATER, list.get(0), null, (Calendar) d.clone(), ahead);
        }
        return null;
    }

    /** 다음에 위젯을 다시 그릴 때(밀리초): 오늘 남은 수업의 시작·끝, 다음 날 0시 가운데 가장 이른 것 */
    long nextChange(Calendar now) {
        Calendar midnight = startOfDay(now);
        midnight.add(Calendar.DAY_OF_MONTH, 1);
        long at = midnight.getTimeInMillis();
        Term t = termOn(now);
        if (t == null) return at;
        int min = minuteOfDay(now);
        Calendar today = startOfDay(now);
        for (Lesson l : t.on(today)) {
            for (int m : new int[] { l.start, l.end }) {
                if (m > min) {
                    Calendar c = (Calendar) today.clone();
                    c.add(Calendar.MINUTE, m);
                    at = Math.min(at, c.getTimeInMillis());
                }
            }
        }
        return at;
    }

    /**
     * 다음 수업 위젯의 큰 줄과 그 아래 줄(update70, 사용자: 출발·걷기가 "내용의 중심이 되도록 크고 잘 보이게").
     *   LEAVE  그날 첫 수업(출발 지점에서): 큰 줄 '14:44 출발', 아래 '걷기 16분'
     *   WALK   앞 수업에서: 큰 줄 '걷기 8분', 아래 '25동에서'(앞 위치 확정 수업의 건물)와 늦으면 '5분 늦음'
     *   END    지금 수업이 오늘 마지막: 큰 줄 '16:50 끝', 아래 '오늘 마지막 수업'
     *   START  걷는 시간을 모름(강의실 미정, 이동시간 자료 없음): 큰 줄 '15:00 시작'
     */
    static final class Hero {
        static final int LEAVE = 0;
        static final int WALK = 1;
        static final int END = 2;
        static final int START = 3;

        final int kind;
        final int minute; // LEAVE 나설 시각, END 끝 시각, START 시작 시각(자정부터 분). WALK 는 -1
        final int walk; // 걷는 분(모르면 -1)
        final String from; // WALK 의 앞 건물 '25동'(모르면 "")
        final int late;

        Hero(int kind, int minute, int walk, String from, int late) {
            this.kind = kind;
            this.minute = minute;
            this.walk = walk;
            this.from = from;
            this.late = late;
        }
    }

    static Hero hero(Term t, Next n) {
        Lesson l = n.lesson;
        if (n.kind == Next.NOW) return new Hero(Hero.END, l.end, -1, "", 0);
        if (l.walk < 0) return new Hero(Hero.START, l.start, -1, "", 0);
        if (l.fromHome) return new Hero(Hero.LEAVE, Math.max(0, l.leave()), l.walk, "", 0);
        Lesson prev = placedBefore(t.on(n.day), l);
        return new Hero(Hero.WALK, -1, l.walk, prev == null ? "" : buildingPart(prev.place), l.late);
    }

    /** 그날 l 앞의 강의실이 정해진 수업 가운데 마지막(걷기의 출발 자리). 없으면 null */
    static Lesson placedBefore(List<Lesson> day, Lesson l) {
        Lesson prev = null;
        for (Lesson x : day) {
            if (x == l) break;
            if (!x.b.isEmpty() || !x.place.isEmpty()) prev = x;
        }
        return prev;
    }

    /** '301동 118호' → '301동'(강의실 표기의 첫 덩이) */
    static String buildingPart(String place) {
        String s = place == null ? "" : place.trim();
        int i = s.indexOf(' ');
        return i < 0 ? s : s.substring(0, i);
    }

    /**
     * 위젯을 누르면 여는 주소: 웹 앱 주소 + '#tab=mine', 학기가 있으면 '&sem=2026-2', 요일이 있으면 '&route=4'(월 0 … 일 6).
     * 화면(app.js)이 route 를 읽으면 그 학기 대표 시간표의 그 요일 동선 지도를 연다(update70 에서 프론트엔드에 요청). 읽기 전에는 내 시간표가 열린다
     */
    static String openUrl(String base, String sem, int day) {
        StringBuilder url = new StringBuilder(base);
        if (sem != null && sem.matches("\\d{4}-[12SW]")) url.append("&sem=").append(sem);
        if (day >= 0 && day < 7) url.append("&route=").append(day);
        return url.toString();
    }

    // ------------------------------------------------------------ 동선 지도 위젯(update71)

    /** 걷는 구간 하나: from → to(건물 id). num = 도착하는 수업의 그날 차례(1…, 앱 동선 지도의 핀 번호와 같다), 돌아가는 길은 0 */
    static final class Leg {
        final String from;
        final String to;
        final int num;

        Leg(String from, String to, int num) {
            this.from = from;
            this.to = to;
            this.num = num;
        }
    }

    /**
     * 그날 걷는 구간(engine.evaluate·앱 동선 지도와 같은 차례): 출발 지점 → 첫 위치 확정 수업 → … → 마지막 위치 확정 수업 → 출발 지점.
     * 강의실 미정 수업은 자리를 옮기지 않지만 번호는 센다. 같은 건물 안에서는 걷지 않으니 빼고, 출발 지점을 모르면 그 두 구간을 뺀다
     */
    static List<Leg> legs(List<Lesson> day, String home) {
        List<Leg> out = new ArrayList<>();
        String at = home == null ? "" : home;
        for (int i = 0; i < day.size(); i++) {
            Lesson l = day.get(i);
            if (l.b.isEmpty()) continue;
            if (!at.isEmpty() && !at.equals(l.b)) out.add(new Leg(at, l.b, i + 1));
            at = l.b;
        }
        if (home != null && !home.isEmpty() && !at.isEmpty() && !at.equals(home)) out.add(new Leg(at, home, 0));
        return out;
    }

    /** 핀 하나: 건물과 그 건물의 수업 번호들(같은 건물의 수업은 '2·3' 처럼 한 핀. 앱 동선 지도와 같다). 출발 지점과 같은 건물이면 빼고 집 핀만 */
    static final class Stop {
        final String b;
        final List<Integer> nums = new ArrayList<>();

        Stop(String b) {
            this.b = b;
        }

        String label() {
            StringBuilder s = new StringBuilder();
            for (int n : nums) s.append(s.length() == 0 ? "" : "·").append(n);
            return s.toString();
        }
    }

    static List<Stop> stops(List<Lesson> day, String home) {
        List<Stop> out = new ArrayList<>();
        for (int i = 0; i < day.size(); i++) {
            Lesson l = day.get(i);
            if (l.b.isEmpty() || l.b.equals(home)) continue;
            Stop s = null;
            for (Stop x : out) if (x.b.equals(l.b)) s = x;
            if (s == null) out.add(s = new Stop(l.b));
            s.nums.add(i + 1);
        }
        return out;
    }

    /** 그날 걷는 분 합(가는 길 + 돌아가는 길, 앱 결과의 하루 걷기와 같다). 하나라도 모르면 -1 */
    static int dayWalk(List<Lesson> day) {
        int sum = 0;
        boolean any = false;
        for (Lesson l : day) {
            if (l.b.isEmpty()) continue;
            if (l.walk < 0) return -1;
            sum += l.walk;
            any = true;
            if (l.back >= 0) sum += l.back;
        }
        return any ? sum : -1;
    }

    // ------------------------------------------------------------ 그리기에 쓰는 셈(화면 코드 없이 시험한다)

    /**
     * 보일 행 [첫, 끝): 아직 안 끝난 수업부터 fit 개(넘치면 마지막 자리는 '외 n개'에 내준다), 남는 자리는 앞의 끝난 수업으로 채운다.
     * 다 끝났으면 마지막 fit 개(흐리게).
     */
    static int[] rowsToShow(List<Lesson> lessons, int min, int fit) {
        int n = lessons.size();
        int first = 0;
        while (first < n && lessons.get(first).end <= min) first++;
        if (first == n) return new int[] { Math.max(0, n - fit), n };
        int rest = n - first;
        if (rest > fit) return new int[] { first, first + Math.max(1, fit - 1) };
        return new int[] { Math.max(0, n - fit), n };
    }

    /** 보일 요일 수: 월~금, 토·일은 수업이 있을 때만 */
    static int dayCount(Term t) {
        if (!t.days.get(6).isEmpty()) return 7;
        if (!t.days.get(5).isEmpty()) return 6;
        return 5;
    }

    /** 보일 시각 [시작 시, 끝 시): 수업이 있는 시간만, 적어도 네 시간 */
    static int[] hours(Term t, int days) {
        int lo = 24 * 60, hi = 0;
        for (int d = 0; d < days; d++) {
            for (Lesson l : t.days.get(d)) {
                lo = Math.min(lo, l.start);
                hi = Math.max(hi, l.end);
            }
        }
        if (hi <= lo) return new int[] { 9, 18 };
        int h0 = lo / 60, h1 = (hi + 59) / 60;
        while (h1 - h0 < 4) {
            if (h1 < 24) h1++;
            else h0--;
        }
        return new int[] { h0, h1 };
    }

    /** 겹치는 수업은 나란히: lane[i] = 몇째 줄, lanes[i] = 그 무리의 줄 수 */
    static void laneOf(List<Lesson> list, int[] lane, int[] lanes) {
        int n = list.size(), i = 0;
        while (i < n) {
            int j = i, end = list.get(i).end;
            List<Integer> ends = new ArrayList<>();
            while (j < n && (j == i || list.get(j).start < end)) { // 시작 차례라 겹치는 무리는 이어진다
                Lesson l = list.get(j);
                int k = 0;
                while (k < ends.size() && ends.get(k) > l.start) k++;
                if (k == ends.size()) ends.add(l.end);
                else ends.set(k, l.end);
                lane[j] = k;
                end = Math.max(end, l.end);
                j++;
            }
            for (int x = i; x < j; x++) lanes[x] = ends.size();
            i = j;
        }
    }

    /** 09:05 */
    static String hm(int minutes) {
        return String.format(java.util.Locale.ROOT, "%02d:%02d", minutes / 60, minutes % 60);
    }

    /** 과목명 끝의 짧은 번호(숫자 한두 자리, II 같은 로마 숫자, 영문 한 글자). web/js/app.js 의 TAIL_NO 와 같다 */
    private static final Pattern TAIL_NO = Pattern.compile("^(.*\\S) (\\d{1,2}|[IVX]{1,4}|[\\u2160-\\u216B]|[A-Za-z])$");

    /**
     * 끝 번호를 앞 낱말에 붙인 글(디자인 89판 '홈 화면 위젯', 앱 화면의 glueTail 과 같다): `대학 글쓰기 1` 이 `대학 글쓰기` / `1` 로 끊기지 않게
     * 앞 낱말과 번호 사이를 줄을 바꾸지 않는 띄어쓰기(U+00A0)로 바꾼다. 둘이 한 줄에 안 들어가면(fits 가 false) 그대로 둔다:
     * 붙이면 둘이 다음 줄로 넘어간 뒤 거기서도 넘쳐 낱말 안에서 끊긴다. fits(앞 낱말 + " " + 번호) → 한 줄 폭에 드는지
     */
    static String glueTail(String text, Predicate<String> fits) {
        String s = text == null ? "" : text;
        Matcher m = TAIL_NO.matcher(s);
        if (!m.matches()) return s;
        String[] words = m.group(1).split("\\s+");
        return fits.test(words[words.length - 1] + " " + m.group(2)) ? m.group(1) + " " + m.group(2) : s;
    }
}
