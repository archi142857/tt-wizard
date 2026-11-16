package com.ttwizard.app;

import android.app.Activity;
import android.content.Context;
import android.content.SharedPreferences;
import android.os.Handler;
import android.os.Looper;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.android.play.core.appupdate.AppUpdateInfo;
import com.google.android.play.core.appupdate.AppUpdateManager;
import com.google.android.play.core.appupdate.AppUpdateManagerFactory;
import com.google.android.play.core.appupdate.AppUpdateOptions;
import com.google.android.play.core.install.InstallState;
import com.google.android.play.core.install.InstallStateUpdatedListener;
import com.google.android.play.core.install.model.AppUpdateType;
import com.google.android.play.core.install.model.InstallStatus;
import com.google.android.play.core.install.model.UpdateAvailability;

/**
 * 앱 안 업데이트(안드로이드, update118) — 백엔드 세션(사용자 11/15 '업데이트가 있다고 알려 주는 창'). Google Play 의 앱 내 업데이트(유연한 업데이트)를 쓴다.
 *   1) 앱이 앞에 올 때(켤 때·돌아올 때) Play 에 새 판이 있는지 본다. 있으면 화면이 뜬 뒤 Play 의 업데이트 창을 띄운다
 *      (UpdatePolicy: 같은 판은 하루 한 번, '나중에' 뒤 3일 쉼). 창과 글은 Play 의 것이다. 받는 동안 앱은 그대로 쓴다.
 *   2) 다 받으면 화면에 알린다('state' 이벤트 → native.js 의 'ttw:app-update'). 화면이 '다시 시작'을 부르면(complete) Play 가 깔고 앱을 다시 연다.
 *   3) 화면이 묻지 않아도 사용자가 앱을 내리면(홈·다른 앱·뒤로 가기로 닫기) Play 가 조용히 깐다. 다음에 켜면 새 판이다.
 *      이 앱이 연 창(사진 고르기·공유 시트·로그인·링크·설정)에 가려진 것과 화면이 꺼지거나 잠긴 것은 내린 것으로 보지 않는다(돌아왔을 때 앱이 처음부터 다시 뜨지 않게.
 *      계절 아이콘과 같은 잣대 LauncherIcon.mayComeBack 에 '방금 이 앱이 창을 열었나'(AppActivity.launchedOwnRecently)를 더한다).
 * Play 스토어에서 받지 않은 앱(디버그·직접 깐 APK)이나 Play 스토어가 없는 기기는 Play 가 알려 주지 않아 아무것도 하지 않는다(status "none").
 * 개발자에게 가는 것은 없다. Play 는 새 판이 있는지와 크기를 셈하려고 기기 정보·앱 판을 받는다(Play 문서 '데이터 보안', docs/app.md '앱 안 업데이트').
 *
 * 화면(app/src/native.js 의 TTW_APP.appUpdate)이 부르는 것:
 *   state     → { status, versionCode, staleDays, progress }
 *               status: none(새 판 없음·알 수 없음) · available(새 판 있음, 아직 안 받음) · pending · downloading · downloaded · installing · failed
 *               versionCode: Play 에 있는 새 판(없으면 0) · staleDays: 새 판이 Play 에 나온 지 며칠(모르면 -1) · progress: 받은 몫 0~1(모르면 -1)
 *   start     지금 Play 의 업데이트 창을 띄운다(물음 규칙을 타지 않는다: 화면의 '업데이트' 단추) → state + { result: accepted | declined | failed | none }
 *   complete  받은 업데이트를 깐다(앞에서 부르면 Play 가 온 화면을 덮고 깐 뒤 앱을 다시 연다). 받은 것이 없으면 "NOT_READY" 로 거절
 * 'state' 이벤트는 값이 바뀔 때마다(받는 몫은 1% 단위) 보낸다.
 */
@CapacitorPlugin(name = "TTWUpdate")
public class UpdatePlugin extends Plugin {

    private static final String PREFS = "ttw_update";
    /** 앱을 켠 뒤 처음 물을 때까지(시작 화면·첫 화면이 뜬 뒤) */
    private static final long FIRST_DELAY_MS = 3000;
    /** 앱으로 돌아왔을 때 물을 때까지 */
    private static final long RESUME_DELAY_MS = 1500;
    /** 이 앱이 다른 창을 연 지 이만큼 안에 가려지면 사용자가 앱을 내린 것이 아니다(AppActivity.launchedOwnRecently) */
    private static final long OWN_LAUNCH_MS = 3000;

    private final Handler main = new Handler(Looper.getMainLooper());
    private AppUpdateManager manager;
    private InstallStateUpdatedListener listener;
    private boolean firstResume = true;
    private boolean resumed;
    /** 사용자가 앱을 내렸다(홈·다른 앱·닫기). 다시 앞에 오면 false */
    private boolean leftByUser;
    private boolean asking;
    private boolean completing;

    private String status = "none";
    private int versionCode;
    private int staleDays = -1;
    private double progress = -1;
    private String lastSent;

