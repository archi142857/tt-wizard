package com.ttwizard.app;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.content.Context;
import android.content.Intent;
import android.content.res.Configuration;
import android.graphics.Bitmap;
import android.net.Uri;
import android.os.Bundle;
import android.view.View;
import android.widget.RemoteViews;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.List;

/**
 * 홈 화면 위젯의 화면(RemoteViews) — 백엔드 세션(10/30). 무엇을 보일지는 WidgetData, 언제 다시 그릴지는 WidgetUpdater.
 *   다음 수업(2×2)   다음 수업(지금 수업 중이면 그다음)의 이름·시각·강의실과 나설 시각(그날 첫 수업: 출발 지점에서)이나 앞 수업에서 걷는 분·늦음.
 *                    오늘이 끝났으면 다음 수업 날의 첫 수업(내일·요일·날짜), 개강 전이면 '개강 · 9월 1일 (화)'.
 *   오늘 수업(4×2~)  오늘 수업 행(높이만큼. 끝난 수업은 흐리게, 지금 수업에 '지금'). 넘치면 '외 n개'. 수업이 없는 날은 다음 수업 한 줄.
 *   주간 시간표(4×4) 대표 시간표 한 주 그림(WeekBitmap, 라이트·다크 두 장).
 * 누르면 앱의 내 시간표(MainActivity 에 OPEN_URL 을 넘긴다: native.js 의 launchUrl·'ttw:open-url' 로 화면에 간다).
 * 글자색은 XML(values(-night)/colors.xml)이 정해서 기기 테마가 바뀌면 런처가 다시 펼칠 때 맞는다. 코드는 색을 숫자로 넣지 않는다.
 */
final class WidgetViews {

    /** 위젯을 누르면 여는 주소(화면이 '#tab=mine' 을 보고 내 시간표로 간다. sem 은 위젯이 보인 학기) */
    static final String OPEN_URL = "https://archi142857.github.io/tt-wizard/#tab=mine";

    private static final int[] ITEM_MARKS = {
        R.drawable.widget_mark_item0, R.drawable.widget_mark_item1, R.drawable.widget_mark_item2, R.drawable.widget_mark_item3,
        R.drawable.widget_mark_item4, R.drawable.widget_mark_item5, R.drawable.widget_mark_item6, R.drawable.widget_mark_item7,
    };

    private WidgetViews() {}

    static RemoteViews build(Context c, int kind, WidgetData d, Calendar now, Bundle options) {
        if (kind == WidgetUpdater.NEXT) return next(c, d, now);
        if (kind == WidgetUpdater.TODAY) return today(c, d, now, options);
        return week(c, d, now, options);
    }

    // ------------------------------------------------------------ 다음 수업

    static RemoteViews next(Context c, WidgetData d, Calendar now) {
        RemoteViews v = new RemoteViews(c.getPackageName(), R.layout.widget_next);
        WidgetData.Term t = d == null ? null : d.termOn(now);
        v.setOnClickPendingIntent(android.R.id.background, open(c, t));
        String problem = problem(c, d, t);
        WidgetData.Next n = problem == null ? WidgetData.next(t, now) : null;
        if (n == null) {
            v.setTextViewText(R.id.w_caption, t != null ? t.label : c.getString(R.string.widget_next_name));
            for (int id : new int[] { R.id.w_name, R.id.w_time, R.id.w_place, R.id.w_foot }) v.setViewVisibility(id, View.GONE);
            v.setViewVisibility(R.id.w_msg, View.VISIBLE);
            v.setTextViewText(R.id.w_msg, problem != null ? problem : c.getString(R.string.w_term_over)); // 학기의 남은 날에 수업이 없다
            return v;
        }
        WidgetData.Lesson l = n.lesson;
        v.setTextViewText(R.id.w_caption, caption(c, t, n, now));
        v.setViewVisibility(R.id.w_mark, View.VISIBLE);
        v.setInt(R.id.w_mark, "setBackgroundResource", mark(d, l));
        v.setTextViewText(R.id.w_name, l.name);
        v.setTextViewText(R.id.w_time, WidgetData.hm(l.start) + "~" + WidgetData.hm(l.end));
        if (l.place.isEmpty()) v.setViewVisibility(R.id.w_place, View.GONE);
        else v.setTextViewText(R.id.w_place, l.place);
        String foot = n.kind == WidgetData.Next.NOW ? c.getString(R.string.w_last) : walk(c, l);
        if (foot.isEmpty()) v.setViewVisibility(R.id.w_foot, View.GONE);
        else v.setTextViewText(R.id.w_foot, foot);
        if (n.kind != WidgetData.Next.NOW && l.late > 0) {
            v.setViewVisibility(R.id.w_late, View.VISIBLE);
            v.setTextViewText(R.id.w_late, c.getString(R.string.w_late, l.late));
        }
        return v;
    }

