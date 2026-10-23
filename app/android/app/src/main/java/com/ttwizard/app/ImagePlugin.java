package com.ttwizard.app;

import android.content.ClipData;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.OutputStream;

/**
 * 시간표 이미지(PNG) 공유·저장 — 백엔드 세션(10/23). 화면은 app/src/native.js 의 TTW_APP.shareImage·saveImage 로 부른다.
 * 권한을 더하지 않는다:
 *   share  앱 캐시(cache/share/)에 쓰고 공유 시트(ACTION_SEND)로 넘긴다. 받는 앱은 FileProvider 주소를 이번 한 번만 읽는다.
 *   save   안드로이드 10(API 29) 이상에서 사진(Pictures/TT Wizard)에 넣는다(MediaStore 에 제 파일을 더하는 데는 권한이 없다).
 *          그 아래는 저장소 권한이 있어야 해서 "UNSUPPORTED" 로 거절한다(화면은 공유로 돌린다).
 * 파일은 받은 바이트 그대로 쓴다: PNG 안에 넣은 시간표 자료(iTXt, web/js/timetables.js '이미지 파일에 담기')가 남는다.
 */
@CapacitorPlugin(name = "TTWImage")
public class ImagePlugin extends Plugin {

    private static byte[] bytes(PluginCall call) {
        String data = call.getString("data");
        if (data == null || data.isEmpty()) return null;
        try {
            return Base64.decode(data, Base64.DEFAULT);
        } catch (IllegalArgumentException e) {
            return null;
        }
    }

    /** 파일 이름: 경로·제어 글자를 빼고 .png 로 끝나게 */
    private static String fileName(PluginCall call) {
        String name = call.getString("name", "");
        name = name == null ? "" : name.replaceAll("[\\\\/:*?\"<>|\\p{Cntrl}]", "_").trim();
        if (name.isEmpty() || name.startsWith(".")) name = "timetable";
        if (name.length() > 80) name = name.substring(0, 80);
        return name.toLowerCase().endsWith(".png") ? name : name + ".png";
    }

    @PluginMethod
    public void share(PluginCall call) {
        byte[] data = bytes(call);
        if (data == null) {
            call.reject("no image data");
            return;
        }
        try {
            File dir = new File(getContext().getCacheDir(), "share");
            if (!dir.isDirectory() && !dir.mkdirs()) throw new IOException("cache dir");
            File[] old = dir.listFiles();
            if (old != null) for (File f : old) f.delete(); // 지난번에 나눈 파일은 지운다
            File file = new File(dir, fileName(call));
            try (FileOutputStream out = new FileOutputStream(file)) {
                out.write(data);
            }
            Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", file);
            Intent send = new Intent(Intent.ACTION_SEND);
            send.setType("image/png");
            send.putExtra(Intent.EXTRA_STREAM, uri);
            send.setClipData(ClipData.newRawUri("", uri));
            send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            String title = call.getString("title", "");
            getActivity().startActivity(Intent.createChooser(send, title == null ? "" : title));
            call.resolve();
        } catch (Exception e) {
            call.reject(e.getMessage() != null ? e.getMessage() : "share failed");
        }
    }

    @PluginMethod
    public void save(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
            call.reject("saving needs Android 10", "UNSUPPORTED");
            return;
        }
        byte[] data = bytes(call);
        if (data == null) {
            call.reject("no image data");
            return;
        }
        ContentResolver resolver = getContext().getContentResolver();
        ContentValues values = new ContentValues();
        values.put(MediaStore.MediaColumns.DISPLAY_NAME, fileName(call));
        values.put(MediaStore.MediaColumns.MIME_TYPE, "image/png");
        values.put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_PICTURES + "/TT Wizard");
        values.put(MediaStore.MediaColumns.IS_PENDING, 1);
        Uri uri = null;
        try {
            uri = resolver.insert(MediaStore.Images.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY), values);
            if (uri == null) throw new IOException("insert");
            try (OutputStream out = resolver.openOutputStream(uri)) {
                if (out == null) throw new IOException("open");
                out.write(data);
            }
            ContentValues done = new ContentValues();
            done.put(MediaStore.MediaColumns.IS_PENDING, 0);
            resolver.update(uri, done, null, null);
            JSObject ret = new JSObject();
            ret.put("uri", uri.toString());
            call.resolve(ret);
        } catch (Exception e) {
            if (uri != null) resolver.delete(uri, null, null);
            call.reject(e.getMessage() != null ? e.getMessage() : "save failed");
        }
    }
}
