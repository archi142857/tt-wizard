package com.ttwizard.app;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * 홈 화면 위젯에 자료를 넘기는 곳 — 백엔드 세션(10/30). 화면은 app/src/native.js 의 TTW_APP.updateWidgets 로 부른다.
 *   update  { data: 위젯 자료 JSON(web/js/timetables.js 의 widgetData) } → 기기 안(SharedPreferences)에 두고 놓인 위젯을 다시 그린다.
 *           전과 같은 자료면 다시 그리지 않고 알람만 다시 건다. 깨진 자료는 "BAD_DATA". → { placed: 놓인 위젯 수, changed }
 *   info    { placed }
 * 권한을 쓰지 않는다. 자료는 기기 밖으로 나가지 않는다.
 */
@CapacitorPlugin(name = "TTWWidget")
public class WidgetPlugin extends Plugin {

    @PluginMethod
    public void update(PluginCall call) {
        String data = call.getString("data");
        if (WidgetData.parse(data) == null) {
            call.reject("bad widget data", "BAD_DATA");
            return;
        }
        try {
            boolean changed = WidgetUpdater.save(getContext(), data);
            if (changed) WidgetUpdater.refreshAll(getContext());
            else WidgetUpdater.reschedule(getContext()); // 같은 자료여도 알람은 다시 건다(앱을 강제 종료하면 알람이 지워진다)
            JSObject ret = new JSObject();
            ret.put("placed", WidgetUpdater.placed(getContext()));
            ret.put("changed", changed);
            call.resolve(ret);
        } catch (RuntimeException e) {
            call.reject(e.getMessage() != null ? e.getMessage() : "widget update failed", "FAILED");
        }
    }

    @PluginMethod
    public void info(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("placed", WidgetUpdater.placed(getContext()));
        call.resolve(ret);
    }
}
