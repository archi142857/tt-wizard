package com.ttwizard.app;

import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.os.Bundle;

/** 홈 화면 위젯 '동선 지도'(4×2, update71) — 그리기는 WidgetViews.map·DayMapBitmap(위젯 크기에 맞춘 그림), 때 잡기는 WidgetUpdater */
public class DayMapWidget extends AppWidgetProvider {

    @Override
    public void onUpdate(Context context, AppWidgetManager manager, int[] ids) {
        WidgetUpdater.update(context, manager, ids, WidgetUpdater.MAP);
    }

    @Override
    public void onAppWidgetOptionsChanged(Context context, AppWidgetManager manager, int id, Bundle options) {
        WidgetUpdater.update(context, manager, new int[] { id }, WidgetUpdater.MAP);
    }

    @Override
    public void onDisabled(Context context) {
        WidgetUpdater.reschedule(context);
    }
}
