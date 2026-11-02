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
import android.os.Build;
import android.os.Bundle;
import android.text.SpannableString;
import android.text.Spanned;
import android.text.TextPaint;
import android.text.style.RelativeSizeSpan;
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
 *                    걷는 분·지각(WidgetData.hero). 오늘이 끝났으면 다음 수업 날의 첫 수업(내일·요일·날짜), 개강 전이면 '개강 · 9월 1일 (화)'.
 *   오늘 수업(4×2~)  오늘 수업 행(높이만큼. 끝난 수업은 흐리게, 지금 수업에 '지금'). 넘치면 '외 n개'. 수업이 없는 날은 다음 수업 한 줄.
 *   주간 시간표(4×4) 대표 시간표 한 주 그림(WeekBitmap, 라이트·다크 두 장).
 *   동선 지도(4×2~)  그날(오늘 수업이 끝났으면 다음 수업 날) 걷는 길과 수업 핀(DayMapBitmap, 라이트·다크 두 장), 머리에 그날 걷기 합(update71).
 * 보일 수업이 없으면 머리 줄 아래 가운데에 빈 상태(widget_empty: 아이콘, 한 문장, 다음 수업 줄이나 '내 시간표 열기').
 * 누르면 앱(MainActivity 에 주소를 넘긴다: native.js 의 launchUrl·'ttw:open-url' 로 화면에 간다). 다음 수업·오늘 수업은 그 요일 동선 지도
 * (주소의 route, WidgetData.openUrl)이고 동선 지도는 그 지도의 요일, 주간 시간표는 내 시간표.
 * 수업을 누르면(update77) 그 수업의 항목 시트: 다음 수업의 수업 줄, 오늘 수업의 행, 주간 시간표의 칸(안드로이드 12 이상) → WidgetData.itemUrl.
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
        if (kind == WidgetUpdater.MAP) return map(c, d, now, options);
        return week(c, d, now, options);
    }

    // 런처는 같은 레이아웃이면 전에 펼친 화면을 버리지 않고 이번 RemoteViews 의 바꿈만 그 위에 다시 얹는다(AppWidgetHostView 의 재사용, update69).
    // 그래서 그릴 때마다 바뀔 수 있는 보이기는 먼저 레이아웃의 처음 모양으로 되돌린다. 안 그러면 '자료가 아직 없어요' 같은 글이 수업이 들어온 뒤에도 남는다.
    // 아래 둘은 레이아웃 XML 의 처음 보이기와 같아야 한다(tests/test_widgets.py 가 견준다). 주간의 w_grid_light·dark 는 layout(-night) 이 정하므로 넣지 않는다
    static final int[] NEXT_SHOWN = { R.id.w_body, R.id.w_time, R.id.w_place, R.id.w_hero, R.id.w_hero_line, R.id.w_hero_sub };
    static final int[] NEXT_HIDDEN = { R.id.w_mark, R.id.w_late, R.id.w_empty, R.id.w_msg_sub, R.id.w_action };
    static final int[] TODAY_SHOWN = { R.id.w_rows };
    static final int[] TODAY_HIDDEN = { R.id.w_sub, R.id.w_empty, R.id.w_msg_sub, R.id.w_action };
    static final int[] WEEK_SHOWN = { R.id.w_grid };
    static final int[] WEEK_HIDDEN = { R.id.w_empty, R.id.w_msg_sub, R.id.w_action };
    static final int[] MAP_SHOWN = { R.id.w_map, R.id.w_sum };
    static final int[] MAP_HIDDEN = { R.id.w_empty, R.id.w_msg_sub, R.id.w_action };

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
        // 자리(update70 출발 줄을 크게, update77 출발 시각 블록): 높이(dp)가 모자라면 덜 중요한 줄부터 뺀다. 과목명 두 줄 → 한 줄 → 강의실 줄 →
        // 블록 안 아래 줄 → 시각 줄, 그래도 모자라면 블록을 줄인다. 머리 줄과 블록은 늘 둔다(언제 나서는지가 이 위젯의 일이다). 기준은 WidgetData.nextRows
        int[] wh = size(c, options, 110, 110);
        float f = font(c);
        boolean[] rows = WidgetData.nextRows(wh[1], f);
        boolean twoLines = rows[0], place = rows[1], sub = rows[2], time = rows[3], compact = rows[4];
        v.setOnClickPendingIntent(R.id.w_lecture, openItem(c, t, l)); // 수업 줄은 그 수업의 항목 시트, 나머지(블록 포함)는 그 요일 동선 지도
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
        String big, number, small = "";
        switch (hero.kind) {
            case WidgetData.Hero.LEAVE:
                number = WidgetData.hm(hero.minute);
                big = c.getString(R.string.w_hero_leave, number);
                small = c.getString(R.string.w_walk, hero.walk);
                break;
            case WidgetData.Hero.WALK:
                number = String.valueOf(hero.walk);
                big = c.getString(R.string.w_walk, hero.walk);
                small = hero.from.isEmpty() ? "" : c.getString(R.string.w_from, hero.from);
                break;
            case WidgetData.Hero.END:
                number = WidgetData.hm(hero.minute);
                big = c.getString(R.string.w_hero_end, number);
                small = c.getString(R.string.w_last);
                break;
            default:
                number = WidgetData.hm(hero.minute);
                big = c.getString(R.string.w_hero_start, number);
        }
        // 블록 가운데 큰 줄: 시각·분은 32(낮으면 26), '출발'·'걷기'·'분' 같은 낱말은 그 반(update77, 사용자 11/2 "시간을 좀 더 가운데에 큼지막하게")
        v.setTextViewText(R.id.w_hero, bigLine(big, number));
        v.setTextViewTextSize(R.id.w_hero, TypedValue.COMPLEX_UNIT_SP, compact ? 26 : 32);
        int padH = px(c, 8), padV = px(c, compact ? 5 : 8);
        v.setViewPadding(R.id.w_block, padH, padV, padH, padV);
        boolean late = hero.late > 0 && sub;
        if (small.isEmpty() || !sub) v.setViewVisibility(R.id.w_hero_sub, View.GONE);
        else v.setTextViewText(R.id.w_hero_sub, small);
        if (late) {
            v.setViewVisibility(R.id.w_late, View.VISIBLE);
            v.setTextViewText(R.id.w_late, c.getString(R.string.w_late, hero.late));
        }
        if (!late && (small.isEmpty() || !sub)) v.setViewVisibility(R.id.w_hero_line, View.GONE); // 아래 줄이 없으면 그 띄움도 뺀다(블록 위아래 여백이 같게)
        return v;
    }

    /** 큰 줄 글: number(시각·분)만 큰 글자 그대로 두고 나머지 낱말은 반 크기(RelativeSizeSpan. 위젯 글은 한 줄이라 글자 밑선이 맞는다) */
    static CharSequence bigLine(String text, String number) {
        int[] at = WidgetData.bigPart(text, number);
        if (at == null) return text;
        SpannableString s = new SpannableString(text);
        if (at[0] > 0) s.setSpan(new RelativeSizeSpan(0.5f), 0, at[0], Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
        if (at[1] < text.length()) s.setSpan(new RelativeSizeSpan(0.5f), at[1], text.length(), Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
        return s;
    }

    private static int px(Context c, float dp) {
        return Math.round(dp * c.getResources().getDisplayMetrics().density);
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
        for (int i = pick[0]; i < pick[1]; i++) v.addView(R.id.w_rows, row(c, d, t, lessons.get(i), min));
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

    private static RemoteViews row(Context c, WidgetData d, WidgetData.Term t, WidgetData.Lesson l, int min) {
        boolean past = l.end <= min, current = l.start <= min && min < l.end;
        RemoteViews r = new RemoteViews(c.getPackageName(), past ? R.layout.widget_today_row_past : R.layout.widget_today_row);
        r.setOnClickPendingIntent(R.id.r_root, openItem(c, t, l)); // 행을 누르면 그 수업의 항목 시트(update77). 행 밖은 그 요일 동선 지도
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
        // 수업 칸을 누르면 그 항목 시트(update77): 칸 자리에 투명한 누르는 칸을 그림과 같은 셈(WidgetData.WeekGrid)으로 놓는다.
        // 자리를 dp 로 정하는 것은 안드로이드 12 부터라 그 아래는 격자 전체가 내 시간표다
        v.removeAllViews(R.id.w_hits);
        if (Build.VERSION.SDK_INT >= 31) Api31.hits(c, v, t, Math.max(gridW, 60), Math.max(gridH, 60), days);
        return v;
    }

    /** 안드로이드 12 이상에만 있는 것(그 아래 기기는 이 클래스를 읽지 않는다) */
    private static final class Api31 {
        /** 주간 격자의 수업 칸마다 누르는 칸(widget_week_hit)을 그 자리·크기(dp)로 w_hits 에 놓는다. 이름은 '월 09:30 생명과학 1 26동 104호' */
        static void hits(Context c, RemoteViews v, WidgetData.Term t, float widthDp, float heightDp, String[] dayNames) {
            WidgetData.WeekGrid g = new WidgetData.WeekGrid(t, widthDp, heightDp, 1, WidgetData.weekFont(c.getResources().getConfiguration().fontScale));
            for (int d = 0; d < g.days; d++) {
                List<WidgetData.Lesson> list = t.days.get(d);
                int[] lane = new int[list.size()], lanes = new int[list.size()];
                WidgetData.laneOf(list, lane, lanes);
                for (int i = 0; i < list.size(); i++) {
                    WidgetData.Lesson l = list.get(i);
                    if (!WidgetData.safeKey(l.key)) continue; // 옛 자료(열쇠 없음): 칸 밖처럼 내 시간표
                    float[] b = g.box(d, l, lane[i], lanes[i]);
                    RemoteViews hit = new RemoteViews(c.getPackageName(), R.layout.widget_week_hit);
                    hit.setViewLayoutWidth(R.id.w_hit, Math.max(1, b[2] - b[0]), TypedValue.COMPLEX_UNIT_DIP);
                    hit.setViewLayoutHeight(R.id.w_hit, Math.max(1, b[3] - b[1]), TypedValue.COMPLEX_UNIT_DIP);
                    hit.setViewLayoutMargin(R.id.w_hit, RemoteViews.MARGIN_LEFT, b[0], TypedValue.COMPLEX_UNIT_DIP);
                    hit.setViewLayoutMargin(R.id.w_hit, RemoteViews.MARGIN_TOP, b[1], TypedValue.COMPLEX_UNIT_DIP);
                    hit.setContentDescription(R.id.w_hit, dayNames[d] + " " + WidgetData.hm(l.start) + " " + l.name + (l.place.isEmpty() ? "" : " " + l.place));
                    hit.setOnClickPendingIntent(R.id.w_hit, openItem(c, t, l));
                    v.addView(R.id.w_hits, hit);
                }
            }
        }
    }

    // ------------------------------------------------------------ 동선 지도

    static RemoteViews map(Context c, WidgetData d, Calendar now, Bundle options) {
        RemoteViews v = new RemoteViews(c.getPackageName(), R.layout.widget_map);
        reset(v, MAP_SHOWN, MAP_HIDDEN);
        WidgetData.Term t = d == null ? null : d.termOn(now);
        String problem = problem(c, d, t);
        // 보일 날: 오늘 수업이 남았으면(지금 수업 중 포함) 오늘, 다 끝났으면 다음 수업 날(다음 수업 위젯과 같다)
        WidgetData.Next n = problem == null ? WidgetData.next(t, now) : null;
        v.setOnClickPendingIntent(android.R.id.background, open(c, t, n == null ? -1 : WidgetData.weekday(n.day)));
        if (n == null) {
            v.setTextViewText(R.id.w_title, t != null ? t.label : c.getString(R.string.widget_map_name));
            v.setViewVisibility(R.id.w_map, View.GONE);
            v.setViewVisibility(R.id.w_sum, View.GONE);
            v.setImageViewResource(R.id.w_empty_icon, R.drawable.widget_ic_route);
            empty(v, problem != null ? problem : c.getString(R.string.w_term_over), "", problem != null && d != null);
            return v;
        }
        List<WidgetData.Lesson> day = t.on(n.day);
        String title = mapTitle(c, t, n, now);
        v.setTextViewText(R.id.w_title, title);
        int walk = WidgetData.dayWalk(day);
        if (walk >= 0) v.setTextViewText(R.id.w_sum, c.getString(R.string.w_walk, walk));
        else v.setViewVisibility(R.id.w_sum, View.GONE);
        RouteMap m = DayMapBitmap.data(c);
        if (!DayMapBitmap.drawable(m, day, d.home)) { // 강의실이 정해진 수업도 출발 자리도 지도에 없다
            v.setViewVisibility(R.id.w_map, View.GONE);
            v.setImageViewResource(R.id.w_empty_icon, R.drawable.widget_ic_route);
            empty(v, c.getString(R.string.w_no_route), "", false);
            return v;
        }
        int[] wh = size(c, options, 250, 110);
        float mapW = wh[0] - 20, mapH = wh[1] - 20 - 6 - 18 * font(c); // 여백 10씩, 머리와 그 아래 6
        v.setImageViewBitmap(R.id.w_map_light, DayMapBitmap.draw(c, m, day, d.home, mapW, mapH, false));
        v.setImageViewBitmap(R.id.w_map_dark, DayMapBitmap.draw(c, m, day, d.home, mapW, mapH, true));
        // 스크린리더: '오늘 · 10월 30일 (금) 동선 지도. 1 생명과학 1 26동 104호, 2 …'
        StringBuilder said = new StringBuilder();
        for (int i = 0; i < day.size(); i++) {
            WidgetData.Lesson l = day.get(i);
            said.append(i == 0 ? "" : ", ").append(i + 1).append(' ').append(l.name);
            if (!l.place.isEmpty()) said.append(' ').append(l.place);
        }
        String text = c.getString(R.string.w_map_said, title, said.toString());
        v.setContentDescription(R.id.w_map_light, text);
        v.setContentDescription(R.id.w_map_dark, text);
        return v;
    }

    /**
     * 동선 지도의 머리: 오늘 · 10월 30일 (금) · 내일 · 10월 31일 (토) · 월요일 · 11월 2일 · 11월 9일 (월) · 개강 · 9월 1일 (화).
     * 일주일 안의 요일 이름 뒤에는 날짜의 (요일)을 붙이지 않는다(요일이 겹친다. 디자인 93판, update73)
     */
    private static String mapTitle(Context c, WidgetData.Term t, WidgetData.Next n, Calendar now) {
        if (n.kind != WidgetData.Next.LATER) return c.getString(R.string.w_today, date(c, now));
        if (WidgetData.ymd(now) < t.from) return c.getString(R.string.w_term_start, date(c, n.day));
        if (n.daysAhead == 1) return c.getString(R.string.w_on, when(c, n), date(c, n.day));
        if (n.daysAhead < 7) return c.getString(R.string.w_on, when(c, n), c.getString(R.string.w_month_day, n.day.get(Calendar.MONTH) + 1, n.day.get(Calendar.DAY_OF_MONTH)));
        return date(c, n.day);
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
        return intent(c, WidgetData.openUrl(OPEN_URL, t == null ? null : t.sem, day));
    }

    /** 수업 하나를 누르면 여는 앱 화면: 그 학기 대표 시간표(t.id)의 그 항목 시트(update77). 열쇠를 모르면(옛 자료) 내 시간표 */
    static PendingIntent openItem(Context c, WidgetData.Term t, WidgetData.Lesson l) {
        return intent(c, WidgetData.itemUrl(OPEN_URL, t == null ? null : t.sem, t == null ? "" : t.id, l.key));
    }

    /** 주소를 앱(MainActivity)에 넘기는 PendingIntent. 주소(data)가 다르면 다른 PendingIntent 다(같은 requestCode 여도) */
    private static PendingIntent intent(Context c, String url) {
        Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url), c, MainActivity.class);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        return PendingIntent.getActivity(c, 0, intent, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }
}
