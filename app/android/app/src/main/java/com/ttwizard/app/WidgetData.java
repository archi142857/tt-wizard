package com.ttwizard.app;

import java.util.ArrayList;
import java.util.Calendar;
import java.util.Collections;
import java.util.List;
import java.util.function.DoubleUnaryOperator;
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
 *   { v, colors: "item"|"cls", home, scheme, themeOff, terms: [{ sem, id, label, title, from, to, days: [[{ name, k, place, b, start, end, color, cls, walk, from, late }] × 7], untimed }] }
 * (b = 건물 id, home = 출발·도착 지점 id: 동선 지도 위젯이 길을 그린다. update70 에서 더함, 없으면 "".
 *  back = 그날 마지막 위치 확정 수업에만, 출발·도착 지점으로 돌아가는 분: 동선 지도 위젯의 걷기 합. update71.
 *  id = 대표 시간표 id, k = 항목 열쇠: 수업을 누르면 앱이 그 항목 시트를 연다(itemUrl). update77, 옛 자료면 "".
 *  scheme = 테마 탭에서 고른 "light"|"dark"(그 밖은 기본 = 기기 설정), themeOff = 그 해에 끈 이벤트 테마 "xmas-2026": 위젯이 앱 테마로 그린다(theme). update78)
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
        final String key; // 항목 열쇠(timetables.js itemKey: '교과목번호-강좌번호', 직접 넣은 일정은 그 id). 모르면 ""

        Lesson(String name, String place, String cls, int start, int end, int color, int walk, boolean fromHome, int late) {
            this(name, place, cls, start, end, color, walk, fromHome, late, "", -1, "");
        }

        Lesson(String name, String place, String cls, int start, int end, int color, int walk, boolean fromHome, int late, String b, int back) {
            this(name, place, cls, start, end, color, walk, fromHome, late, b, back, "");
        }

        Lesson(String name, String place, String cls, int start, int end, int color, int walk, boolean fromHome, int late, String b, int back,
               String key) {
            this.key = key == null ? "" : key;
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
        final String id; // 대표 시간표 id(모르면 "")
        final String label; // "2026년 2학기"
        final String title; // 대표 시간표 이름
        final int from;
        final int to; // 위젯이 이 학기를 보이는 날들(yyyymmdd)
        final List<List<Lesson>> days; // 월(0)~일(6)
        final int untimed;

        Term(String sem, String label, String title, int from, int to, List<List<Lesson>> days, int untimed) {
            this(sem, "", label, title, from, to, days, untimed);
        }

        Term(String sem, String id, String label, String title, int from, int to, List<List<Lesson>> days, int untimed) {
            this.sem = sem;
            this.id = id == null ? "" : id;
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
    final String scheme; // 앱 테마 탭에서 고른 것: "system"(기본 = 기기 설정) | "light" | "dark"
    final String themeOff; // 그 해에 끈 이벤트 테마('xmas-2026', 앱 seasonTheme 의 event). 없으면 ""
    final List<Term> terms;

    private WidgetData(String colors, String home, String scheme, String themeOff, List<Term> terms) {
        this.colors = colors;
        this.home = home == null ? "" : home;
        this.scheme = "light".equals(scheme) || "dark".equals(scheme) ? scheme : "system";
        this.themeOff = themeOff == null ? "" : themeOff;
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
            return new WidgetData("cls".equals(root.optString("colors")) ? "cls" : "item", root.optString("home", ""), root.optString("scheme", ""),
                root.optString("themeOff", ""), terms);
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
                    x.optString("b", ""), x.isNull("back") ? -1 : x.optInt("back", -1), x.optString("k", "")));
            }
            Collections.sort(list, (a, b) -> a.start != b.start ? Integer.compare(a.start, b.start) : Integer.compare(a.end, b.end));
            days.add(list);
        }
        return new Term(o.optString("sem", ""), o.optString("id", ""), o.optString("label", ""), o.optString("title", ""), from, to, days,
            Math.max(0, o.optInt("untimed", 0)));
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

    // ------------------------------------------------------------ 위젯 테마(update78, 11/2 사용자: 위젯도 "색깔이 테마에 맞춰서 바뀌게". 디자인 106판 '테마')

    /** 위젯이 그리는 한 벌: 기기 설정을 따르는 라이트·다크(layout·layout-night), 고른 라이트, 고른 다크, 크리스마스 */
    static final int DEVICE = 0;
    static final int LIGHT = 1;
    static final int DARK = 2;
    static final int XMAS = 3;

    /**
     * 이벤트 테마 {이름, 시작 MM-DD, 끝 MM-DD(그날까지, 기기 날짜)}: web/js/app.js 의 THEMES·index.html 머리의 스크립트와 같은 기간이다(tests/test_widgets.py 가 견준다).
     * 앱처럼 켜져 있으면 고른 라이트·다크보다 앞선다(기기가 다크여도 한 벌). 테마를 더하면 그 한 벌의 자원도 더한다(scripts/widget_themes.py)
     */
    static final String[][] THEMES = { { "xmas", "12-01", "12-31" } };

    /**
     * 지금 그릴 한 벌(앱 화면과 같은 판단): 기간 안의 이벤트 테마(그 해에 끄지 않았으면) → 고른 라이트·다크 → 기본(기기 설정).
     * 기간은 그릴 때의 날짜로 정한다: 다음 날 0시에 다시 그리므로(nextChange) 앱을 열지 않아도 12월 1일 0시에 바뀐다
     */
    int theme(Calendar now) {
        String md = String.format(java.util.Locale.ROOT, "%02d-%02d", now.get(Calendar.MONTH) + 1, now.get(Calendar.DAY_OF_MONTH));
        for (String[] t : THEMES) {
            if (md.compareTo(t[1]) >= 0 && md.compareTo(t[2]) <= 0 && !themeOff.equals(t[0] + "-" + now.get(Calendar.YEAR))) return XMAS;
        }
        if ("light".equals(scheme)) return LIGHT;
        if ("dark".equals(scheme)) return DARK;
        return DEVICE;
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
     *   WALK   앞 수업에서: 큰 줄 '걷기 8분', 아래 '25동에서'(앞 위치 확정 수업의 건물)와 늦으면 '5분 지각'(update77. 전에는 '5분 늦음')
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

    /** 열쇠·id 로 쓸 수 있는 글(화면 navOf 와 같은 꼴: 영문·숫자·'.'·'_'·'-' 64자까지) */
    static boolean safeKey(String s) {
        return s != null && s.matches("[A-Za-z0-9._-]{1,64}");
    }

    /**
     * 수업을 누르면 여는 주소(update77, 사용자 11/2: "위젯은 강의를 눌렀을 때 그 강의 정보가 뜨도록, 시간표에 저장해놓은 강의 정보가 뜨도록"):
     * '…#tab=mine&sem=2026-2&tt=<대표 시간표 id>&item=<항목 열쇠>' → 화면이 그 시간표를 내 시간표에 띄우고 그 항목 시트(저장한 분반·바꾼 시간·장소)를 연다.
     * 열쇠를 모르면(옛 자료) 내 시간표(openUrl 과 같다)
     */
    static String itemUrl(String base, String sem, String id, String key) {
        String url = openUrl(base, sem, -1);
        if (!safeKey(key)) return url;
        return url + (safeKey(id) ? "&tt=" + id : "") + "&item=" + key;
    }

    // ------------------------------------------------------------ 다음 수업 위젯의 줄(update77: 출발 시각 블록)

    /**
     * 높이 h(dp)·기기 글자 크기 f 에 들어가는 줄: {과목명 두 줄, 강의실, 블록 안 아래 줄, 시각, 작은 블록}. 머리 줄·과목명 한 줄·블록은 늘 둔다.
     * 위아래 여백 24 + 머리와 과목명 사이 0 + 블록 위 띄움 8 + 블록 안 여백 16 에, 글자 크기를 따르는 줄(머리 16, 과목명 23씩, 시각·강의실 19씩,
     * 큰 시각 38, 아래 줄 19 + 사이 2)을 더한 높이. 빼는 차례는 전과 같다: 과목명 둘째 줄 → 강의실 → 블록 안 아래 줄 → 시각.
     * 그래도 모자라면(옛 런처 2×2 의 110dp) 블록을 줄인다(시각 26, 안 여백 5): 위아래 여백이 좌우와 같은 12 로 남게(사용자 11/2: "밑 부분 패딩도 좌우랑 동일하게")
     */
    static boolean[] nextRows(int h, float f) {
        return nextRows(h, f, 0);
    }

    /**
     * 머리 띠(update78, 디자인 106판)를 단 다음: 띠 28(16·f + 12)이 그전 위 여백 12 + 머리 줄 16 자리라 기준은 그대로다.
     * 띠는 위아래 여백을 줄여서라도 16·f + 12 로 두므로(update79, 디자인 108판: bandPad) extra 는 보통 0 이다. 여백이 3 까지 줄어도 띠 글이 더 높아
     * 띠가 그보다 높아지면(아주 큰 글꼴) 그 차이(dp)만큼 기준을 올린다
     */
    static boolean[] nextRows(int h, float f, float extra) {
        float base = 48 + (16 + 23 + 38) * f + Math.max(0, extra); // 블록 위 띄움 8 + 블록 안 여백 16 + 위아래 여백 24
        boolean time = h >= base + 19 * f + 1;
        boolean sub = h >= base + 2 + 38 * f + 1;
        boolean place = h >= base + 2 + 57 * f + 1;
        boolean twoLines = h >= base + 2 + 80 * f + 1;
        boolean compact = h < base + 1;
        return new boolean[] { twoLines, place, sub, time, compact };
    }

    /**
     * 머리 띠의 위아래 여백(dp, update79 디자인 108판): 띠는 16·f + 12(글자 크기 1 에서 28)로 둔다. 띠 글 한 줄(line, 기기 글꼴로 잰 dp)이 16·f 보다 높으면
     * (안드로이드 13 이상의 한글은 대체 글꼴 줄 높이라 19 안팎) 여백을 (띠 − 줄)/2 로 줄인다(글자 위아래로 보이는 틈은 그대로 8~9). 3 아래로는 줄이지 않는다
     */
    static float bandPad(float line, float f) {
        return Math.max(3, (16 * f + 12 - line) / 2);
    }

    /** 큰 줄 낱말('출발'·'걷기'·'분')의 크기 비율: 수의 반, 12sp 아래로는 내리지 않는다(update79 디자인 108판: 수가 24 아래면 낱말은 12) */
    static float wordScale(float sp) {
        return Math.max(0.5f, 12f / sp);
    }

    /**
     * 블록 큰 줄의 글자 크기(sp, update78 디자인 106판: 말줄임하지 않는다. '10:1…' 처럼 잘린 시각은 틀린 시각으로 읽힌다).
     * widthAt(sp) = 그 크기의 큰 줄 폭(낱말은 wordScale), room = 블록 안 폭(같은 단위). 32(작은 블록이면 26)가 들면 그것, 아니면 26,
     * 그래도 넘치면 0.5씩 줄여 드는 크기(적어도 12). maxSp = 높이로 정한 한도(update79 디자인 108판: 작은 블록은 블록 아래가 좌우와 같은 12 로 남는 데까지.
     * 0.5 단위로 내림, 한도가 없으면 무한): 폭으로 맞춘 크기와 둘 중 작은 쪽
     */
    static float heroSize(DoubleUnaryOperator widthAt, float room, boolean compact, float maxSp) {
        float cap = Float.isInfinite(maxSp) ? Float.MAX_VALUE : (float) Math.floor(maxSp * 2) / 2;
        for (float s : new float[] { compact ? 26 : 32, 26 }) {
            if (s <= cap && widthAt.applyAsDouble(s) <= room) return s;
        }
        for (float s = Math.min(25.5f, cap); s > 12; s -= 0.5f) {
            if (widthAt.applyAsDouble(s) <= room) return s;
        }
        return 12;
    }

    /**
     * 블록 아래 줄에서 보일 것 {아래 글, 지각}(update78): 둘이 폭 room 에 들면 둘 다, 넘치면 아래 글('25동에서')을 빼고 '5분 지각'만,
     * 그것도 넘치면(지각이 없으면 아래 글이 넘치면) 줄째 뺀다. sub·late = 잰 폭(없으면 0), gap = 둘 사이
     */
    static boolean[] heroLine(float sub, float late, float gap, float room) {
        if (sub > 0 && late > 0 && sub + gap + late <= room) return new boolean[] { true, true };
        if (late > 0) return new boolean[] { false, late <= room };
        return new boolean[] { sub > 0 && sub <= room, false };
    }

    /**
     * 오늘 수업 행의 아래 줄 '강의실 · 10:18 출발 · 걷기 12분'(update78, 디자인 106판: 수가 든 덩이가 말줄임으로 잘리지 않게).
     * 한 줄 폭에 안 들면(fits 가 false) '걷기 n분' → '10:18 출발' 차례로 덩이째 뺀다. 강의실은 남기고 그래도 넘치면 끝이 줄어든다(TextView).
     * 강의실이 없는데 '10:18 출발'도 안 들면 "": 줄이 없다
     */
    static String rowSub(String place, String leave, String walk, Predicate<String> fits) {
        List<String> parts = new ArrayList<>();
        for (String x : new String[] { place, leave, walk }) if (x != null && !x.isEmpty()) parts.add(x);
        boolean hasPlace = place != null && !place.isEmpty();
        while (true) {
            String text = String.join(" · ", parts);
            if (parts.isEmpty() || fits.test(text)) return text;
            if (parts.size() == 1) return hasPlace ? text : "";
            parts.remove(parts.size() - 1);
        }
    }

    /** 큰 줄 글에서 크게 쓸 수(시각 '10:18' 이나 걷는 분 '8')의 [처음, 끝). 없으면 null: 글 전체를 크게 */
    static int[] bigPart(String text, String number) {
        if (text == null || number == null || number.isEmpty()) return null;
        int i = text.indexOf(number);
        return i < 0 ? null : new int[] { i, i + number.length() };
    }

    // ------------------------------------------------------------ 주간 시간표 격자의 자리(그림과 누르는 칸이 같은 셈을 쓴다, update77)

    /** 주간 격자의 칸 자리. unit = 1dp 가 몇 단위인지(그림은 화소, 누르는 칸은 dp 라 1), font = 격자 글자 배율(weekFont) */
    static final class WeekGrid {
        final int days;
        final int[] hours;
        final float head;
        final float gutter;
        final float colW;
        final float hourH;
        final float gap;

        WeekGrid(Term t, float width, float height, float unit, float font) {
            days = dayCount(t);
            hours = hours(t, days);
            head = 16 * unit * font;
            gutter = 16 * unit * font;
            colW = (width - gutter) / days;
            hourH = (height - head) / (hours[1] - hours[0]);
            gap = 1.5f * unit;
        }

        /** 그 요일(day) 수업 하나의 칸 {왼쪽, 위, 오른쪽, 아래}. lane·lanes 는 laneOf 의 값(겹치면 나란히) */
        float[] box(int day, Lesson l, int lane, int lanes) {
            float x0 = gutter + day * colW, laneW = colW / lanes;
            return new float[] { x0 + lane * laneW + gap, head + (l.start / 60f - hours[0]) * hourH + gap / 2,
                x0 + (lane + 1) * laneW - gap, head + (l.end / 60f - hours[0]) * hourH - gap / 2 };
        }
    }

    /** 격자 글자 배율: 기기 글자 크기를 따르되 칸이 작아 0.85~1.3 배 */
    static float weekFont(float fontScale) {
        return Math.min(Math.max(fontScale, 0.85f), 1.3f);
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
