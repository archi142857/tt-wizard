package com.ttwizard.app;

import android.os.Bundle;
import android.webkit.WebView;
import androidx.core.content.ContextCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // 이 앱 안의 플러그인(super.onCreate 보다 먼저 등록한다)
        registerPlugin(ImagePlugin.class); // 시간표 이미지 공유·저장(TTWImage)
        registerPlugin(ShellPlugin.class); // 링크 공유·앱 설정 열기(TTWShell)
        super.onCreate(savedInstanceState);
        // 첫 화면을 그리기 전 웹뷰 바탕을 시작 화면과 같은 색으로(라이트·다크). 흰 화면이 번쩍이지 않게
        WebView webView = getBridge() != null ? getBridge().getWebView() : null;
        if (webView != null) {
            webView.setBackgroundColor(ContextCompat.getColor(this, R.color.launch_background));
        }
    }
}
