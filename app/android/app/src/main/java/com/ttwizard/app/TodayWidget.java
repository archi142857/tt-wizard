package com.ttwizard.app;

import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.os.Bundle;

/** 홈 화면 위젯 '오늘 수업'(4×2, 4×4 까지) — 그리기는 WidgetViews.today(높이만큼 행), 때 잡기는 WidgetUpdater */
public class TodayWidget extends AppWidgetProvider {

    @Override
    public void onUpdate(Context context, AppWidgetManager manager, int[] ids) {
        WidgetUpdater.update(context, manager, ids, WidgetUpdater.TODAY);
    }

    @Override
    public void onAppWidgetOptionsChanged(Context context, AppWidgetManager manager, int id, Bundle options) {
        WidgetUpdater.update(context, manager, new int[] { id }, WidgetUpdater.TODAY);
    }

    @Override
    public void onDisabled(Context context) {
        WidgetUpdater.reschedule(context);
    }
}
