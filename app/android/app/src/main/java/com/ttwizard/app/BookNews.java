package com.ttwizard.app;

import java.util.ArrayList;
import java.util.Calendar;
import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * 편람 알림 — 백엔드 세션(update109, 디자인 '폰 알림' 02 ③④⑤, 법무 11/13). 웹 자료 data/notify.json(scripts/export_web.py export_notify)을 받아
 *   ① 새 학기 수강편람(본 적 없는 학기): 제목 '2027년 1학기 수강편람이 나왔어요'. 누르면 그 학기 내 시간표
 *   ② 담은 과목(대표 시간표)의 시간·강의실 바뀜과 빠진 분반: 하나면 '유전학 강의실이 바뀌었어요' + '83동 201호, 전에는 81동 101호 · 수강편람 11월 20일 09:00 기준'
 *      과 줄을 바꿔 '수업 공지도 확인해 주세요'(누르면 그 항목 시트), 여럿이면 '담은 과목 3개가 바뀌었어요' + 과목 이름들과 기준, 줄 바꿔 같은 줄(누르면 내 시간표)
 *   을 고른다. 처음 볼 때(본 학기 목록이 없음)는 지금 것을 다 본 것으로 두고 알리지 않는다(켜기 전의 바뀜은 알리지 않는다).
 *   바뀜은 마지막으로 본 바뀜 id(날짜 꼴 '2026-11-13_0008')보다 뒤인 것만 본다.
 * 안드로이드 코드 없이 돈다(tests/widget_java 의 NotifyCheck). 받기·알림은 Notifier.
 */
final class BookNews {

    private BookNews() {}

    /** 편람을 받아 보는 때(Notifier 가 한 시간 창으로 건다): 아침 8시·저녁 6시 반 무렵. 밤 10시~아침 8시에는 받아 보지도 알리지도 않는다(디자인 129판 ⑤) */
    static final int[][] SLOTS = { { 8, 0 }, { 18, 30 } };
    static final int QUIET_FROM = 22;
    static final int QUIET_TO = 8;
    /** 편람 알림은 처음부터 켜짐(디자인 129판 ①)이지만 처리방침 11/27 판이 시행되는 날부터(그 전에는 화면에서 켠 때만). 한국 시각 날짜 */
    static final int DEFAULT_ON_FROM = 20261127;

    /** 화면에서 아직 고르지 않았을 때 편람 알림이 켜졌나(seoulNow = 한국 시각) */
    static boolean onByDefault(Calendar seoulNow) {
        return WidgetData.ymd(seoulNow) >= DEFAULT_ON_FROM;
    }

    /** 밤 10시~아침 8시인가(기기 시각) */
    static boolean quiet(long ms) {
        Calendar t = Calendar.getInstance();
        t.setTimeInMillis(ms);
        int h = t.get(Calendar.HOUR_OF_DAY);
        return h >= QUIET_FROM || h < QUIET_TO;
    }

    /** 다음에 notify.json 을 받아 볼 때: 처음 본 적이 없으면 곧(실패하면 30분 뒤), 아니면 다음 8시·18시 반(마지막으로 본 뒤 3시간 넘어) */
    static long nextCheck(long now, long last, boolean seenBefore) {
        if (!seenBefore) return Math.max(now + 60_000L, last + 30 * 60_000L);
        Calendar day = Calendar.getInstance();
        day.setTimeInMillis(now);
        for (int d = 0; d < 3; d++) {
            for (int[] slot : SLOTS) {
                Calendar t = WidgetData.startOfDay(day);
                t.add(Calendar.DAY_OF_MONTH, d);
                t.set(Calendar.HOUR_OF_DAY, slot[0]);
                t.set(Calendar.MINUTE, slot[1]);
                long at = t.getTimeInMillis();
                if (at > now + 60_000L && at >= last + 3 * 60 * 60_000L) return at;
            }
        }
        return now + 12 * 60 * 60_000L;
    }

    /** 지켜볼 과목: 대표 시간표가 있는 학기의 항목(직접 넣은 일정은 편람에 없어 저절로 맞지 않는다) */
    static final class Watch {
        final String sem;
        final String key; // '교과목번호-강좌번호'
        final String name;
        final String tt; // 대표 시간표 id(누르면 여는 주소)

        Watch(String sem, String key, String name, String tt) {
            this.sem = sem;
            this.key = key;
            this.name = name;
            this.tt = tt;
        }
    }

    static final class Note {
        final int id;
        final String title;
        final String text; // 없으면 ""
        final String url;

        Note(int id, String title, String text, String url) {
            this.id = id;
            this.title = title;
            this.text = text;
            this.url = url;
        }
    }

    static final class Result {
        final List<Note> notes;
        final String seen; // 다음에 견줄 마지막 바뀜 id(없으면 "")
        final List<String> terms; // 본 학기들

        Result(List<Note> notes, String seen, List<String> terms) {
            this.notes = notes;
            this.seen = seen;
            this.terms = terms;
        }
    }

