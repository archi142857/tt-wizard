package com.ttwizard.app;

import android.content.Intent;
import android.net.Uri;
import android.provider.Settings;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * 앱 셸이 화면에 빌려주는 기기 기능 — 백엔드 세션(10/30). 화면은 app/src/native.js 의 TTW_APP.shareLink·openSettings 로 부른다.
 *   shareText     글(시간표 링크) 공유: 공유 시트(ACTION_SEND text/plain, EXTRA_TEXT). title 은 선택 창 제목과 미리보기 제목.
 *                 안드로이드 웹뷰에는 navigator.share 가 없어서 앱이 맡는다(프론트엔드 10/23 요청).
 *   openSettings  이 앱의 설정 화면(앱 정보). 사진 저장 권한을 거절한 뒤 다시 켤 곳(화면: '사진 접근이 꺼져 있어요' [설정]).
 * 권한을 쓰지 않는다. 실패는 "FAILED" 로 거절한다.
 */
@CapacitorPlugin(name = "TTWShell")
public class ShellPlugin extends Plugin {

    @PluginMethod
    public void shareText(PluginCall call) {
        String text = call.getString("text", "");
        if (text == null || text.isEmpty()) {
            call.reject("no text");
            return;
        }
        String title = call.getString("title", "");
        if (title == null) title = "";
        Intent send = new Intent(Intent.ACTION_SEND);
        send.setType("text/plain");
        send.putExtra(Intent.EXTRA_TEXT, text);
        if (!title.isEmpty()) send.putExtra(Intent.EXTRA_TITLE, title); // 안드로이드 10 이상 공유 시트의 미리보기 제목
        try {
            getActivity().startActivity(Intent.createChooser(send, title));
            call.resolve();
        } catch (Exception e) {
            call.reject(e.getMessage() != null ? e.getMessage() : "share failed", "FAILED");
        }
    }

    @PluginMethod
    public void openSettings(PluginCall call) {
        try {
            Intent intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", getContext().getPackageName(), null));
            getActivity().startActivity(intent);
            call.resolve();
        } catch (Exception e) {
            call.reject(e.getMessage() != null ? e.getMessage() : "settings failed", "FAILED");
        }
    }
}
