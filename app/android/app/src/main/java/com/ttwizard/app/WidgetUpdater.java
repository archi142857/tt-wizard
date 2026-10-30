package com.ttwizard.app;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.content.BroadcastReceiver;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.util.Log;
import java.util.Calendar;

/**
 * 홈 화면 위젯 넷(다음 수업·오늘 수업·주간 시간표, update71 의 동선 지도)을 다시 그리고 다음 때를 잡는다 — 백엔드 세션(10/30).
 *   자료: 화면이 넘긴 위젯 자료(WidgetData, JSON)를 이 앱의 SharedPreferences("ttw_widgets")에 둔다. 기기 밖으로 보내지 않는다.
 *   다시 그리는 때: 오늘 남은 수업의 시작·끝과 다음 날 0시(WidgetData.nextChange). 부정확 알람(AlarmManager.setWindow, RTC: 기기를 깨우지 않고
 *   화면이 켜질 때 온다)이라 정확한 알람 권한이 없다(법무: USE_EXACT_ALARM 은 쓰지 않는다). 창은 10분(안드로이드 12 이상의 가장 짧은 창)이라
 *   늦으면 10분쯤 늦게 바뀐다. 위젯 정보의 updatePeriodMillis(3시간)와 시각·시간대 바뀜·앱 업데이트(이 받는 곳의 intent-filter)가 받침이다.
 * 이 클래스는 알람과 시각 바뀜을 받는 BroadcastReceiver 이기도 하다(AndroidManifest.xml).
 */
public class WidgetUpdater extends BroadcastReceiver {

    static final String ACTION_TICK = "com.ttwizard.app.action.WIDGET_TICK";
    static final int NEXT = 0;
    static final int TODAY = 1;
    static final int WEEK = 2;
    static final int MAP = 3;

    private static final String TAG = "TTWWidget";
    private static final String PREFS = "ttw_widgets";
    private static final String KEY_DATA = "data";
    private static final long WINDOW_MS = 10 * 60 * 1000L;
    private static final Class<?>[] PROVIDERS = { NextClassWidget.class, TodayWidget.class, WeekWidget.class, DayMapWidget.class };

    @Override
    public void onReceive(Context context, Intent intent) {
        refreshAll(context);
    }

    private static SharedPreferences prefs(Context c) {
        return c.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    /** 화면이 넘긴 자료를 둔다. 전과 같으면 false(다시 그릴 일 없음) */
    static boolean save(Context c, String json) {
        if (json.equals(prefs(c).getString(KEY_DATA, null))) return false;
        prefs(c).edit().putString(KEY_DATA, json).apply();
        return true;
    }

    static WidgetData load(Context c) {
        return WidgetData.parse(prefs(c).getString(KEY_DATA, null));
    }

    static int[] ids(Context c, int kind) {
        int[] ids = AppWidgetManager.getInstance(c).getAppWidgetIds(new ComponentName(c, PROVIDERS[kind]));
        return ids != null ? ids : new int[0];
    }

    /** 홈 화면에 놓인 위젯 수(넷을 더한 것) */
    static int placed(Context c) {
        int n = 0;
        for (int k = 0; k < PROVIDERS.length; k++) n += ids(c, k).length;
        return n;
    }

    /** 놓인 위젯 모두 */
    static void refreshAll(Context c) {
        AppWidgetManager m = AppWidgetManager.getInstance(c);
        WidgetData d = load(c);
        Calendar now = Calendar.getInstance();
        for (int k = 0; k < PROVIDERS.length; k++) render(c, m, ids(c, k), k, d, now);
        schedule(c, d, now);
    }

    /** 한 종류의 위젯 몇 개(새로 놓았거나 크기를 바꿨을 때) */
    static void update(Context c, AppWidgetManager m, int[] ids, int kind) {
        WidgetData d = load(c);
        Calendar now = Calendar.getInstance();
        render(c, m, ids, kind, d, now);
        schedule(c, d, now);
    }

    /** 위젯을 다 치웠으면 알람도 거둔다 */
    static void reschedule(Context c) {
        schedule(c, load(c), Calendar.getInstance());
    }

    private static void render(Context c, AppWidgetManager m, int[] ids, int kind, WidgetData d, Calendar now) {
        for (int id : ids) {
            try {
                m.updateAppWidget(id, WidgetViews.build(c, kind, d, now, m.getAppWidgetOptions(id)));
            } catch (RuntimeException e) {
                Log.w(TAG, "widget " + kind + " not drawn", e); // 그리던 것이 그대로 남는다
            }
        }
    }

    private static void schedule(Context c, WidgetData d, Calendar now) {
        AlarmManager alarms = (AlarmManager) c.getSystemService(Context.ALARM_SERVICE);
        if (alarms == null) return;
        Intent tick = new Intent(c, WidgetUpdater.class).setAction(ACTION_TICK);
        PendingIntent pi = PendingIntent.getBroadcast(c, 0, tick, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        if (placed(c) == 0) {
            alarms.cancel(pi);
            return;
        }
        long at;
        if (d != null) {
            at = d.nextChange(now);
        } else {
            Calendar midnight = WidgetData.startOfDay(now);
            midnight.add(Calendar.DAY_OF_MONTH, 1);
            at = midnight.getTimeInMillis();
        }
        alarms.setWindow(AlarmManager.RTC, at, WINDOW_MS, pi);
    }
}
