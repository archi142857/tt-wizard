package com.ttwizard.app;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.AlarmManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.util.Log;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Calendar;
import java.util.Collections;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Iterator;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * 폰 알림 — 백엔드 세션(update109, 법무 11/13, 디자인 '폰 알림' 01·02). 서버 없이 기기 안에서만 알린다(알림 서버·토큰 없음).
 *   채널 둘(사용자가 따로 끈다): class '수업 알림'(대표 시간표 수업의 출발 시각, ClassAlerts), book '편람 알림'(새 학기 수강편람·담은 과목의 시간·강의실 바뀜, BookNews).
 *   잠금 화면은 VISIBILITY_PRIVATE + 공개 판('수업 알림 · 곧 출발 시각', '편람 알림 · 수강편람 소식')이라 기기의 '민감한 내용 숨기기'가 먹는다.
 *   작은 아이콘은 디자인 ic_stat_tt(흰 단색), 색은 테마와 상관없이 #415FEC(notify_accent).
 *   알람은 부정확한 것만(정확한 알람 권한 SCHEDULE_EXACT_ALARM·USE_EXACT_ALARM 없음):
 *     수업 알림 setAndAllowWhileIdle(RTC_WAKEUP) — 몇 분 늦게 올 수 있다('알림은 몇 분 늦게 올 수 있어요').
 *     편람 알림 하루 두 번(아침 8시·18시 반 무렵) setWindow(RTC, 한 시간 창, 기기를 깨우지 않는다)에 웹 자료 data/notify.json 을 받아 본다.
 *     밤 10시~아침 8시에는 알리지 않는다(디자인 129판 ⑤: 알람이 밤에 늦게 오면 받지 않고 아침 8시 무렵에 다시 본다).
 *     편람 알림은 처음부터 켜짐, 수업 알림은 꺼짐(디자인 129판 ①). 편람 알림을 저절로 켜는 것은 처리방침 11/27 판 시행일부터다(BOOK_DEFAULT_FROM).
 *     (처리방침 11/27 판 '편람 알림을 켜면 앱을 열지 않은 때에도 가끔 공개 자료를 받음').
 *   다시 거는 때: 앱이 위젯 자료를 넘길 때(앱을 켜고·내릴 때, WidgetPlugin), 설정을 바꿀 때(NotifyPlugin), WidgetUpdater 가 받을 때(위젯 알람·기기 시각 바뀜·앱 업데이트).
 *   부팅 권한은 쓰지 않는다: 폰을 다시 켜면 앱을 열거나 위젯이 다시 그려질 때까지 알람이 없다.
 *   켜고 끈 값·고른 시각은 이 기기(SharedPreferences ttw_notify)에만 둔다.
 */
final class Notifier {

    static final String CLASS = "class";
    static final String BOOK = "book";
    static final String NOTIFY_URL = "https://archi142857.github.io/tt-wizard/data/notify.json";

    private static final String TAG = "TTWNotify";
    private static final String PREFS = "ttw_notify";
    private static final String KEY_CLASS_ON = "class_on";
    private static final String KEY_LEAD = "lead";
    private static final String KEY_BOOK_ON = "book_on";
    private static final String KEY_PERIODS = "periods"; // {sem: {start, end, skip: ["YYYY-MM-DD"]}} 앱 연결이 학사 일정에서
    private static final String KEY_CLASS_LAST = "class_last"; // 이때까지의 수업 알림은 알렸다(ms)
    private static final String KEY_BOOK_SEEN = "book_seen"; // 마지막으로 본 바뀜 id
    private static final String KEY_BOOK_TERMS = "book_terms"; // 본 학기들(JSON 배열). 없으면 아직 처음
    private static final String KEY_BOOK_LAST = "book_last"; // 마지막으로 받아 본 때(ms)
    private static final long BOOK_WINDOW_MS = 60 * 60_000L; // 편람 알람의 창(BookNews.nextCheck 의 때부터 한 시간)
    private static final int MAX_BYTES = 512 * 1024;

