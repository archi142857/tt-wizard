package com.ttwizard.app;

import android.app.ActivityManager;
import android.app.KeyguardManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.PowerManager;
import android.util.Log;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.List;

/**
 * 계절 앱 아이콘 — 백엔드 세션(update108, 디자인 125판). 12월 한 달(기기 날짜)은 크리스마스 아이콘, 그 밖에는 기본 아이콘.
 *   안드로이드 11(API 30) 이상만 바꾼다. 알림·끄기 없음(법무 11/13: 날짜로 저절로 바꿔도 되고, 우리가 그린 흔한 소재만).
 *   아이콘은 런처 별칭 둘(AndroidManifest.xml)이다: DEFAULT(켜짐. 예전 판의 런처 이름 그대로라 업데이트해도 홈 화면 아이콘이 남는다)와
 *   XMAS(꺼짐). 둘 다 AppActivity 를 연다. 12월에는 XMAS 를 켜고 DEFAULT 를 끄고, 그 밖에는 둘 다 매니페스트 값으로 되돌린다.
 *   켜는 쪽을 먼저(안드로이드 13 이상은 한 번에) 바꿔 런처 아이콘이 없는 때가 없게 한다.
 *   바꾸는 때는 앱이 안 보일 때만: AppActivity.onStop, WidgetUpdater(위젯 0시 알람, 기기 시각·시간대 바뀜, 앱 업데이트).
 *   별칭을 끄면 그 별칭으로 연 작업이 최근 앱에서 지워진다(다음에 누르면 새로 켜진다). 그래서 사용자가 곧 이 작업으로 돌아올 수 있을 때는
 *   바꾸지 않고 다음 때를 기다린다: 앱이 보일 때, 우리 작업 맨 위에 다른 앱 화면(앱 안 브라우저·사진 고르기·공유 창)이 있을 때,
 *   화면이 꺼졌거나 잠겼을 때(켜고 풀면 앱이 그대로 있어야 한다).
 * 이 별칭을 빼는 판을 내더라도 DEFAULT 를 매니페스트 값으로 되돌리는 이 코드는 남긴다. 12월에 DEFAULT 가 꺼진 채 업데이트하면 런처 아이콘이 없어진다.
 */
final class LauncherIcon {

    /** 런처 별칭(AndroidManifest.xml 의 activity-alias. 앱 아이디 com.ttwizard.app 은 바뀌지 않는다) */
    static final String DEFAULT = "com.ttwizard.app.MainActivity";
    static final String XMAS = "com.ttwizard.app.MainActivityXmas";

    private static final String TAG = "TTWIcon";

    private LauncherIcon() {}

    /** 이 기기에서 이달에 켤 별칭. month 는 1~12(기기 날짜) */
    static String wanted(int sdk, int month) {
        return sdk >= Build.VERSION_CODES.R && month == 12 ? XMAS : DEFAULT;
    }

    /** 이달에 켤 별칭과 지금이 다르면 바꾼다. 사용자가 곧 이 작업으로 돌아올 수 있으면 하지 않는다 */
    static void sync(Context c) {
        sync(c, Calendar.getInstance().get(Calendar.MONTH) + 1);
    }

    /** month(1~12, 기기 날짜)의 별칭으로 */
    static void sync(Context c, int month) {
        try {
            boolean xmas = XMAS.equals(wanted(Build.VERSION.SDK_INT, month));
            PackageManager pm = c.getPackageManager();
            ComponentName def = new ComponentName(c, DEFAULT);
            ComponentName season = new ComponentName(c, XMAS);
            int defState = pm.getComponentEnabledSetting(def);
            int seasonState = pm.getComponentEnabledSetting(season);
            int on = PackageManager.COMPONENT_ENABLED_STATE_ENABLED;
            int off = PackageManager.COMPONENT_ENABLED_STATE_DISABLED;
            int back = PackageManager.COMPONENT_ENABLED_STATE_DEFAULT; // 매니페스트 값: DEFAULT 켜짐, XMAS 꺼짐
            if (xmas ? (seasonState == on && defState == off) : (seasonState == back && defState == back)) return; // 이미 맞다
            if (AppActivity.visible() || mayComeBack(c)) return;
            // 켜는 쪽 먼저
            ComponentName first = xmas ? season : def;
            ComponentName second = xmas ? def : season;
            int firstState = xmas ? on : back;
            int secondState = xmas ? off : back;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                List<PackageManager.ComponentEnabledSetting> both = new ArrayList<>();
                both.add(new PackageManager.ComponentEnabledSetting(first, firstState, PackageManager.DONT_KILL_APP));
                both.add(new PackageManager.ComponentEnabledSetting(second, secondState, PackageManager.DONT_KILL_APP));
                pm.setComponentEnabledSettings(both); // 한 번에(런처가 바뀜을 한 번만 받는다)
            } else {
                pm.setComponentEnabledSetting(first, firstState, PackageManager.DONT_KILL_APP);
                pm.setComponentEnabledSetting(second, secondState, PackageManager.DONT_KILL_APP);
            }
            Log.i(TAG, xmas ? "launcher icon: xmas" : "launcher icon: default");
        } catch (RuntimeException e) {
            Log.w(TAG, "launcher icon not changed", e); // 다음 때 다시 본다
        }
    }

    /** 화면이 꺼졌거나 잠겼으면, 또는 우리 작업 맨 위가 다른 앱 화면이면(앱 안 브라우저·사진 고르기·공유 창) 사용자가 곧 이 작업으로 돌아올 수 있다 */
    private static boolean mayComeBack(Context c) {
        PowerManager power = (PowerManager) c.getSystemService(Context.POWER_SERVICE);
        KeyguardManager keyguard = (KeyguardManager) c.getSystemService(Context.KEYGUARD_SERVICE);
        if (power != null && !power.isInteractive()) return true;
        if (keyguard != null && keyguard.isKeyguardLocked()) return true;
        ActivityManager am = (ActivityManager) c.getSystemService(Context.ACTIVITY_SERVICE);
        if (am == null) return true;
        for (ActivityManager.AppTask task : am.getAppTasks()) {
            ComponentName top = task.getTaskInfo().topActivity;
            if (top != null && !c.getPackageName().equals(top.getPackageName())) return true;
        }
        return false;
    }
}
