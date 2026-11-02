package com.ttwizard.app;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.graphics.RectF;
import android.graphics.Typeface;
import android.graphics.text.LineBreakConfig;
import android.os.Build;
import android.text.Layout;
import android.text.StaticLayout;
import android.text.TextPaint;
import android.text.TextUtils;
import java.util.List;
import java.util.Locale;

/**
 * 주간 시간표 위젯의 격자 그림 — 백엔드 세션(10/30). RemoteViews 로는 칸을 시각 자리에 놓을 수 없어(안드로이드 12 아래) 그림으로 그린다.
 * 위젯이 기기 테마를 따를 때(기본)는 기기 테마가 바뀌어도 맞게 라이트·다크 두 장을 그리고 layout(-night)/widget_week.xml 이 한 장을 보인다.
 * 앱에서 라이트·다크를 골랐거나 크리스마스 기간이면(update78, WidgetData.theme) 그 한 벌로 한 장만 그린다.
 * 색은 웹 화면의 테마 토큰(web/style.css: 라이트 :root, 다크 :root[data-scheme="dark"], 크리스마스 html[data-theme="xmas"])과 같은 값(tests/test_widgets.py 가 견준다).
 * 요일은 월~금(토·일은 수업이 있을 때만), 시각은 수업이 있는 시간만(적어도 네 시간). 칸은 과목명(굵게)과 남는 자리에 강의실이고 글자색은 칸마다의 글자색
 * (item-N-fg·fg2, 교과구분이면 cls-*-fg·fg2: 기본 테마는 text·text2, 크리스마스의 짙은 칸은 흰 글자. 앱 화면 격자와 같다).
 * 칸 글은 낱말(어절) 가운데서 끊지 않고(안드로이드 13 이상) 과목명 끝 번호를 앞 낱말에 붙인다(디자인 89판, 앱 화면 격자와 같게).
 * 화면처럼 기기 글자 크기를 따르되 칸이 작아 1.3배에서 멈춘다.
 */
final class WeekBitmap {

    /** 한 벌의 색 */
    static final class Ink {
        final int text3;
        final int line;
        final int accent;
        final int accentWeak;
        final int[] items; // item-0 ~ item-7 칸 채움
        final int[] cls; // cls-req-bg, cls-elec-bg, cls-gen-bg, cls-etc-bg
        final int[] itemFg; // item-N-fg: 칸 위 과목명
        final int[] itemFg2; // item-N-fg2: 칸 위 강의실
        final int[] clsFg; // cls-*-fg
        final int[] clsFg2; // cls-*-fg2

        Ink(int text3, int line, int accent, int accentWeak, int[] items, int[] cls, int[] itemFg, int[] itemFg2, int[] clsFg, int[] clsFg2) {
            this.text3 = text3;
            this.line = line;
            this.accent = accent;
            this.accentWeak = accentWeak;
            this.items = items;
            this.cls = cls;
            this.itemFg = itemFg;
            this.itemFg2 = itemFg2;
            this.clsFg = clsFg;
            this.clsFg2 = clsFg2;
        }
    }

    private static int[] all(int n, int color) {
        int[] out = new int[n];
        java.util.Arrays.fill(out, color);
        return out;
    }

    // 라이트: text3, line, accent-text, accent-weak, item-0~7, cls-*-bg, item-N-fg·fg2, cls-*-fg·fg2(기본 테마는 모두 text·text2).
    // 바탕(card)은 위젯 바탕 그림(widget_bg)이라 그림은 비워 둔다
    static final Ink LIGHT = new Ink(0xFF646C7E, 0xFFDEE1F7, 0xFF415FEC, 0xFFEEF0FF,
        new int[] { 0xFFDCE9FF, 0xFFCBF6D8, 0xFFFFE0C4, 0xFFF1E2FF, 0xFFFBEEB0, 0xFFFFDCEB, 0xFFC3F4F7, 0xFFE6EAF2 },
        new int[] { 0xFFEAF0FF, 0xFFDAF8ED, 0xFFFFECE1, 0xFFEDEEF7 },
        all(8, 0xFF182033), all(8, 0xFF51596A), all(4, 0xFF182033), all(4, 0xFF51596A));
    // 다크: 같은 토큰의 다크 값
    static final Ink DARK = new Ink(0xFFAFB2BB, 0xFF2F3138, 0xFFA2B5FA, 0xFF282F47,
        new int[] { 0xFF364879, 0xFF175432, 0xFF6F3D19, 0xFF574071, 0xFF554A0B, 0xFF70384F, 0xFF065356, 0xFF454A54 },
        new int[] { 0xFF3C4871, 0xFF125443, 0xFF684123, 0xFF454954 },
        all(8, 0xFFE4E6EB), all(8, 0xFFC8CAD2), all(4, 0xFFE4E6EB), all(4, 0xFFC8CAD2));
    // 크리스마스(update78, 디자인 106판 '크리스마스 한 벌'): 앱의 크리스마스 칸 색(81판 '선명하게'). 짙은 칸(초록·청록·크랜베리, 전필·전선)은 흰 과목명과 옅은 같은 색 강의실
    static final Ink XMAS = new Ink(0xFF525E56, 0xFFD7E6DC, 0xFF0D6F44, 0xFFDEF8E7,
        new int[] { 0xFF1C6E47, 0xFFA1D6B2, 0xFFF7CD6C, 0xFF227A7E, 0xFF92182E, 0xFFFBEDD1, 0xFFD6E69D, 0xFFD5D4D1 },
        new int[] { 0xFF1C6E47, 0xFF227A7E, 0xFFF7CD6C, 0xFFD5D4D1 },
        new int[] { 0xFFFFFFFF, 0xFF17211B, 0xFF17211B, 0xFFFFFFFF, 0xFFFFFFFF, 0xFF17211B, 0xFF17211B, 0xFF17211B },
        new int[] { 0xFFCEE4D6, 0xFF45524A, 0xFF45524A, 0xFFDFFCFD, 0xFFD1B6B6, 0xFF45524A, 0xFF45524A, 0xFF45524A },
        new int[] { 0xFFFFFFFF, 0xFFFFFFFF, 0xFF17211B, 0xFF17211B },
        new int[] { 0xFFCEE4D6, 0xFFDFFCFD, 0xFF45524A, 0xFF45524A });