    private Notifier() {}

    static SharedPreferences prefs(Context c) {
        return c.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    static boolean classOn(Context c) {
        return prefs(c).getBoolean(KEY_CLASS_ON, false);
    }

    static boolean bookOn(Context c) {
        return prefs(c).getBoolean(KEY_BOOK_ON, BookNews.onByDefault(Calendar.getInstance(java.util.TimeZone.getTimeZone("Asia/Seoul"))));
    }

    static int lead(Context c) {
        return ClassAlerts.lead(prefs(c).getInt(KEY_LEAD, ClassAlerts.DEFAULT_LEAD));
    }

    /** 화면이 바꾼 값(null 은 그대로). 켜거나 시각을 바꾸면 그 앞 알림은 알리지 않는다 */
    static void set(Context c, Boolean classOn, Integer lead, Boolean bookOn, JSONObject periods) {
        SharedPreferences p = prefs(c);
        SharedPreferences.Editor e = p.edit();
        long now = System.currentTimeMillis();
        if (classOn != null) {
            if (classOn && !p.getBoolean(KEY_CLASS_ON, false)) e.putLong(KEY_CLASS_LAST, now);
            e.putBoolean(KEY_CLASS_ON, classOn);
        }
        if (lead != null) {
            int l = ClassAlerts.lead(lead);
            if (l != p.getInt(KEY_LEAD, ClassAlerts.DEFAULT_LEAD)) e.putLong(KEY_CLASS_LAST, now);
            e.putInt(KEY_LEAD, l);
        }
        if (bookOn != null) {
            if (!bookOn) e.remove(KEY_BOOK_SEEN).remove(KEY_BOOK_TERMS).remove(KEY_BOOK_LAST); // 다시 켜면 그때부터 본다
            e.putBoolean(KEY_BOOK_ON, bookOn);
        }
        if (periods != null) e.putString(KEY_PERIODS, periods.toString());
        e.apply();
        if (Boolean.TRUE.equals(classOn) || Boolean.TRUE.equals(bookOn)) channels(c);
    }

    /** 학기마다 학사 일정(개강·종강, 수업 없는 날) */
    static Map<String, ClassAlerts.Period> periods(Context c) {
        Map<String, ClassAlerts.Period> out = new HashMap<>();
        try {
            JSONObject root = new JSONObject(prefs(c).getString(KEY_PERIODS, "{}"));
            for (Iterator<String> it = root.keys(); it.hasNext();) {
                String sem = it.next();
                JSONObject t = root.optJSONObject(sem);
                if (t == null) continue;
                int start = WidgetData.parseDay(t.optString("start")), end = WidgetData.parseDay(t.optString("end"));
                if (start < 0 || end < start) continue;
                Set<Integer> skip = new HashSet<>();
                JSONArray days = t.optJSONArray("skip");
                for (int i = 0; days != null && i < days.length(); i++) {
                    int d = WidgetData.parseDay(days.optString(i));
                    if (d > 0) skip.add(d);
                }
                out.put(sem, new ClassAlerts.Period(start, end, skip));
            }
        } catch (Exception e) {
            Log.w(TAG, "bad periods", e);
        }
        return out;
    }

    /** "granted" | "denied"(물었는데 거절했거나 폰 설정에서 이 앱 알림을 껐음) | "prompt"(아직 묻지 않음, 안드로이드 13 이상) */
    static boolean allowed(Context c) {
        if (Build.VERSION.SDK_INT >= 33
            && ContextCompat.checkSelfPermission(c, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return false;
        return NotificationManagerCompat.from(c).areNotificationsEnabled();
    }

    /** 채널이 켜져 있나(폰 설정에서 그 채널만 끌 수 있다). 안드로이드 8 아래는 채널이 없어 늘 켜짐 */
    static boolean channelOn(Context c, String id) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return true;
        NotificationManager m = c.getSystemService(NotificationManager.class);
        NotificationChannel ch = m == null ? null : m.getNotificationChannel(id);
        return ch == null || ch.getImportance() != NotificationManager.IMPORTANCE_NONE;
    }

    static void channels(Context c) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager m = c.getSystemService(NotificationManager.class);
        if (m == null) return;
        NotificationChannel a = new NotificationChannel(CLASS, c.getString(R.string.notify_class), NotificationManager.IMPORTANCE_DEFAULT);
        a.setDescription(c.getString(R.string.notify_class_desc));
        a.setLockscreenVisibility(Notification.VISIBILITY_PRIVATE);
        NotificationChannel b = new NotificationChannel(BOOK, c.getString(R.string.notify_book), NotificationManager.IMPORTANCE_DEFAULT);
        b.setDescription(c.getString(R.string.notify_book_desc));
        b.setLockscreenVisibility(Notification.VISIBILITY_PRIVATE);
        m.createNotificationChannels(Arrays.asList(a, b));
    }

    /** 알림 하나. 누르면 앱이 url 을 연다(위젯과 같은 길: AppActivity 의 ACTION_VIEW → native.js launchUrl) */
    @SuppressLint("MissingPermission") // allowed() 가 권한을 본다
    static void post(Context c, String channel, int id, String title, String text, String url) {
        if (!allowed(c)) return;
        channels(c);
        boolean cls = CLASS.equals(channel);
        int color = ContextCompat.getColor(c, R.color.notify_accent);
        Intent open = new Intent(Intent.ACTION_VIEW, Uri.parse(url), c, AppActivity.class);
        PendingIntent pi = PendingIntent.getActivity(c, id, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        Notification pub = new NotificationCompat.Builder(c, channel)
            .setSmallIcon(R.drawable.ic_stat_tt)
            .setColor(color)
            .setContentTitle(c.getString(cls ? R.string.notify_class : R.string.notify_book))
            .setContentText(c.getString(cls ? R.string.notify_class_public : R.string.notify_book_public))
            .build();
        NotificationCompat.Builder b = new NotificationCompat.Builder(c, channel)
            .setSmallIcon(R.drawable.ic_stat_tt)
            .setColor(color)
            .setContentTitle(title)
            .setContentIntent(pi)
            .setAutoCancel(true)
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
            .setPublicVersion(pub)
            .setPriority(NotificationCompat.PRIORITY_DEFAULT);
        if (cls) b.setCategory(NotificationCompat.CATEGORY_REMINDER);
        if (text != null && !text.isEmpty()) b.setContentText(text).setStyle(new NotificationCompat.BigTextStyle().bigText(text));
        try {
            NotificationManagerCompat.from(c).notify(id, b.build());
        } catch (SecurityException e) {
            Log.w(TAG, "notification not posted", e);
        }
    }

    private static PendingIntent alarm(Context c, String action, int code) {
        Intent i = new Intent(c, NotifyReceiver.class).setAction(action);
        return PendingIntent.getBroadcast(c, code, i, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }

    /** 수업 알람과 편람 알람을 다시 건다(끄거나 알림이 막혔으면 거둔다) */
    static void rearm(Context c) {
        try {
            AlarmManager alarms = (AlarmManager) c.getSystemService(Context.ALARM_SERVICE);
            if (alarms == null) return;
            SharedPreferences p = prefs(c);
            long now = System.currentTimeMillis();
            boolean ok = allowed(c);
            PendingIntent classPi = alarm(c, NotifyReceiver.ACTION_CLASS, 1);
            List<ClassAlerts.Alert> next = Collections.emptyList();
            if (ok && classOn(c)) {
                long last = p.getLong(KEY_CLASS_LAST, 0);
                if (last == 0 || last > now + 120_000L) { // 처음이거나 기기 시각이 뒤로 갔다
                    last = now;
                    p.edit().putLong(KEY_CLASS_LAST, last).apply();
                }
                next = ClassAlerts.next(WidgetUpdater.load(c), periods(c), lead(c), Calendar.getInstance(), last);
            }
            if (next.isEmpty()) alarms.cancel(classPi);
            else alarms.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, next.get(0).at, classPi);
            PendingIntent bookPi = alarm(c, NotifyReceiver.ACTION_BOOK, 2);
            if (ok && bookOn(c)) alarms.setWindow(AlarmManager.RTC, BookNews.nextCheck(now, p.getLong(KEY_BOOK_LAST, 0), p.contains(KEY_BOOK_TERMS)), BOOK_WINDOW_MS, bookPi);
            else alarms.cancel(bookPi);
        } catch (RuntimeException e) {
            Log.w(TAG, "alarms not set", e);
        }
    }

    /** 수업 알람이 왔다: 지금까지 알릴 것을 알리고 다음 알람을 건다 */
    static void fireClass(Context c) {
        SharedPreferences p = prefs(c);
        long now = System.currentTimeMillis();
        long last = p.getLong(KEY_CLASS_LAST, now);
        if (classOn(c) && allowed(c)) {
            for (ClassAlerts.Alert a : ClassAlerts.due(WidgetUpdater.load(c), periods(c), lead(c), Calendar.getInstance(), last)) {
                post(c, CLASS, a.id, a.title, a.text, a.url);
            }
        }
        p.edit().putLong(KEY_CLASS_LAST, Math.max(last, now + 60_000L)).apply();
        rearm(c);
    }

    /** 편람 알람이 왔다(메인 스레드가 아닌 곳에서 부른다: 네트워크) */
    static void checkBook(Context c) {
        SharedPreferences p = prefs(c);
        if (BookNews.quiet(System.currentTimeMillis()) && p.contains(KEY_BOOK_TERMS)) { // 밤에 늦게 온 알람: 받지 않고 아침 8시 무렵에 다시(디자인 129판 ⑤)
            rearm(c);
            return;
        }
        try {
            if (!bookOn(c) || !allowed(c)) return;
            String json = fetch(NOTIFY_URL);
            if (json != null) {
                List<String> terms = null;
                String raw = p.getString(KEY_BOOK_TERMS, null);
                if (raw != null) {
                    terms = new ArrayList<>();
                    JSONArray a = new JSONArray(raw);
                    for (int i = 0; i < a.length(); i++) terms.add(a.optString(i));
                }
                BookNews.Result r = BookNews.check(json, BookNews.watches(WidgetUpdater.load(c)), p.getString(KEY_BOOK_SEEN, null), terms);
                if (r != null) {
                    for (BookNews.Note n : r.notes) post(c, BOOK, n.id, n.title, n.text, n.url);
                    p.edit().putString(KEY_BOOK_SEEN, r.seen).putString(KEY_BOOK_TERMS, new JSONArray(r.terms).toString()).apply();
                }
            }
        } catch (Exception e) {
            Log.w(TAG, "book check failed", e);
        } finally {
            p.edit().putLong(KEY_BOOK_LAST, System.currentTimeMillis()).apply();
            rearm(c);
        }
    }

    /** 공개 자료 하나를 받는다(15초, 512 KB 까지). 못 받으면 null */
    static String fetch(String url) {
        HttpURLConnection con = null;
        try {
            con = (HttpURLConnection) new URL(url).openConnection();
            con.setConnectTimeout(15_000);
            con.setReadTimeout(15_000);
            con.setRequestProperty("Accept", "application/json");
            if (con.getResponseCode() != 200) return null;
            try (InputStream in = con.getInputStream()) {
                ByteArrayOutputStream out = new ByteArrayOutputStream();
                byte[] buf = new byte[8192];
                int n;
                while ((n = in.read(buf)) > 0) {
                    out.write(buf, 0, n);
                    if (out.size() > MAX_BYTES) return null;
                }
                return new String(out.toByteArray(), StandardCharsets.UTF_8);
            }
        } catch (Exception e) {
            Log.w(TAG, "fetch failed", e);
            return null;
        } finally {
            if (con != null) con.disconnect();
        }
    }
}
