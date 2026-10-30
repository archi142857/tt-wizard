package com.ttwizard.app;

import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.os.Bundle;

/** 홈 화면 위젯 '다음 수업'(2×2) — 그리기는 WidgetViews.next, 때 잡기는 WidgetUpdater */
public class NextClassWidget extends AppWidgetProvider {

    @Override
    public void onUpdate(Context context, AppWidgetManager manager, int[] ids) {
        WidgetUpdater.update(context, manager, ids, WidgetUpdater.NEXT);
    }

    @Override
    public void onAppWidgetOptionsChanged(Context context, AppWidgetManager manager, int id, Bundle options) {
        WidgetUpdater.update(context, manager, new int[] { id }, WidgetUpdater.NEXT);
    }

    @Override
    public void onDisabled(Context context) {
        WidgetUpdater.reschedule(context);
    }
}