    /** 고른 한 벌(WidgetData.LIGHT·DARK·XMAS)의 색. 기본(DEVICE)은 부르는 쪽이 LIGHT·DARK 두 장을 그린다 */
    static Ink ink(int theme) {
        return theme == WidgetData.XMAS ? XMAS : theme == WidgetData.DARK ? DARK : LIGHT;
    }

    private static final float MAX_DENSITY = 2.5f; // 그림 크기를 줄여 위젯 갱신 자료를 가볍게(화소 밀도가 더 높은 폰은 살짝 키워 보인다)

    private WeekBitmap() {}

    static Bitmap draw(Context c, WidgetData.Term t, String colors, java.util.Calendar now, float widthDp, float heightDp, Ink ink, String[] dayNames) {
        android.util.DisplayMetrics screen = c.getResources().getDisplayMetrics();
        float dp = Math.min(screen.density, MAX_DENSITY);
        // 위젯 갱신의 그림 한도(화면 넓이 × 4바이트 × 1.5) 안에 두 장이 들게 한 장을 화면 넓이의 0.6 배까지로
        float area = Math.max(widthDp, 60) * Math.max(heightDp, 60) * dp * dp, cap = 0.6f * screen.widthPixels * screen.heightPixels;
        if (cap > 0 && area > cap) dp *= (float) Math.sqrt(cap / area);
        float font = WidgetData.weekFont(c.getResources().getConfiguration().fontScale);
        int w = Math.max(1, Math.round(Math.max(widthDp, 60) * dp)), h = Math.max(1, Math.round(Math.max(heightDp, 60) * dp));
        Bitmap bmp = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888);
        Canvas canvas = new Canvas(bmp);

        // 칸 자리는 WidgetData.WeekGrid(위젯의 누르는 칸도 같은 셈을 dp 로 쓴다: WidgetViews.week)
        WidgetData.WeekGrid g = new WidgetData.WeekGrid(t, w, h, dp, font);
        int days = g.days;
        int[] hrs = g.hours;
        float head = g.head, gutter = g.gutter;
        float colW = g.colW, hourH = g.hourH;
        int today = WidgetData.weekday(now);
        int day = WidgetData.ymd(now);
        boolean inTerm = t.from <= day && day <= t.to;

        Paint fill = new Paint(Paint.ANTI_ALIAS_FLAG);
        if (inTerm && today < days) { // 오늘 열
            fill.setColor(ink.accentWeak);
            canvas.drawRect(gutter + today * colW, 0, gutter + (today + 1) * colW, h, fill);
        }

        TextPaint label = new TextPaint(Paint.ANTI_ALIAS_FLAG);
        label.setTextSize(10 * dp * font);
        label.setTextAlign(Paint.Align.CENTER);
        for (int d = 0; d < days; d++) {
            boolean isToday = inTerm && d == today;
            label.setColor(isToday ? ink.accent : ink.text3);
            label.setTypeface(isToday ? Typeface.DEFAULT_BOLD : Typeface.DEFAULT);
            canvas.drawText(dayNames[d], gutter + (d + 0.5f) * colW, head - 5 * dp, label);
        }

        Paint line = new Paint();
        line.setColor(ink.line);
        line.setStrokeWidth(Math.max(1f, dp * 0.75f));
        TextPaint hourText = new TextPaint(Paint.ANTI_ALIAS_FLAG);
        hourText.setTextSize(8.5f * dp * font);
        hourText.setColor(ink.text3);
        hourText.setTextAlign(Paint.Align.RIGHT);
        for (int hr = hrs[0]; hr <= hrs[1]; hr++) {
            float y = head + (hr - hrs[0]) * hourH;
            canvas.drawLine(gutter, y, w, y, line);
            if (hr < hrs[1]) canvas.drawText(String.valueOf(hr), gutter - 3 * dp, y + hourText.getTextSize(), hourText);
        }

