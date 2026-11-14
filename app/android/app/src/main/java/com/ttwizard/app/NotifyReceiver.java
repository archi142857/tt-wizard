package com.ttwizard.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** 폰 알림의 알람을 받는 곳(Notifier 가 건다. 밖에서 부를 수 없다: exported=false) — 백엔드 세션(update109) */
public class NotifyReceiver extends BroadcastReceiver {

    static final String ACTION_CLASS = "com.ttwizard.app.NOTIFY_CLASS";
    static final String ACTION_BOOK = "com.ttwizard.app.NOTIFY_BOOK";

    @Override
    public void onReceive(Context context, Intent intent) {
        String action = intent.getAction();
        if (ACTION_CLASS.equals(action)) {
            Notifier.fireClass(context);
        } else if (ACTION_BOOK.equals(action)) {
            final PendingResult pending = goAsync(); // 네트워크는 다른 스레드에서(받는 곳은 짧게 끝나야 한다)
            final Context app = context.getApplicationContext();
            new Thread(() -> {
                try {
                    Notifier.checkBook(app);
                } finally {
                    pending.finish();
                }
            }, "ttw-book").start();
        }
    }
}
