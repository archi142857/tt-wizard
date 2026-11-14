package com.ttwizard.app;

import android.os.Bundle;
import android.webkit.WebView;
import androidx.core.content.ContextCompat;
import com.getcapacitor.BridgeActivity;

/**
 * 앱 화면(웹뷰 하나). 홈 화면·앱 서랍의 아이콘은 이 화면을 여는 런처 별칭 `.MainActivity`·`.MainActivityXmas` 다(AndroidManifest.xml, LauncherIcon).
 * update108 전에는 이 클래스가 MainActivity 였다. 런처 이름(.MainActivity)을 그대로 두려고 클래스 이름만 바꿨다: 홈 화면에 둔 아이콘이 그 이름을 가리킨다.
 * 위젯·시간표 링크(App Links)는 이 클래스로 바로 와서 별칭을 켜고 끄는 것과 상관없다.
 */
public class AppActivity extends BridgeActivity {

    /** 보이는 AppActivity 수(이 프로세스, 메인 스레드에서만). 계절 아이콘은 0일 때만 바꾼다 */
    private static int started;

    static boolean visible() {
        return started > 0;
    }

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // 이 앱 안의 플러그인(super.onCreate 보다 먼저 등록한다)
        registerPlugin(ImagePlugin.class); // 시간표 이미지 공유·저장(TTWImage)
        registerPlugin(ShellPlugin.class); // 링크 공유·앱 설정 열기(TTWShell)
        registerPlugin(SharePlugin.class); // 공유 카드의 바로 보내기: 카카오톡·인스타·문자(TTWShare)
        registerPlugin(WidgetPlugin.class); // 홈 화면 위젯 자료(TTWWidget)
        super.onCreate(savedInstanceState);
        // 첫 화면을 그리기 전 웹뷰 바탕을 시작 화면과 같은 색으로(라이트·다크). 흰 화면이 번쩍이지 않게
        WebView webView = getBridge() != null ? getBridge().getWebView() : null;
        if (webView != null) {
            webView.setBackgroundColor(ContextCompat.getColor(this, R.color.launch_background));
        }
    }

    @Override
    public void onStart() {
        super.onStart();
        started++;
    }

    @Override
    public void onStop() {
        super.onStop();
        started = Math.max(0, started - 1);
        if (!isChangingConfigurations()) LauncherIcon.sync(this); // 앱이 안 보이게 됐을 때 이달의 아이콘으로(12월 크리스마스)
    }
}
