package com.ttwizard.app;

import java.util.ArrayList;
import java.util.Calendar;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * 수업 알림 — 백엔드 세션(update109, 디자인 '폰 알림' 02 ①②, 법무 11/13). 대표 시간표(위젯 자료 WidgetData)의 수업마다 출발 시각 lead 분 전에 알린다.
 *   출발 시각은 다음 수업 위젯과 같은 셈이다: 그날 첫 위치 확정 수업은 출발·도착 지점에서 걷는 분만큼 앞(시작 − 걷기),
 *   앞 수업에서 오면 시작 − 걷기 + 지각(쉬는 시간보다 오래 걸으면 앞 수업이 끝날 때가 출발), 걷는 시간을 모르면(강의실 미정·자료 없음) 시작 시각.
 *   같은 건물이라 걷지 않는 수업(걷기 0분)은 알리지 않는다.
 *   날: 학기 기간(앱 연결이 학사 일정 data/calendar.json 에서 넘긴 개강·종강, 없으면 위젯 자료의 어림 기간) 안이고 수업 없는 날(공휴일 등)이 아닌 날.
 *   글(정보만): 제목 '10:18 출발 · 유전학', 글 '10:30 83동 201호 · 25동에서 걷기 12분', 지각이면 '10:30 301동 105호 · 걷기 18분 · 3분 지각',
 *   걷는 시간을 모르면 제목 '10:30 시작 · 유전학'과 글 강의실. 누르면 위젯처럼 그 시간표의 그 항목 시트(WidgetData.itemUrl).
 * 안드로이드 코드 없이 돈다(tests/widget_java 의 NotifyCheck). 알람·알림은 Notifier.
 */
final class ClassAlerts {

    /** 알림 시각(디자인 '폰 알림' 01 ③): 출발할 때 · 출발 5분 · 10분(처음) · 15분 · 30분 전 */
    static final int[] LEADS = { 0, 5, 10, 15, 30 };
    static final int DEFAULT_LEAD = 10;
    /** 알람이 늦게 와도 출발 시각 뒤 이만큼(분)까지는 알린다(부정확 알람이라 몇 분 늦을 수 있다) */
    static final int GRACE_MIN = 5;
    /** 다음 알림을 찾는 날 수(방학이면 없다) */
    static final int HORIZON_DAYS = 21;
    /** 알림을 누르면 여는 주소의 앞(WidgetViews.OPEN_URL 과 같다) */
    static final String OPEN_URL = "https://archi142857.github.io/tt-wizard/#tab=mine";

    private ClassAlerts() {}

    /** 학사 일정의 학기 기간과 수업 없는 날. 날은 20261003 꼴 */
    static final class Period {
        final int start;
        final int end;
        final Set<Integer> skip;

        Period(int start, int end, Set<Integer> skip) {
            this.start = start;
            this.end = end;
            this.skip = skip == null ? Collections.emptySet() : skip;
        }
    }

    static final class Alert {
        final long at; // 알릴 때(ms)
        final long depart; // 출발 시각(ms). 걷는 시간을 모르면 시작 시각
        final int id; // 알림 번호: 같은 날·같은 수업이면 같다(다시 알려도 하나로)
        final String title;
        final String text;
        final String url;

        Alert(long at, long depart, int id, String title, String text, String url) {
            this.at = at;
            this.depart = depart;
            this.id = id;
            this.title = title;
            this.text = text;
            this.url = url;
        }
    }

    /** 고른 값이 고를 수 있는 것이 아니면 처음 값 */
    static int lead(int minutes) {
        for (int l : LEADS) if (l == minutes) return l;
        return DEFAULT_LEAD;
    }

    /** '09:05' */
    static String hm(int minute) {
        return String.format(java.util.Locale.ROOT, "%02d:%02d", minute / 60, minute % 60);
    }

    /** 출발 시각(자정부터 분). 걷는 시간을 모르면 -1 */
    static int departOf(WidgetData.Lesson l) {
        if (l.walk < 0) return -1;
        return Math.max(0, l.start - l.walk + (l.fromHome ? 0 : l.late));
    }

