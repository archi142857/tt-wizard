import Capacitor
import UIKit

/// 앱 셸이 화면에 빌려주는 기기 기능 — 백엔드 세션(10/30). 안드로이드 ShellPlugin.java 와 같은 이름(TTWShell)·같은 약속이고,
/// 화면은 app/src/native.js 의 TTW_APP.shareLink·openSettings 로 부른다. MainViewController(SceneDelegate.swift)가 등록한다.
///   shareText     글(시간표 링크) 공유: 공유 시트(UIActivityViewController). 주소면 URL 로 넘겨 받는 앱이 링크로 다룬다
///   openSettings  설정 앱의 이 앱 화면(사진 접근을 다시 켤 곳)
/// 실패는 "FAILED" 로 거절한다.
@objc(ShellPlugin)
public class ShellPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "ShellPlugin"
    public let jsName = "TTWShell"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "shareText", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "openSettings", returnType: CAPPluginReturnPromise)
    ]

    /// iPad 에서 공유 시트가 떠 있을 자리(아이폰은 아래에서 올라와 쓰지 않는다)
    static func anchor(_ sheet: UIViewController, in presenter: UIViewController) {
        guard let pop = sheet.popoverPresentationController else { return }
        pop.sourceView = presenter.view
        pop.sourceRect = CGRect(x: presenter.view.bounds.midX, y: presenter.view.bounds.midY, width: 0, height: 0)
        pop.permittedArrowDirections = []
    }

    @objc func shareText(_ call: CAPPluginCall) {
        guard let text = call.getString("text"), !text.isEmpty else {
            call.reject("no text")
            return
        }
        var items: [Any] = [text]
        if let url = URL(string: text), url.scheme != nil {
            items = [url]
        }
        DispatchQueue.main.async {
            guard let presenter = self.bridge?.viewController else {
                call.reject("no view", "FAILED")
                return
            }
            let sheet = UIActivityViewController(activityItems: items, applicationActivities: nil)
            ShellPlugin.anchor(sheet, in: presenter)
            presenter.present(sheet, animated: true) {
                call.resolve()
            }
        }
    }

    @objc func openSettings(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard let url = URL(string: UIApplication.openSettingsURLString) else {
                call.reject("no settings url", "FAILED")
                return
            }
            UIApplication.shared.open(url, options: [:]) { opened in
                if opened {
                    call.resolve()
                } else {
                    call.reject("settings did not open", "FAILED")
                }
            }
        }
    }
}
