package com.ttwizard.app;

import android.Manifest;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import org.json.JSONObject;

/**
 * 폰 알림 설정 — 백엔드 세션(update109). 화면은 app/src/native.js 의 TTW_APP.notify 로 부른다(디자인 '폰 알림' 01).
 *   state    → { permission: "granted"|"denied"|"prompt", classOn, lead, bookOn, channels: { class, book } }
 *   request  안드로이드 13 이상에서 아직 묻지 않았으면 폰이 알림 권한을 묻는다(스위치를 처음 켤 때만 부른다. 앱을 처음 켤 때 묻지 않는다) → state
 *   settings 폰의 이 앱 알림 설정을 연다('폰 알림 권한 꺼짐 ↗')
 *   update   { classOn?, lead?, bookOn?, periods? } 준 값만 바꾸고 알람을 다시 건다 → state. periods 는 앱 연결이 학사 일정에서 넘긴다
 * 알림 권한 말고 다른 권한은 없다. 값은 이 기기에만 둔다.
 */
@CapacitorPlugin(name = "TTWNotify", permissions = { @Permission(alias = "notifications", strings = { Manifest.permission.POST_NOTIFICATIONS }) })
public class NotifyPlugin extends Plugin {

    @PluginMethod
    public void state(PluginCall call) {
        call.resolve(stateOf());
    }

    @PluginMethod
    public void request(PluginCall call) {
        if (Build.VERSION.SDK_INT >= 33 && getPermissionState("notifications") != PermissionState.GRANTED) {
            requestPermissionForAlias("notifications", call, "afterRequest");
            return;
        }
        call.resolve(stateOf());
    }

    @PermissionCallback
    private void afterRequest(PluginCall call) {
        Notifier.rearm(getContext());
        call.resolve(stateOf());
    }

    @PluginMethod
    public void settings(PluginCall call) {
        String pkg = getContext().getPackageName();
        Intent i = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
            ? new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, pkg)
            : new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + pkg));
        try {
            if (getActivity() != null) getActivity().startActivity(i); // 우리 작업 위에 열어 돌아오면 앱이 그대로
            else getContext().startActivity(i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
            call.resolve();
        } catch (RuntimeException e) {
            call.reject("settings not opened", "FAILED");
        }
    }

    @PluginMethod
    public void update(PluginCall call) {
        JSObject periods = call.getObject("periods");
        Notifier.set(getContext(), call.getBoolean("classOn"), call.getInt("lead"), call.getBoolean("bookOn"),
            periods == null ? null : (JSONObject) periods);
        Notifier.rearm(getContext());
        call.resolve(stateOf());
    }

    private JSObject stateOf() {
        String permission;
        if (Build.VERSION.SDK_INT >= 33) {
            PermissionState s = getPermissionState("notifications");
            permission = s == PermissionState.GRANTED ? "granted" : s == PermissionState.DENIED ? "denied" : "prompt";
        } else {
            permission = "granted";
        }
        if ("granted".equals(permission) && !Notifier.allowed(getContext())) permission = "denied"; // 폰 설정에서 이 앱 알림을 껐다
        JSObject channels = new JSObject();
        channels.put("class", Notifier.channelOn(getContext(), Notifier.CLASS));
        channels.put("book", Notifier.channelOn(getContext(), Notifier.BOOK));
        JSObject ret = new JSObject();
        ret.put("permission", permission);
        ret.put("classOn", Notifier.classOn(getContext()));
        ret.put("lead", Notifier.lead(getContext()));
        ret.put("bookOn", Notifier.bookOn(getContext()));
        ret.put("channels", channels);
        return ret;
    }
}
