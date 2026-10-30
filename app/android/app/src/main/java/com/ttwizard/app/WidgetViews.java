package com.ttwizard.app;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.content.Context;
import android.content.Intent;
import android.content.res.Configuration;
import android.graphics.Bitmap;
import android.graphics.Paint;
import android.graphics.Typeface;
import android.net.Uri;
import android.os.Bundle;
import android.text.TextPaint;
import android.util.DisplayMetrics;
import android.util.TypedValue;
import android.view.View;
import android.widget.RemoteViews;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.List;
import java.util.function.Predicate;

/**
 * 홈 화면 위젯의 화면(RemoteViews) — 백엔드 세션(10/30). 무엇을 보일지는 WidgetData, 언제 다시 그릴지는 WidgetUpdater.
 *   다음 수업(2×2)   다음 수업(지금 수업 중이면 그다음)의 이름·시각·강의실과, 아래에 크게 나설 시각(그날 첫 수업: 출발 지점에서)이나 앞 수업에서
 *                    걷는 분·늦음(WidgetData.hero). 오늘이 끝났으면 다음 수업 날의 첫 수업(내일·요일·날짜), 개강 전이면 '개강 · 9월 1일 (화)'.
 *   오늘 수업(4×2~)  오늘 수업 행(높이만큼. 끝난 수업은 흐리게, 지금 수업에 '지금'). 넘치면 '외 n개'. 수업이 없는 날은 다음 수업 한 줄.
 *   주간 시간표(4×4) 대표 시간표 한 주 그림(WeekBitmap, 라이트·다크 두 장).
 * 보일 수업이 없으면 머리 줄 아래 가운데에 빈 상태(widget_empty: 아이콘, 한 문장, 다음 수업 줄이나 '내 시간표 열기').
 * 누르면 앱(MainActivity 에 주소를 넘긴다: native.js 의 launchUrl·'ttw:open-url' 로 화면에 간다). 다음 수업·오늘 수업은 그 요일 동선 지도
 * (주소의 route, WidgetData.openUrl), 주간 시간표는 내 시간표.
 * 글자색은 XML(values(-night)/colors.xml)이 정해서 기기 테마가 바뀌면 런처가 다시 펼칠 때 맞는다. 코드는 색을 숫자로 넣지 않는다.
 */
final class WidgetViews {

    /** 위젯을 누르면 여는 주소의 앞(화면이 '#tab=mine' 을 보고 내 시간표로 간다. 뒤에 sem·route 를 붙인다: WidgetData.openUrl) */
    static final String OPEN_URL = "https://archi142857.github.io/tt-wizard/#tab=mine";

    private static final int[] ITEM_MARKS = {
        R.drawable.widget_mark_item0, R.drawable.widget_mark_item1, R.drawable.widget_mark_item2, R.drawable.widget_mark_item3,
        R.drawable.widget_mark_item4, R.drawable.widget_mark_item5, R.drawable.widget_mark_item6, R.drawable.widget_mark_item7,
    };

    private WidgetViews() {}

    static RemoteViews build(Context c, int kind, WidgetData d, Calendar now, Bundle options) {
        if (kind == WidgetUpdater.NEXT) return next(c, d, now, options);
        if (kind == WidgetUpdater.TODAY) return today(c, d, now, options);
        return week(c, d, now, options);
    }

    // 런처는 같은 레이아웃이면 전에 펼친 화면을 버리지 않고 이번 RemoteViews 의 바꿈만 그 위에 다시 얹는다(AppWidgetHostView 의 재사용, update69).
    // 그래서 그릴 때마다 바뀔 수 있는 보이기는 먼저 레이아웃의 처음 모양으로 되돌린다. 안 그러면 '자료가 아직 없어요' 같은 글이 수업이 들어온 뒤에도 남는다.
    // 아래 둘은 레이아웃 XML 의 처음 보이기와 같아야 한다(tests/test_widgets.py 가 견준다). 주간의 w_grid_light·dark 는 layout(-night) 이 정하므로 넣지 않는다
    static final int[] NEXT_SHOWN = { R.id.w_body, R.id.w_time, R.id.w_place, R.id.w_hero, R.id.w_hero_sub };
    static final int[] NEXT_HIDDEN = { R.id.w_mark, R.id.w_late, R.id.w_empty, R.id.w_msg_sub, R.id.w_action };
    static final int[] TODAY_SHOWN = { R.id.w_rows };
    static final int[] TODAY_HIDDEN = { R.id.w_sub, R.id.w_empty, R.id.w_msg_sub, R.id.w_action };
    static final int[] WEEK_SHOWN = { R.id.w_grid };
    static final int[] WEEK_HIDDEN = { R.id.w_empty, R.id.w_msg_sub, R.id.w_action };

    private static void reset(RemoteViews v, int[] shown, int[] hidden) {
        for (int id : shown) v.setViewVisibility(id, View.VISIBLE);
        for (int id : hidden) v.setViewVisibility(id, View.GONE);
    }