    /** 다음 수업 위젯의 머리: 다음 수업 · 지금 수업 · 내일 · 월요일 · 11월 9일 (월) · 개강 · 9월 1일 (화) */
    private static String caption(Context c, WidgetData.Term t, WidgetData.Next n, Calendar now) {
        if (n.kind == WidgetData.Next.TODAY) return c.getString(R.string.w_next);
        if (n.kind == WidgetData.Next.NOW) return c.getString(R.string.w_now);
        if (WidgetData.ymd(now) < t.from) return c.getString(R.string.w_term_start, date(c, n.day));
        return when(c, n);
    }

    /** 다음 수업 날: 내일 · 월요일(일주일 안) · 11월 9일 (월) */
    private static String when(Context c, WidgetData.Next n) {
        if (n.daysAhead == 1) return c.getString(R.string.w_tomorrow);
        if (n.daysAhead < 7) return c.getResources().getStringArray(R.array.w_days)[WidgetData.weekday(n.day)];
        return date(c, n.day);
    }

    /** 걷기 줄: 그날 첫 수업은 '10:18 출발 · 걷기 12분', 앞 수업에서 오면 '걷기 8분', 모르면 "" */
    private static String walk(Context c, WidgetData.Lesson l) {
        if (l.walk < 0) return "";
        if (l.fromHome) return c.getString(R.string.w_leave, WidgetData.hm(Math.max(0, l.leave())), l.walk);
        return c.getString(R.string.w_walk, l.walk);
    }

    // ------------------------------------------------------------ 오늘 수업

    static RemoteViews today(Context c, WidgetData d, Calendar now, Bundle options) {
        RemoteViews v = new RemoteViews(c.getPackageName(), R.layout.widget_today);
        WidgetData.Term t = d == null ? null : d.termOn(now);
        v.setOnClickPendingIntent(android.R.id.background, open(c, t));
        v.setTextViewText(R.id.w_date, c.getString(R.string.w_today, date(c, now)));
        v.setTextViewText(R.id.w_title, t != null ? t.title : "");
        String problem = problem(c, d, t);
        List<WidgetData.Lesson> lessons = problem == null ? t.on(WidgetData.startOfDay(now)) : new ArrayList<>();
        if (lessons.isEmpty()) {
            v.setViewVisibility(R.id.w_rows, View.GONE);
            v.setViewVisibility(R.id.w_msg, View.VISIBLE);
            if (problem != null) {
                v.setTextViewText(R.id.w_msg, problem);
                return v;
            }
            v.setTextViewText(R.id.w_msg, c.getString(WidgetData.ymd(now) < t.from ? R.string.w_before_term : R.string.w_no_class_today));
            WidgetData.Next n = WidgetData.next(t, now);
            if (n != null) {
                v.setViewVisibility(R.id.w_sub, View.VISIBLE);
                v.setTextViewText(R.id.w_sub, c.getString(R.string.w_next_line, when(c, n), WidgetData.hm(n.lesson.start), n.lesson.name));
            }
            return v;
        }
        int min = WidgetData.minuteOfDay(now);
        int[] pick = WidgetData.rowsToShow(lessons, min, rowsThatFit(c, options));
        v.removeAllViews(R.id.w_rows);
        for (int i = pick[0]; i < pick[1]; i++) v.addView(R.id.w_rows, row(c, d, lessons.get(i), min));
        int more = lessons.size() - pick[1];
        if (more > 0) {
            v.setViewVisibility(R.id.w_sub, View.VISIBLE);
            v.setTextViewText(R.id.w_sub, c.getString(R.string.w_more, more));
        }
        return v;
    }

    /** 위젯 높이에 들어가는 행 수(글자 크기를 따른다). 높이를 모르면 4×2 */
    private static int rowsThatFit(Context c, Bundle options) {
        Configuration conf = c.getResources().getConfiguration();
        float font = Math.max(1f, conf.fontScale);
        boolean land = conf.orientation == Configuration.ORIENTATION_LANDSCAPE;
        int h = options == null ? 0 : options.getInt(land ? AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT : AppWidgetManager.OPTION_APPWIDGET_MAX_HEIGHT, 0);
        if (h <= 0) h = 110;
        float room = h - 24 - 6 - 18 * font; // 위아래 여백, 머리 아래 여백, 머리
        float rowH = 6 + 33 * font; // 위아래 3 + 두 줄(14sp·12sp)과 사이 3
        return Math.max(1, (int) (room / rowH));
    }