        TextPaint name = new TextPaint(Paint.ANTI_ALIAS_FLAG);
        name.setTextSize(9.5f * dp * font);
        name.setTypeface(Typeface.DEFAULT_BOLD);
        name.setTextLocale(Locale.KOREAN); // 기기 언어가 한국어가 아니어도 한국어 줄바꿈(어절)과 한자 모양
        TextPaint place = new TextPaint(Paint.ANTI_ALIAS_FLAG);
        place.setTextSize(8.5f * dp * font);
        place.setTextLocale(Locale.KOREAN);
        float radius = 4 * dp, pad = 3 * dp;
        RectF box = new RectF();
        for (int d = 0; d < days; d++) {
            List<WidgetData.Lesson> list = t.days.get(d);
            int[] lane = new int[list.size()], lanes = new int[list.size()];
            WidgetData.laneOf(list, lane, lanes);
            for (int i = 0; i < list.size(); i++) {
                WidgetData.Lesson l = list.get(i);
                float[] b = g.box(d, l, lane[i], lanes[i]);
                box.set(b[0], b[1], b[2], b[3]);
                boolean byCls = "cls".equals(colors);
                int k = byCls ? clsIndex(l.cls) : Math.floorMod(l.color, ink.items.length);
                fill.setColor(byCls ? ink.cls[k] : ink.items[k]);
                canvas.drawRoundRect(box, radius, radius, fill);
                name.setColor(byCls ? ink.clsFg[k] : ink.itemFg[k]); // 칸마다의 글자색(크리스마스의 짙은 칸은 흰 글자)
                place.setColor(byCls ? ink.clsFg2[k] : ink.itemFg2[k]);
                drawText(canvas, box, pad, l, name, place);
            }
        }
        return bmp;
    }

    static int clsIndex(String cls) {
        switch (cls) {
            case "req": return 0;
            case "elec": return 1;
            case "gen": return 2;
            default: return 3;
        }
    }

    /** 칸 안: 과목명(들어가는 만큼 줄, 넘치면 …), 남는 줄에 강의실 */
    private static void drawText(Canvas canvas, RectF box, float pad, WidgetData.Lesson l, TextPaint name, TextPaint place) {
        int width = (int) (box.width() - 2 * pad);
        float height = box.height() - 2 * pad;
        if (width <= 4 || height < name.getTextSize() * 0.9f) return;
        int nameLines = Math.max(1, (int) (height / (name.getTextSize() * 1.2f)));
        boolean withPlace = !l.place.isEmpty() && nameLines >= 2;
        String text = WidgetData.glueTail(l.name, s -> name.measureText(s) <= width - 1);
        StaticLayout title = layout(text, name, width, withPlace ? nameLines - 1 : nameLines);
        canvas.save();
        canvas.clipRect(box);
        canvas.translate(box.left + pad, box.top + pad);
        title.draw(canvas);
        if (withPlace && title.getHeight() + place.getTextSize() * 1.2f <= height) {
            canvas.translate(0, title.getHeight() + pad / 2);
            layout(l.place, place, width, 1).draw(canvas);
        }
        canvas.restore();
    }

    private static StaticLayout layout(String text, TextPaint paint, int width, int maxLines) {
        StaticLayout.Builder b = StaticLayout.Builder.obtain(text, 0, text.length(), paint, width)
            .setAlignment(Layout.Alignment.ALIGN_NORMAL)
            .setIncludePad(false)
            .setMaxLines(maxLines)
            .setEllipsize(TextUtils.TruncateAt.END);
        if (Build.VERSION.SDK_INT >= 33) Api33.phrase(b);
        return b.build();
    }

    /** 안드로이드 13 이상에만 있는 것(그 아래 기기는 이 클래스를 읽지 않는다) */
    private static final class Api33 {
        /** 위젯 글(TextView)의 lineBreakWordStyle="phrase" 와 같은 줄바꿈: '보여 / 요' 처럼 낱말 가운데서 끊지 않는다 */
        static void phrase(StaticLayout.Builder b) {
            b.setLineBreakConfig(new LineBreakConfig.Builder().setLineBreakWordStyle(LineBreakConfig.LINE_BREAK_WORD_STYLE_PHRASE).build());
        }
    }

    /** 스크린리더에 읽을 한 주: '월 09:30 생명과학 1 26동 104호, 13:00 대학 글쓰기 1. 화 …' */
    static String describe(WidgetData.Term t, String[] dayNames) {
        StringBuilder out = new StringBuilder();
        for (int d = 0; d < 7; d++) {
            List<WidgetData.Lesson> list = t.days.get(d);
            if (list.isEmpty()) continue;
            if (out.length() > 0) out.append(". ");
            out.append(dayNames[d]);
            for (int i = 0; i < list.size(); i++) {
                WidgetData.Lesson l = list.get(i);
                out.append(i == 0 ? " " : ", ").append(WidgetData.hm(l.start)).append(' ').append(l.name);
                if (!l.place.isEmpty()) out.append(' ').append(l.place);
            }
        }
        return out.toString();
    }
}
