package com.ttwizard.app;

import android.os.Bundle;
import android.os.CancellationSignal;
import androidx.core.content.ContextCompat;
import androidx.credentials.ClearCredentialStateRequest;
import androidx.credentials.Credential;
import androidx.credentials.CredentialManager;
import androidx.credentials.CredentialManagerCallback;
import androidx.credentials.CustomCredential;
import androidx.credentials.GetCredentialRequest;
import androidx.credentials.GetCredentialResponse;
import androidx.credentials.exceptions.ClearCredentialException;
import androidx.credentials.exceptions.GetCredentialCancellationException;
import androidx.credentials.exceptions.GetCredentialException;
import androidx.credentials.exceptions.NoCredentialException;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.android.libraries.identity.googleid.GetSignInWithGoogleOption;
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential;
import java.util.concurrent.Executor;

/**
 * 앱 안 구글 로그인 — 백엔드 세션(update111, 사용자 11/14 '로그인은 웹과 안드로이드 앱 둘 다', 16일 데모데이).
 * 웹뷰에서는 구글 로그인 창을 띄울 수 없어서(구글이 웹뷰 로그인을 막는다) 폰의 구글 계정 고르기(Credential Manager, 'Google 계정으로 로그인' 시트)로
 * id 토큰을 받아 화면에 넘긴다. 화면(web/js/account.js)은 그 토큰으로 Firebase 에 들어간다. 화면은 app/src/native.js 의 TTW_APP.googleSignIn 으로 부른다.
 *   signIn   { clientId }(Firebase 프로젝트의 웹 클라이언트 ID, 배포 때 firebase-config.js 의 googleClientId)
 *            → { idToken, email, name } · 사용자가 닫으면 { cancelled: true }
 *            · 실패는 code NO_CONFIG(클라이언트 ID 없음)·NO_ACCOUNT(폰에 구글 계정이 없거나 이 앱 서명이 Firebase 에 없음)·FAILED
 *   signOut  폰의 로그인 상태를 지운다(다음 로그인 때 계정을 다시 고르게)
 * 권한을 쓰지 않는다. 비밀번호·토큰을 앱에 저장하지 않는다(Firebase 가 웹뷰 안에 로그인 상태를 둔다).
 * 서명 지문(SHA-1)이 Firebase 안드로이드 앱(com.ttwizard.app)에 있어야 한다: Play 앱 서명 키·업로드 키(docs/account.md). 디버그 빌드는 그 PC 의 디버그 키를 더해야 된다.
 */
@CapacitorPlugin(name = "TTWAuth")
public class AuthPlugin extends Plugin {

    static final String CLIENT_SUFFIX = ".apps.googleusercontent.com";

    /** 구글 클라이언트 ID 꼴인가(숫자-글자.apps.googleusercontent.com) */
    static boolean clientIdOk(String id) {
        return id != null && id.length() > CLIENT_SUFFIX.length() && id.endsWith(CLIENT_SUFFIX) && id.indexOf(' ') < 0;
    }

    @PluginMethod
    public void signIn(PluginCall call) {
        String clientId = call.getString("clientId", "");
        if (!clientIdOk(clientId)) {
            call.reject("no google client id", "NO_CONFIG");
            return;
        }
        if (getActivity() == null) {
            call.reject("no activity", "FAILED");
            return;
        }
        // 'Google 계정으로 로그인' 단추 흐름: 폰의 구글 계정을 모두 보여 주고(새 계정 더하기 포함) 고른 계정의 id 토큰을 받는다
        GetSignInWithGoogleOption option = new GetSignInWithGoogleOption.Builder(clientId).build();
        GetCredentialRequest request = new GetCredentialRequest.Builder().addCredentialOption(option).build();
        CredentialManager manager = CredentialManager.create(getContext());
        Executor main = ContextCompat.getMainExecutor(getContext());
        manager.getCredentialAsync(getActivity(), request, new CancellationSignal(), main,
            new CredentialManagerCallback<GetCredentialResponse, GetCredentialException>() {
                @Override
                public void onResult(GetCredentialResponse response) {
                    Credential credential = response.getCredential();
                    if (!(credential instanceof CustomCredential) || !googleType(credential.getType())) {
                        call.reject("unexpected credential", "FAILED");
                        return;
                    }
                    try {
                        Bundle data = credential.getData();
                        GoogleIdTokenCredential google = GoogleIdTokenCredential.createFrom(data);
                        JSObject out = new JSObject();
                        out.put("idToken", google.getIdToken());
                        out.put("email", google.getEmail() == null ? "" : google.getEmail());
                        out.put("name", google.getDisplayName() == null ? "" : google.getDisplayName());
                        call.resolve(out);
                    } catch (Exception e) {
                        call.reject("bad google credential", "FAILED");
                    }
                }

                @Override
                public void onError(GetCredentialException e) {
                    if (e instanceof GetCredentialCancellationException) {
                        JSObject out = new JSObject();
                        out.put("cancelled", true);
                        call.resolve(out);
                    } else if (e instanceof NoCredentialException) {
                        call.reject(reason(e), "NO_ACCOUNT");
                    } else {
                        call.reject(reason(e), "FAILED");
                    }
                }
            });
    }

    @PluginMethod
    public void signOut(PluginCall call) {
        CredentialManager manager = CredentialManager.create(getContext());
        manager.clearCredentialStateAsync(new ClearCredentialStateRequest(), new CancellationSignal(),
            ContextCompat.getMainExecutor(getContext()),
            new CredentialManagerCallback<Void, ClearCredentialException>() {
                @Override
                public void onResult(Void unused) {
                    call.resolve();
                }

                @Override
                public void onError(ClearCredentialException e) {
                    call.resolve(); // 지울 것이 없어도 로그아웃은 된다(Firebase 쪽은 화면이 끊는다)
                }
            });
    }

    /** 구글 id 토큰 자격인가('Google 계정으로 로그인' 시트는 googleid 1.2 부터 SIWG 꼴로 줄 수 있다) */
    static boolean googleType(String type) {
        return GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_CREDENTIAL.equals(type)
            || GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_SIWG_CREDENTIAL.equals(type);
    }

    /** 오류의 종류와 글(개인 정보 없이, 화면의 '자세히'·개발자 메뉴에 보일 수 있다) */
    private static String reason(GetCredentialException e) {
        String type = e.getType();
        String msg = e.getMessage();
        return (type == null ? "" : type) + (msg == null ? "" : ": " + msg);
    }
}
