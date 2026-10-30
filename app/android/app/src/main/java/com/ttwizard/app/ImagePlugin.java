package com.ttwizard.app;

import android.Manifest;
import android.content.ClipData;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Intent;
import android.media.MediaScannerConnection;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.OutputStream;

/**
 * 시간표 이미지(PNG) 공유·저장 — 백엔드 세션(10/23, 10/30 모든 기기 저장). 화면은 app/src/native.js 의 TTW_APP.shareImage·saveImage 로 부른다.
 *   share  앱 캐시(cache/share/)에 쓰고 공유 시트(ACTION_SEND)로 넘긴다. 받는 앱은 FileProvider 주소를 이번 한 번만 읽는다. 권한 없음.
 *   save   사진의 Pictures/TT Wizard 에 넣는다(디자인 79판 '모든 기기에 둔다').
 *          안드로이드 10(API 29) 이상: MediaStore 에 제 파일을 더한다(권한 없음).
 *          9 이하: 저장소 쓰기 권한(WRITE_EXTERNAL_STORAGE, 매니페스트 maxSdkVersion 28)을 처음 저장할 때 묻고 파일로 쓴 뒤 미디어 스캔.
 *          거절(다시 묻지 않음 포함)이면 "DENIED"(화면: '사진 접근이 꺼져 있어요' [설정] → TTWShell.openSettings), 그 밖의 실패는 "FAILED".
 *   info   { save: 사진에 저장되는 기기인지(지금은 모든 기기), sdk } — native.js 가 켤 때 한 번 물어 TTW_APP.canSaveImage 로 둔다.
 * 파일은 받은 바이트 그대로 쓴다: PNG 안에 넣은 시간표 자료(iTXt, web/js/timetables.js '이미지 파일에 담기')가 남는다.
 */
@CapacitorPlugin(
    name = "TTWImage",
    permissions = { @Permission(alias = "storage", strings = { Manifest.permission.WRITE_EXTERNAL_STORAGE }) }
)
public class ImagePlugin extends Plugin {

    private static final String FOLDER = "TT Wizard";

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

    private static String message(Exception e, String fallback) {
        return e.getMessage() != null ? e.getMessage() : fallback;
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
            call.reject(message(e, "share failed"), "FAILED");
        }
    }

    @PluginMethod
    public void info(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("save", true); // 10 이상은 MediaStore, 9 이하는 저장소 권한을 물어서
        ret.put("sdk", Build.VERSION.SDK_INT);
        call.resolve(ret);
    }

    @PluginMethod
    public void save(PluginCall call) {
        byte[] data = bytes(call);
        if (data == null) {
            call.reject("no image data");
            return;
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            saveToMediaStore(call, data);
            return;
        }
        if (getPermissionState("storage") != PermissionState.GRANTED) {
            requestPermissionForAlias("storage", call, "storageAnswered"); // 물은 뒤 storageAnswered 로 온다
            return;
        }
        saveToPictures(call, data);
    }

    @PermissionCallback
    private void storageAnswered(PluginCall call) {
        if (getPermissionState("storage") != PermissionState.GRANTED) {
            call.reject("storage permission denied", "DENIED"); // 이번에 거절했거나 '다시 묻지 않음'
            return;
        }
        byte[] data = bytes(call);
        if (data == null) {
            call.reject("no image data");
            return;
        }
        saveToPictures(call, data);
    }

    /** 안드로이드 10 이상: MediaStore 에 제 파일을 더한다(권한 없음). 이름이 겹치면 MediaStore 가 번호를 붙인다 */
    private void saveToMediaStore(PluginCall call, byte[] data) {
        ContentResolver resolver = getContext().getContentResolver();
        ContentValues values = new ContentValues();
        values.put(MediaStore.MediaColumns.DISPLAY_NAME, fileName(call));
        values.put(MediaStore.MediaColumns.MIME_TYPE, "image/png");
        values.put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_PICTURES + "/" + FOLDER);
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
            call.reject(message(e, "save failed"), "FAILED");
        }
    }

    /** 안드로이드 9 이하(권한을 받은 뒤): Pictures/TT Wizard 에 파일로 쓰고 미디어 스캔을 걸어 사진 앱에 보이게 한다 */
    @SuppressWarnings("deprecation") // getExternalStoragePublicDirectory 는 9 이하에서만 부른다
    private void saveToPictures(PluginCall call, byte[] data) {
        try {
            File dir = new File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_PICTURES), FOLDER);
            if (!dir.isDirectory() && !dir.mkdirs()) throw new IOException("pictures dir");
            File file = freeFile(dir, fileName(call));
            try (FileOutputStream out = new FileOutputStream(file)) {
                out.write(data);
            }
            MediaScannerConnection.scanFile(getContext(), new String[] { file.getAbsolutePath() }, new String[] { "image/png" }, null);
            JSObject ret = new JSObject();
            ret.put("uri", Uri.fromFile(file).toString());
            call.resolve(ret);
        } catch (Exception e) {
            call.reject(message(e, "save failed"), "FAILED");
        }
    }

    /** 같은 이름이 있으면 '이름 (2).png' 부터 빈 이름(10 이상의 MediaStore 처럼 덮어쓰지 않는다) */
    static File freeFile(File dir, String name) {
        File file = new File(dir, name);
        String stem = name.substring(0, name.length() - 4); // fileName 은 늘 .png 로 끝난다
        for (int n = 2; file.exists() && n < 1000; n++) file = new File(dir, stem + " (" + n + ").png");
        return file;
    }
}
