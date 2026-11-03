package com.ttwizard.app;

import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.ComponentName;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.drawable.Drawable;
import android.net.Uri;
import android.provider.Telephony;
import android.util.Base64;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.ByteArrayOutputStream;
import java.util.List;
import java.util.Locale;

/**
 * 공유 카드의 바로 보내기 — 백엔드 update80(11/3). 화면은 app/src/native.js 의 TTW_APP.shareTargets·shareTo 로 부른다.
 * 11/3 사용자(구글 공유 창 캡처: 링크 칸과 '링크 복사', 아래 동그란 앱 단추): "공유 탭은 이런 형태로 바꿔줘. 카카오톡, 인스타(스토리, DM), 메세지 등등 넣어주고".
 *   targets  이 폰에서 바로 보낼 수 있는 곳 { targets: [{ id, app, icon, text, image }] }. 깔려 있지 않은 앱은 빠진다. 순서는 TARGETS.
 *            app 은 그 앱이 기기에 알리는 이름(단추 이름은 화면이 정한다), icon 은 그 앱 아이콘(PNG base64, ICON px). 아이콘은 기기 공유 창처럼
 *            기기가 그 앱에서 받아 주는 그대로다(우리가 로고를 그리거나 저장소에 두지 않는다). text·image 는 링크(글)·시간표 이미지를 받는지.
 *   send     { target, text } 링크를, { target, data(PNG base64), name } 시간표 이미지를 그 앱의 공유 화면으로 바로 넘긴다.
 * SDK·키·계정 없이 안드로이드 공유 인텐트(ACTION_SEND, 문자 글은 ACTION_SENDTO smsto:)를 그 앱으로 좁힌다. 앱이 받는 화면이 여럿이면
 * (인스타의 피드·스토리·채팅) 화면 이름의 낱말로 고르고(스토리 'story', DM 'direct'), 못 고르면 그 앱의 받는 화면만 든 기기 선택 창을 띄운다.
 * 인스타 스토리의 공식 길(com.instagram.share.ADD_TO_STORY)은 2023년 1월부터 Facebook 앱 ID 가 있어야 해서 쓰지 않는다: 기기 공유 창에서
 * 인스타의 '스토리'를 고를 때와 같은 받는 화면을 연다. 스토리에는 링크를 붙여 보낼 길이 없어 이미지만 받는다.
 * 안드로이드 11 이상은 매니페스트 <queries> 에 적은 앱(카카오톡·인스타그램·문자 앱)만 보인다. QUERY_ALL_PACKAGES 와 권한은 쓰지 않고,
 * 무엇이 깔렸는지는 기기 안에서만 본다(밖으로 보내지 않는다).
 * 거절 code: "MISSING"(그 앱이 없거나 그 내용을 받지 않는다), "FAILED"(그 밖).
 */
@CapacitorPlugin(name = "TTWShare")
public class SharePlugin extends Plugin {

    static final String KAKAO = "com.kakao.talk";
    static final String INSTAGRAM = "com.instagram.android";
    /** 단추 순서: { id, 패키지(null 이면 기기의 기본 문자 앱), 고를 받는 화면 이름의 낱말(null 이면 고르지 않는다), 링크(글)를 보내는지("text" 면) } */
    static final String[][] TARGETS = {
        { "kakao", KAKAO, null, "text" },
        { "instagram-story", INSTAGRAM, "story", "" },
        { "instagram-dm", INSTAGRAM, "direct", "text" },
        { "sms", null, null, "text" },
    };
    static final int ICON = 144; // 48dp 단추의 xxhdpi

    static String[] target(String id) {
        for (String[] t : TARGETS) if (t[0].equals(id)) return t;
        return null;
    }

    /** 그 곳의 앱(문자는 기기의 기본 문자 앱. 태블릿처럼 없으면 null) */
    private String packageOf(String[] t) {
        return t[1] != null ? t[1] : Telephony.Sms.getDefaultSmsPackage(getContext());
    }

    @SuppressWarnings("deprecation") // queryIntentActivities(Intent, int): 33 의 ResolveInfoFlags 판과 같다
    private List<ResolveInfo> found(Intent intent) {
        return getContext().getPackageManager().queryIntentActivities(intent, PackageManager.MATCH_DEFAULT_ONLY);
    }

    /** 그 앱으로 좁힌 인텐트: 받는 화면 이름에 word 가 든 것, 하나뿐이면 그것, 여럿이면 그 앱의 받는 화면만 든 기기 선택 창. 받지 않으면 null */
    Intent pick(Intent base, String pkg, String word) {
        List<ResolveInfo> list = found(new Intent(base).setPackage(pkg));
        if (list == null || list.isEmpty()) return null;
        ResolveInfo best = null;
        if (word != null) {
            for (ResolveInfo r : list) {
                if (r.activityInfo != null && r.activityInfo.name.toLowerCase(Locale.ROOT).contains(word)) {
                    best = r;
                    break;
                }
            }
        }
        if (best == null && list.size() == 1) best = list.get(0);
        if (best != null && best.activityInfo != null) {
            return new Intent(base).setComponent(new ComponentName(best.activityInfo.packageName, best.activityInfo.name));
        }
        return Intent.createChooser(new Intent(base).setPackage(pkg), null);
    }