    private final Runnable autoCheck = () -> check(true);

    @Override
    public void load() {
        try {
            manager = AppUpdateManagerFactory.create(getContext());
            listener = this::onInstallState;
            manager.registerListener(listener);
        } catch (Exception e) {
            manager = null; // Play 라이브러리를 못 쓰는 기기: 아무것도 하지 않는다
        }
    }

    @Override
    protected void handleOnResume() {
        resumed = true;
        leftByUser = false;
        main.removeCallbacks(autoCheck);
        main.postDelayed(autoCheck, firstResume ? FIRST_DELAY_MS : RESUME_DELAY_MS);
        firstResume = false;
    }

    @Override
    protected void handleOnPause() {
        resumed = false;
        main.removeCallbacks(autoCheck);
    }

    @Override
    protected void handleOnStop() {
        Activity activity = getActivity();
        boolean finishing = activity == null || activity.isFinishing();
        leftByUser = finishing || !mayComeBack();
        if (leftByUser && "downloaded".equals(status)) main.post(() -> completeNow(null));
    }

    @Override
    protected void handleOnDestroy() {
        main.removeCallbacks(autoCheck);
        if (manager != null && listener != null) {
            try {
                manager.unregisterListener(listener);
            } catch (Exception ignored) {
                // 이미 풀렸다
            }
        }
    }

    // ------------------------------------------------------------ 화면이 부르는 것

    @PluginMethod
    public void state(PluginCall call) {
        if (manager == null) {
            call.resolve(stateObject());
            return;
        }
        main.post(() -> manager.getAppUpdateInfo()
                .addOnSuccessListener(info -> {
                    read(info);
                    emit();
                    call.resolve(stateObject());
                })
                .addOnFailureListener(e -> call.resolve(stateObject())));
    }

    @PluginMethod
    public void start(PluginCall call) {
        if (manager == null) {
            call.resolve(result("none"));
            return;
        }
        main.post(() -> manager.getAppUpdateInfo()
                .addOnSuccessListener(info -> {
                    read(info);
                    emit();
                    if (!canAsk(info)) {
                        boolean busy = "pending".equals(status) || "downloading".equals(status) || "downloaded".equals(status) || "installing".equals(status);
                        call.resolve(result(busy ? "accepted" : "none"));
                        return;
                    }
                    ask(info, call);
                })
                .addOnFailureListener(e -> call.resolve(result("none"))));
    }

    @PluginMethod
    public void complete(PluginCall call) {
        main.post(() -> {
            if (manager == null || !"downloaded".equals(status)) {
                call.reject("no downloaded update", "NOT_READY");
                return;
            }
            completeNow(call);
        });
    }

    // ------------------------------------------------------------ 안

    /** 앱이 앞에 온 뒤: 받은 업데이트가 있으면 화면에 알리고, 새 판이 있고 물어도 되면 Play 의 창을 띄운다 */
    private void check(boolean auto) {
        if (manager == null) return;
        manager.getAppUpdateInfo()
                .addOnSuccessListener(info -> {
                    read(info);
                    emit();
                    if (!auto || !resumed || asking || !canAsk(info)) return;
                    SharedPreferences p = prefs();
                    if (!UpdatePolicy.shouldAsk(System.currentTimeMillis(), info.availableVersionCode(),
                            p.getInt("askedCode", 0), p.getLong("askedAt", 0), p.getLong("declinedAt", 0))) return;
                    ask(info, null);
                })
                .addOnFailureListener(e -> {
                    // Play 스토어에서 받지 않은 앱·Play 가 없는 기기: 알 수 없음(status 는 그대로 none)
                });
    }

    /** 유연한 업데이트를 지금 물을 수 있다: 새 판이 있고, 받는 중·받은 것이 없고, Play 가 허락한다 */
    private static boolean canAsk(AppUpdateInfo info) {
        int s = info.installStatus();
        boolean busy = s == InstallStatus.PENDING || s == InstallStatus.DOWNLOADING || s == InstallStatus.DOWNLOADED || s == InstallStatus.INSTALLING;
        return info.updateAvailability() == UpdateAvailability.UPDATE_AVAILABLE && !busy && info.isUpdateTypeAllowed(AppUpdateType.FLEXIBLE);
    }