    /** 위젯 자료의 학기마다 항목 하나씩(같은 열쇠는 한 번) */
    static List<Watch> watches(WidgetData d) {
        Map<String, Watch> out = new LinkedHashMap<>();
        if (d == null) return new ArrayList<>();
        for (WidgetData.Term t : d.terms) {
            for (List<WidgetData.Lesson> day : t.days) {
                for (WidgetData.Lesson l : day) {
                    if (l.key.isEmpty()) continue;
                    out.putIfAbsent(t.sem + "|" + l.key, new Watch(t.sem, l.key, l.name, t.id));
                }
            }
        }
        return new ArrayList<>(out.values());
    }

    private static final String CHECK = "수업 공지도 확인해 주세요"; // 법무 11/13 ③. 디자인 129판 ③: 글 끝에 줄을 바꿔

    /** 바뀐 것 하나 → 제목 */
    static String titleOf(String name, String what) {
        if ("빠짐".equals(what)) return name + " 분반이 수강편람에서 빠졌어요";
        return name + " " + what + "이 바뀌었어요"; // 시간이·강의실이·시간과 강의실이
    }

    /** 바뀐 것 하나 → 글 */
    static String textOf(String what, String now, String was, String basis) {
        if ("빠짐".equals(what) || now.isEmpty()) return basis + "\n" + CHECK;
        return now + (was.isEmpty() ? "" : ", 전에는 " + was) + " · " + basis + "\n" + CHECK;
    }

    /**
     * json = notify.json 글, watch = 지켜볼 과목, seen·terms = 지난번 Result 의 값(처음이면 terms 가 null).
     * 자료가 깨졌으면 null(본 것은 그대로 둔다)
     */
    static Result check(String json, List<Watch> watch, String seen, Collection<String> terms) {
        JSONObject root;
        try {
            root = new JSONObject(json);
        } catch (JSONException | RuntimeException e) {
            return null;
        }
        if (root.optInt("v", 0) < 1) return null;
        JSONArray rawTerms = root.optJSONArray("terms");
        JSONArray changes = root.optJSONArray("changes");
        boolean first = terms == null;
        List<Note> notes = new ArrayList<>();
        Set<String> known = new LinkedHashSet<>();
        if (terms != null) known.addAll(terms);
        // ① 새 학기(목록은 새 학기가 앞)
        List<String> ids = new ArrayList<>();
        for (int i = 0; rawTerms != null && i < rawTerms.length(); i++) {
            JSONObject t = rawTerms.optJSONObject(i);
            String id = t == null ? "" : t.optString("id", "");
            if (!id.matches("\\d{4}-[12SW]")) continue;
            ids.add(id);
            if (!first && !known.contains(id)) {
                notes.add(new Note(("book:term:" + id).hashCode(), t.optString("name", id) + " 수강편람이 나왔어요", "",
                    WidgetData.openUrl(ClassAlerts.OPEN_URL, id, -1)));
            }
        }
        known.addAll(ids);
        // ② 담은 과목의 바뀜(뒤의 바뀜이 앞의 것을 덮는다)
        String last = seen == null ? "" : seen;
        Map<String, String[]> hits = new LinkedHashMap<>(); // sem|key → {이름, what, now, was, 기준, 바뀜 id, sem, key, tt}
        for (int i = 0; changes != null && i < changes.length(); i++) {
            JSONObject c = changes.optJSONObject(i);
            if (c == null) continue;
            String id = c.optString("id", "");
            if (id.isEmpty()) continue;
            boolean fresh = !first && (seen == null || id.compareTo(seen) > 0);
            if (id.compareTo(last) > 0) last = id;
            JSONObject sections = c.optJSONObject("sections");
            if (!fresh || sections == null) continue;
            String term = c.optString("term", "");
            for (Watch w : watch) {
                JSONObject s = w.sem.equals(term) ? sections.optJSONObject(w.key) : null;
                if (s == null) continue;
                hits.put(w.sem + "|" + w.key, new String[] { w.name, s.optString("what", "강의실"), s.optString("now", ""), s.optString("was", ""),
                    c.optString("basis", "수강편람 기준"), id, w.sem, w.key, w.tt });
            }
        }
        if (hits.size() == 1) {
            String[] h = hits.values().iterator().next();
            notes.add(new Note(("book:" + h[6] + ":" + h[7] + ":" + h[5]).hashCode(), titleOf(h[0], h[1]), textOf(h[1], h[2], h[3], h[4]),
                WidgetData.itemUrl(ClassAlerts.OPEN_URL, h[6], h[8], h[7])));
        } else if (hits.size() > 1) {
            List<String> names = new ArrayList<>();
            String basis = "", sem = "", newest = "";
            for (String[] h : hits.values()) {
                if (!names.contains(h[0])) names.add(h[0]);
                if (h[5].compareTo(newest) >= 0) {
                    newest = h[5];
                    basis = h[4];
                    sem = h[6];
                }
            }
            notes.add(new Note(("book:many:" + newest).hashCode(), "담은 과목 " + hits.size() + "개가 바뀌었어요",
                String.join(" · ", names) + " · " + basis + "\n" + CHECK, WidgetData.openUrl(ClassAlerts.OPEN_URL, sem, -1)));
        }
        return new Result(notes, last, new ArrayList<>(known));
    }
}