    /** 링크(글) 보내기. 문자는 받는 사람 없이 글만 채운 새 메시지(smsto:) */
    Intent textIntent(String[] t, String text) {
        String pkg = packageOf(t);
        if (pkg == null || !"text".equals(t[3])) return null;
        if (t[1] == null) {
            Intent sms = new Intent(Intent.ACTION_SENDTO, Uri.parse("smsto:")).setPackage(pkg);
            sms.putExtra("sms_body", text);
            sms.putExtra(Intent.EXTRA_TEXT, text);
            List<ResolveInfo> list = found(sms);
            return list == null || list.isEmpty() ? null : sms;
        }
        Intent send = new Intent(Intent.ACTION_SEND).setType("text/plain");
        send.putExtra(Intent.EXTRA_TEXT, text);
        return pick(send, pkg, t[2]);
    }

    /** 시간표 이미지(PNG) 보내기. uri 가 null 이면 받는지만 본다 */
    Intent imageIntent(String[] t, Uri uri) {
        String pkg = packageOf(t);
        if (pkg == null) return null;
        Intent send = new Intent(Intent.ACTION_SEND).setType("image/png");
        if (uri != null) {
            send.putExtra(Intent.EXTRA_STREAM, uri);
            send.setClipData(ClipData.newRawUri("", uri));
            send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        }
        return pick(send, pkg, t[2]);
    }

    /** 그 앱 아이콘(기기가 주는 그대로)을 ICON px PNG 로. 못 그리면 "" */
    static String iconOf(PackageManager pm, String pkg) {
        try {
            Drawable icon = pm.getApplicationIcon(pkg);
            Bitmap bitmap = Bitmap.createBitmap(ICON, ICON, Bitmap.Config.ARGB_8888);
            icon.setBounds(0, 0, ICON, ICON);
            icon.draw(new Canvas(bitmap));
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            bitmap.compress(Bitmap.CompressFormat.PNG, 100, out);
            bitmap.recycle();
            return Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP);
        } catch (Exception e) {
            return "";
        }
    }

    @SuppressWarnings("deprecation") // getApplicationInfo(String, int): 33 의 ApplicationInfoFlags 판과 같다
    static String labelOf(PackageManager pm, String pkg) {
        try {
            return String.valueOf(pm.getApplicationLabel(pm.getApplicationInfo(pkg, 0)));
        } catch (Exception e) {
            return "";
        }
    }

    @PluginMethod
    public void targets(PluginCall call) {
        PackageManager pm = getContext().getPackageManager();
        JSArray list = new JSArray();
        try {
            for (String[] t : TARGETS) {
                String pkg = packageOf(t);
                if (pkg == null) continue;
                boolean text = textIntent(t, "") != null;
                boolean image = imageIntent(t, null) != null;
                if (!text && !image) continue;
                JSObject one = new JSObject();
                one.put("id", t[0]);
                one.put("app", labelOf(pm, pkg));
                one.put("icon", iconOf(pm, pkg));
                one.put("text", text);
                one.put("image", image);
                list.put(one);
            }
        } catch (Exception e) {
            // 못 물은 곳은 빼고 물은 데까지 돌려준다(화면은 기기 공유 시트가 남는다)
        }
        JSObject ret = new JSObject();
        ret.put("targets", list);
        call.resolve(ret);
    }

    @PluginMethod
    public void send(PluginCall call) {
        String[] t = target(call.getString("target", ""));
        if (t == null) {
            call.reject("unknown target", "FAILED");
            return;
        }
        byte[] data = ImagePlugin.bytes(call);
        String text = call.getString("text", "");
        if (data == null && (text == null || text.isEmpty())) {
            call.reject("nothing to share", "FAILED");
            return;
        }
        try {
            Intent intent = data != null
                ? imageIntent(t, ImagePlugin.cacheForShare(getContext(), data, ImagePlugin.fileName(call)))
                : textIntent(t, text);
            if (intent == null) {
                call.reject(t[0] + " cannot receive this", "MISSING");
                return;
            }
            getActivity().startActivity(intent);
            call.resolve();
        } catch (ActivityNotFoundException e) {
            call.reject(e.getMessage() != null ? e.getMessage() : "app not found", "MISSING");
        } catch (Exception e) {
            call.reject(e.getMessage() != null ? e.getMessage() : "share failed", "FAILED");
        }
    }
}