    private void ask(AppUpdateInfo info, PluginCall call) {
        Activity activity = getActivity();
        if (activity == null || activity.isFinishing() || asking) {
            if (call != null) call.resolve(result("failed"));
            return;
        }
        asking = true;
        prefs().edit().putInt("askedCode", info.availableVersionCode()).putLong("askedAt", System.currentTimeMillis()).apply();
        AppActivity.markOwnLaunch(); // Play 의 창이 앱을 가려도 내린 것이 아니다
        manager.startUpdateFlow(info, activity, AppUpdateOptions.defaultOptions(AppUpdateType.FLEXIBLE))
                .addOnSuccessListener(code -> {
                    asking = false;
                    String r;
                    if (code != null && code == Activity.RESULT_OK) {
                        r = "accepted";
                        if ("available".equals(status)) status = "pending";
                    } else if (code != null && code == Activity.RESULT_CANCELED) {
                        r = "declined"; // '나중에'·닫기: 3일 쉰다(UpdatePolicy)
                        prefs().edit().putLong("declinedAt", System.currentTimeMillis()).apply();
                    } else {
                        r = "failed"; // RESULT_IN_APP_UPDATE_FAILED: 묻는 사이 앱이 닫혔거나 Play 가 못 띄웠다
                    }
                    emit();
                    if (call != null) call.resolve(result(r));
                })
                .addOnFailureListener(e -> {
                    asking = false;
                    if (call != null) call.resolve(result("failed"));
                });
    }

    private void onInstallState(InstallState s) {
        int st = s.installStatus();
        if (st == InstallStatus.CANCELED) {
            status = versionCode > 0 ? "available" : "none"; // 받기를 그만뒀다(Play 알림에서): 새 판은 그대로 있다
        } else if (st == InstallStatus.INSTALLED) {
            status = "none";
        } else {
            String name = statusName(st);
            if (name != null) status = name;
        }
        long total = s.totalBytesToDownload();
        progress = st == InstallStatus.DOWNLOADED ? 1 : (st == InstallStatus.DOWNLOADING && total > 0 ? Math.min(1, (double) s.bytesDownloaded() / total) : -1);
        emit();
        // 다 받았을 때 사용자가 앱을 내려 둔 채면(받는 동안 홈으로 나갔다) 바로 조용히 깐다
        if (st == InstallStatus.DOWNLOADED && leftByUser && !AppActivity.visible() && !mayComeBack()) main.post(() -> completeNow(null));
    }

    private void completeNow(PluginCall call) {
        if (manager == null || completing || !"downloaded".equals(status)) {
            if (call != null) call.resolve();
            return;
        }
        completing = true;
        status = "installing";
        emit();
        manager.completeUpdate()
                .addOnSuccessListener(v -> {
                    completing = false;
                    if (call != null) call.resolve();
                })
                .addOnFailureListener(e -> {
                    completing = false;
                    status = "downloaded";
                    emit();
                    if (call != null) call.reject(e.getMessage() != null ? e.getMessage() : "install failed", "FAILED");
                });
    }

    private void read(AppUpdateInfo info) {
        int avail = info.updateAvailability();
        boolean has = avail == UpdateAvailability.UPDATE_AVAILABLE || avail == UpdateAvailability.DEVELOPER_TRIGGERED_UPDATE_IN_PROGRESS;
        versionCode = has ? info.availableVersionCode() : 0;
        Integer days = info.clientVersionStalenessDays();
        staleDays = has && days != null ? days : -1;
        int st = info.installStatus();
        String name = statusName(st);
        if (name != null) status = name;
        else status = avail == UpdateAvailability.UPDATE_AVAILABLE ? "available" : "none";
        long total = info.totalBytesToDownload();
        progress = st == InstallStatus.DOWNLOADED ? 1 : (st == InstallStatus.DOWNLOADING && total > 0 ? Math.min(1, (double) info.bytesDownloaded() / total) : -1);
    }

    /** 받는 일의 상태 → 화면에 넘기는 이름. 받는 일과 상관없는 값(모름·깔림·그만둠)이면 null */
    private static String statusName(int st) {
        switch (st) {
            case InstallStatus.PENDING: return "pending";
            case InstallStatus.DOWNLOADING: return "downloading";
            case InstallStatus.DOWNLOADED: return "downloaded";
            case InstallStatus.INSTALLING: return "installing";
            case InstallStatus.FAILED: return "failed";
            default: return null;
        }
    }

    private JSObject stateObject() {
        JSObject o = new JSObject();
        o.put("status", status);
        o.put("versionCode", versionCode);
        o.put("staleDays", staleDays);
        o.put("progress", progress < 0 ? -1 : Math.floor(progress * 100) / 100.0);
        return o;
    }

    private JSObject result(String r) {
        JSObject o = stateObject();
        o.put("result", r);
        return o;
    }

    /** 바뀐 것만 화면에 보낸다(아직 듣는 곳이 없으면 들을 때까지 둔다) */
    private void emit() {
        JSObject o = stateObject();
        String json = o.toString();
        if (json.equals(lastSent)) return;
        lastSent = json;
        notifyListeners("state", o, true);
    }

    private SharedPreferences prefs() {
        return getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    /** 사용자가 곧 이 작업으로 돌아올 수 있다: 방금 이 앱이 다른 창을 열었거나, 화면이 꺼졌거나 잠겼거나, 우리 작업 맨 위가 다른 앱 화면이다 */
    private boolean mayComeBack() {
        return AppActivity.launchedOwnRecently(OWN_LAUNCH_MS) || LauncherIcon.mayComeBack(getContext());
    }
}