    /** 알림 글: 시작 시각과 강의실, 걷기(앞 건물), 지각 */
    static String textOf(List<WidgetData.Lesson> day, WidgetData.Lesson l) {
        if (l.walk < 0) return l.place;
        String head = hm(l.start) + (l.place.isEmpty() ? "" : " " + l.place);
        if (l.fromHome) return head + " · 걷기 " + l.walk + "분";
        if (l.late > 0) return head + " · 걷기 " + l.walk + "분 · " + l.late + "분 지각";
        WidgetData.Lesson prev = WidgetData.placedBefore(day, l);
        String from = prev == null ? "" : WidgetData.buildingPart(prev.place);
        return head + " · " + (from.isEmpty() ? "" : from + "에서 ") + "걷기 " + l.walk + "분";
    }

    /** 그날(달력 날) 알릴 것들. periods = 학기(sem)마다 학사 일정(없는 학기는 위젯 자료의 기간) */
    static List<Alert> onDay(WidgetData d, Map<String, Period> periods, int lead, Calendar date) {
        List<Alert> out = new ArrayList<>();
        if (d == null) return out;
        int ymd = WidgetData.ymd(date);
        long midnight = WidgetData.startOfDay(date).getTimeInMillis();
        for (WidgetData.Term t : d.terms) {
            Period p = periods == null ? null : periods.get(t.sem);
            int from = p != null ? p.start : t.from;
            int to = p != null ? p.end : t.to;
            if (ymd < from || ymd > to || (p != null && p.skip.contains(ymd))) continue;
            List<WidgetData.Lesson> day = t.days.get(WidgetData.weekday(date));
            for (WidgetData.Lesson l : day) {
                if (l.walk == 0) continue; // 같은 건물: 나설 일이 없다
                int depart = departOf(l);
                int minute = depart >= 0 ? depart : l.start;
                String title = hm(minute) + (depart >= 0 ? " 출발 · " : " 시작 · ") + l.name;
                int id = ("class:" + t.sem + ":" + ymd + ":" + l.start + ":" + l.key + ":" + l.name).hashCode();
                out.add(new Alert(midnight + (minute - lead) * 60_000L, midnight + minute * 60_000L, id, title, textOf(day, l),
                    WidgetData.itemUrl(OPEN_URL, t.sem, t.id, l.key)));
            }
        }
        Collections.sort(out, (a, b) -> Long.compare(a.at, b.at));
        return out;
    }

    /**
     * after(ms) 뒤의 첫 알림(같은 때면 여럿). 출발 + GRACE_MIN 이 now 보다 앞인 것은 뺀다. HORIZON_DAYS 안에 없으면 빈 목록.
     * Notifier 가 이 때(at)에 알람을 건다
     */
    static List<Alert> next(WidgetData d, Map<String, Period> periods, int lead, Calendar now, long after) {
        long nowMs = now.getTimeInMillis();
        Calendar date = WidgetData.startOfDay(now);
        for (int i = 0; i <= HORIZON_DAYS; i++) {
            List<Alert> best = new ArrayList<>();
            for (Alert a : onDay(d, periods, lead, date)) {
                if (a.at <= after || a.depart + GRACE_MIN * 60_000L < nowMs) continue;
                if (best.isEmpty() || a.at < best.get(0).at) {
                    best.clear();
                    best.add(a);
                } else if (a.at == best.get(0).at) {
                    best.add(a);
                }
            }
            if (!best.isEmpty()) return best;
            date.add(Calendar.DAY_OF_MONTH, 1);
        }
        return Collections.emptyList();
    }

    /** 알람이 왔을 때 알릴 것: after 뒤 ~ now + 1분 사이의 알림 가운데 출발 + GRACE_MIN 이 지나지 않은 것(어제 밤 늦게 온 알람도 본다) */
    static List<Alert> due(WidgetData d, Map<String, Period> periods, int lead, Calendar now, long after) {
        long nowMs = now.getTimeInMillis();
        List<Alert> out = new ArrayList<>();
        Calendar date = WidgetData.startOfDay(now);
        date.add(Calendar.DAY_OF_MONTH, -1);
        for (int i = 0; i < 2; i++) {
            for (Alert a : onDay(d, periods, lead, date)) {
                if (a.at > after && a.at <= nowMs + 60_000L && a.depart + GRACE_MIN * 60_000L >= nowMs) out.add(a);
            }
            date.add(Calendar.DAY_OF_MONTH, 1);
        }
        return out;
    }
}