    /** 위젯이 지금 받은 크기(dp, {폭, 높이}): 세로 화면은 최소 폭·최대 높이, 가로 화면은 최대 폭·최소 높이(AppWidgetManager 설명). 모르면 w0·h0 */
    private static int[] size(Context c, Bundle options, int w0, int h0) {
        boolean land = c.getResources().getConfiguration().orientation == Configuration.ORIENTATION_LANDSCAPE;
        int w = options == null ? 0 : options.getInt(land ? AppWidgetManager.OPTION_APPWIDGET_MAX_WIDTH : AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH, 0);
        int h = options == null ? 0 : options.getInt(land ? AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT : AppWidgetManager.OPTION_APPWIDGET_MAX_HEIGHT, 0);
        return new int[] { w > 0 ? w : w0, h > 0 ? h : h0 };
    }

    /** 기기 글자 크기(작게 해도 1로 본다: 자리를 셀 때 넉넉하게) */
    private static float font(Context c) {
        return Math.max(1f, c.getResources().getConfiguration().fontScale);
    }

    // ------------------------------------------------------------ 다음 수업

    static RemoteViews next(Context c, WidgetData d, Calendar now, Bundle options) {
        RemoteViews v = new RemoteViews(c.getPackageName(), R.layout.widget_next);
        reset(v, NEXT_SHOWN, NEXT_HIDDEN);
        WidgetData.Term t = d == null ? null : d.termOn(now);
        String problem = problem(c, d, t);
        WidgetData.Next n = problem == null ? WidgetData.next(t, now) : null;
        v.setOnClickPendingIntent(android.R.id.background, open(c, t, n == null ? -1 : WidgetData.weekday(n.day)));
        if (n == null) {
            v.setTextViewText(R.id.w_caption, t != null ? t.label : c.getString(R.string.widget_next_name));
            v.setViewVisibility(R.id.w_body, View.GONE);
            empty(v, problem != null ? problem : c.getString(R.string.w_term_over), "", problem != null && d != null); // 학기의 남은 날에 수업이 없다
            return v;
        }
        WidgetData.Lesson l = n.lesson;
        // 자리(update70, 출발 줄을 크게): 높이(dp)가 모자라면 덜 중요한 줄부터 뺀다. 과목명 두 줄 → 한 줄 → 강의실 줄 → 큰 줄 아래 줄 → 시각 줄.
        // 머리 줄과 큰 출발 줄은 늘 둔다(언제 나서는지가 이 위젯의 일이다). 기준 = 여백 24 + 남기는 줄들의 높이 × 기기 글자 크기
        // (머리 16, 과목명 23씩, 시각·강의실 19씩, 큰 줄 26, 그 아래 19, 사이 띄움 12. 옛 런처의 2×2 최소 110dp 에는 머리·과목명 한 줄·시각·큰 줄)
        int[] wh = size(c, options, 110, 110);
        float f = font(c);
        int h = wh[1];
        boolean twoLines = h >= 24 + 157 * f, place = h >= 24 + 134 * f, sub = h >= 24 + 115 * f, time = h >= 24 + 94 * f;
        v.setTextViewText(R.id.w_caption, caption(c, t, n, now));
        v.setViewVisibility(R.id.w_mark, View.VISIBLE);
        v.setInt(R.id.w_mark, "setBackgroundResource", mark(d, l));
        v.setInt(R.id.w_name, "setMaxLines", twoLines ? 2 : 1);
        v.setTextViewText(R.id.w_name, twoLines ? WidgetData.glueTail(l.name, titleFits(c, wh[0] - 24)) : l.name);
        if (time) v.setTextViewText(R.id.w_time, WidgetData.hm(l.start) + "~" + WidgetData.hm(l.end));
        else v.setViewVisibility(R.id.w_time, View.GONE);
        if (l.place.isEmpty() || !place) v.setViewVisibility(R.id.w_place, View.GONE);
        else v.setTextViewText(R.id.w_place, l.place);
        WidgetData.Hero hero = WidgetData.hero(t, n);
        String big, small = "";
        switch (hero.kind) {
            case WidgetData.Hero.LEAVE:
                big = c.getString(R.string.w_hero_leave, WidgetData.hm(hero.minute));
                small = c.getString(R.string.w_walk, hero.walk);
                break;
            case WidgetData.Hero.WALK:
                big = c.getString(R.string.w_walk, hero.walk);
                small = hero.from.isEmpty() ? "" : c.getString(R.string.w_from, hero.from);
                break;
            case WidgetData.Hero.END:
                big = c.getString(R.string.w_hero_end, WidgetData.hm(hero.minute));
                small = c.getString(R.string.w_last);
                break;
            default:
                big = c.getString(R.string.w_hero_start, WidgetData.hm(hero.minute));
        }
        v.setTextViewText(R.id.w_hero, big);
        if (small.isEmpty() || !sub) v.setViewVisibility(R.id.w_hero_sub, View.GONE);
        else v.setTextViewText(R.id.w_hero_sub, small);
        if (hero.late > 0 && sub) {
            v.setViewVisibility(R.id.w_late, View.VISIBLE);
            v.setTextViewText(R.id.w_late, c.getString(R.string.w_late, hero.late));
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

    /** 다음 수업 과목명(TTWWidget.Title: 16sp 굵게)이 폭 widthDp 한 줄에 드는지(끝 번호 붙이기에 쓴다) */
    private static Predicate<String> titleFits(Context c, int widthDp) {
        DisplayMetrics m = c.getResources().getDisplayMetrics();
        TextPaint p = new TextPaint(Paint.ANTI_ALIAS_FLAG);
        p.setTextSize(TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_SP, 16, m));
        p.setTypeface(Typeface.DEFAULT_BOLD);
        float width = widthDp * m.density;
        return s -> p.measureText(s) <= width - 1;
    }

    // ------------------------------------------------------------ 오늘 수업

    static RemoteViews today(Context c, WidgetData d, Calendar now, Bundle options) {
        RemoteViews v = new RemoteViews(c.getPackageName(), R.layout.widget_today);
        reset(v, TODAY_SHOWN, TODAY_HIDDEN);
        WidgetData.Term t = d == null ? null : d.termOn(now);
        v.setTextViewText(R.id.w_date, c.getString(R.string.w_today, date(c, now)));
        v.setTextViewText(R.id.w_title, t != null ? t.title : "");
        String problem = problem(c, d, t);
        List<WidgetData.Lesson> lessons = problem == null ? t.on(WidgetData.startOfDay(now)) : new ArrayList<>();
        if (lessons.isEmpty()) {
            v.setViewVisibility(R.id.w_rows, View.GONE);
            if (problem != null) {
                v.setOnClickPendingIntent(android.R.id.background, open(c, t, -1));
                empty(v, problem, "", d != null);
                return v;
            }
            WidgetData.Next n = WidgetData.next(t, now);
            v.setOnClickPendingIntent(android.R.id.background, open(c, t, n == null ? -1 : WidgetData.weekday(n.day)));
            empty(v, c.getString(WidgetData.ymd(now) < t.from ? R.string.w_before_term : R.string.w_no_class_today),
                n == null ? "" : c.getString(R.string.w_next_line, when(c, n), WidgetData.hm(n.lesson.start), n.lesson.name), false);
            return v;
        }
        v.setOnClickPendingIntent(android.R.id.background, open(c, t, WidgetData.weekday(now)));
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
        float font = font(c);
        int h = size(c, options, 250, 110)[1];
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
        reset(v, WEEK_SHOWN, WEEK_HIDDEN);
        WidgetData.Term t = d == null ? null : d.termOn(now);
        v.setOnClickPendingIntent(android.R.id.background, open(c, t, -1)); // 한 주 전체라 내 시간표로
        v.setTextViewText(R.id.w_title, t != null ? (t.label + " · " + t.title) : c.getString(R.string.widget_week_name));
        String problem = problem(c, d, t);
        if (problem != null) {
            v.setViewVisibility(R.id.w_grid, View.GONE);
            empty(v, problem, "", d != null);
            return v;
        }
        int[] wh = size(c, options, 250, 250);
        float gridW = wh[0] - 20, gridH = wh[1] - 20 - 6 - 18 * font(c); // 여백 10씩, 머리와 그 아래 6
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

    /**
     * 빈 상태(widget_empty, update70): 머리 줄 아래 가운데에 아이콘, 지금 상태 한 문장(msg), 있으면 그 아래 한 줄(sub: 오늘 수업이 없는 날의 다음 수업)이나
     * '내 시간표 열기'(action: 대표 시간표가 없거나 비었을 때. 위젯 전체가 앱을 연다). 자료가 아직 없을 때('앱을 열면 …')는 문장이 할 일을 말해서 action 이 없다
     */
    private static void empty(RemoteViews v, String msg, String sub, boolean action) {
        v.setViewVisibility(R.id.w_empty, View.VISIBLE);
        v.setTextViewText(R.id.w_msg, msg);
        if (!sub.isEmpty()) {
            v.setViewVisibility(R.id.w_msg_sub, View.VISIBLE);
            v.setTextViewText(R.id.w_msg_sub, sub);
        } else if (action) {
            v.setViewVisibility(R.id.w_action, View.VISIBLE);
        }
    }

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

    /** 누르면 여는 앱 화면: 그 학기(t)와, day(월 0 … 일 6)가 있으면 그 요일의 동선 지도. -1 이면 내 시간표 */
    private static PendingIntent open(Context c, WidgetData.Term t, int day) {
        String url = WidgetData.openUrl(OPEN_URL, t == null ? null : t.sem, day);
        Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url), c, MainActivity.class);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        return PendingIntent.getActivity(c, 0, intent, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }
}