    private static RemoteViews row(Context c, WidgetData d, WidgetData.Lesson l, int min) {
        boolean past = l.end <= min, current = l.start <= min && min < l.end;
        RemoteViews r = new RemoteViews(c.getPackageName(), past ? R.layout.widget_today_row_past : R.layout.widget_today_row);
        r.setInt(R.id.r_mark, "setBackgroundResource", mark(d, l));
        r.setTextViewText(R.id.r_name, l.name);
        r.setTextViewText(R.id.r_time, WidgetData.hm(l.start) + "~" + WidgetData.hm(l.end));
        String walk = walk(c, l);
        String sub = l.place.isEmpty() ? walk : walk.isEmpty() ? l.place : l.place + " · " + walk;
        if (sub.isEmpty()) r.setViewVisibility(R.id.r_sub, View.GONE);
        else r.setTextViewText(R.id.r_sub, sub);
        if (l.late > 0 && !past) {
            r.setViewVisibility(R.id.r_late, View.VISIBLE);
            r.setTextViewText(R.id.r_late, c.getString(R.string.w_late, l.late));
        }
        if (current) r.setViewVisibility(R.id.r_now, View.VISIBLE);
        return r;
    }

    // ------------------------------------------------------------ 주간 시간표

    static RemoteViews week(Context c, WidgetData d, Calendar now, Bundle options) {
        RemoteViews v = new RemoteViews(c.getPackageName(), R.layout.widget_week);
        WidgetData.Term t = d == null ? null : d.termOn(now);
        v.setOnClickPendingIntent(android.R.id.background, open(c, t));
        v.setTextViewText(R.id.w_title, t != null ? (t.label + " · " + t.title) : c.getString(R.string.widget_week_name));
        String problem = problem(c, d, t);
        if (problem != null) {
            v.setViewVisibility(R.id.w_grid, View.GONE);
            v.setViewVisibility(R.id.w_msg, View.VISIBLE);
            v.setTextViewText(R.id.w_msg, problem);
            return v;
        }
        Configuration conf = c.getResources().getConfiguration();
        boolean land = conf.orientation == Configuration.ORIENTATION_LANDSCAPE;
        int w = options == null ? 0 : options.getInt(land ? AppWidgetManager.OPTION_APPWIDGET_MAX_WIDTH : AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH, 0);
        int h = options == null ? 0 : options.getInt(land ? AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT : AppWidgetManager.OPTION_APPWIDGET_MAX_HEIGHT, 0);
        if (w <= 0) w = 250;
        if (h <= 0) h = 250;
        float gridW = w - 20, gridH = h - 20 - 6 - 18 * Math.max(1f, conf.fontScale); // 여백 10씩, 머리와 그 아래 6
        String[] days = c.getResources().getStringArray(R.array.w_days_short);
        Bitmap light = WeekBitmap.draw(c, t, d.colors, now, gridW, gridH, false, days);
        Bitmap dark = WeekBitmap.draw(c, t, d.colors, now, gridW, gridH, true, days);
        v.setImageViewBitmap(R.id.w_grid_light, light);
        v.setImageViewBitmap(R.id.w_grid_dark, dark);
        String said = c.getString(R.string.w_week_said, t.label + " " + t.title, WeekBitmap.describe(t, days));
        v.setContentDescription(R.id.w_grid_light, said);
        v.setContentDescription(R.id.w_grid_dark, said);
        return v;
    }

    // ------------------------------------------------------------ 함께 쓰는 것

    /** 보일 것이 없을 때의 글(없으면 null): 자료가 없다 · 이번 학기 대표 시간표가 없다 · 대표 시간표에 수업이 없다 */
    private static String problem(Context c, WidgetData d, WidgetData.Term t) {
        if (d == null) return c.getString(R.string.w_no_data);
        if (t == null) return c.getString(R.string.w_no_term);
        if (!t.timed()) return c.getString(R.string.w_empty);
        return null;
    }

    /** 항목 표시 색: 칸 색 설정이 교과구분이면 교과구분, 아니면 항목 색 */
    static int mark(WidgetData d, WidgetData.Lesson l) {
        if ("cls".equals(d.colors)) {
            switch (l.cls) {
                case "req": return R.drawable.widget_mark_req;
                case "elec": return R.drawable.widget_mark_elec;
                case "gen": return R.drawable.widget_mark_gen;
                default: return R.drawable.widget_mark_etc;
            }
        }
        return ITEM_MARKS[Math.floorMod(l.color, ITEM_MARKS.length)];
    }

    /** 10월 30일 (금) */
    static String date(Context c, Calendar day) {
        String[] short_ = c.getResources().getStringArray(R.array.w_days_short);
        return c.getString(R.string.w_date, day.get(Calendar.MONTH) + 1, day.get(Calendar.DAY_OF_MONTH), short_[WidgetData.weekday(day)]);
    }

    private static PendingIntent open(Context c, WidgetData.Term t) {
        String url = OPEN_URL + (t != null && !t.sem.isEmpty() ? "&sem=" + Uri.encode(t.sem) : "");
        Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url), c, MainActivity.class);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        return PendingIntent.getActivity(c, 0, intent, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }
}
