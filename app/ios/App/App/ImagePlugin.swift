import Capacitor
import Photos
import UIKit

/// 시간표 이미지(PNG) 공유·저장 — 백엔드 세션(10/30). 안드로이드 ImagePlugin.java 와 같은 이름(TTWImage)·같은 약속이고,
/// 화면은 app/src/native.js 의 TTW_APP.shareImage·saveImage 로 부른다. MainViewController(SceneDelegate.swift)가 등록한다.
///   share  임시 폴더(tmp/share/)에 PNG 를 쓰고 공유 시트(UIActivityViewController). 지난번 것은 지운다
///   save   사진에 추가(PHPhotoLibrary, 추가 전용 권한. 목적 문구는 Info.plist 의 NSPhotoLibraryAddUsageDescription).
///          거절·제한(restricted)이면 "DENIED"(화면: '사진 접근이 꺼져 있어요' [설정] → TTWShell.openSettings), 그 밖의 실패는 "FAILED"
///   info   { save: true, share: true }
/// 받은 바이트 그대로 넘긴다(UIImage 로 다시 그리지 않는다): PNG 안의 시간표 자료(iTXt)가 남는다.
@objc(ImagePlugin)
public class ImagePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "ImagePlugin"
    public let jsName = "TTWImage"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "share", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "save", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "info", returnType: CAPPluginReturnPromise)
    ]

    private func imageData(_ call: CAPPluginCall) -> Data? {
        guard let text = call.getString("data"), !text.isEmpty else { return nil }
        return Data(base64Encoded: text, options: .ignoreUnknownCharacters)
    }

    /// 파일 이름: 경로·제어 글자를 빼고 .png 로 끝나게(안드로이드와 같은 규칙)
    static func fileName(_ raw: String?) -> String {
        let bad = CharacterSet(charactersIn: "\\/:*?\"<>|").union(.controlCharacters)
        var name = ""
        for scalar in (raw ?? "").unicodeScalars {
            name.unicodeScalars.append(bad.contains(scalar) ? "_" : scalar)
        }
        name = name.trimmingCharacters(in: .whitespacesAndNewlines)
        if name.isEmpty || name.hasPrefix(".") { name = "timetable" }
        if name.count > 80 { name = String(name.prefix(80)) }
        return name.lowercased().hasSuffix(".png") ? name : name + ".png"
    }

    @objc func share(_ call: CAPPluginCall) {
        guard let data = imageData(call) else {
            call.reject("no image data")
            return
        }
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("share", isDirectory: true)
        let file = dir.appendingPathComponent(ImagePlugin.fileName(call.getString("name")))
        do {
            try? FileManager.default.removeItem(at: dir)
            try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
            try data.write(to: file, options: .atomic)
        } catch {
            call.reject(error.localizedDescription, "FAILED")
            return
        }
        DispatchQueue.main.async {
            guard let presenter = self.bridge?.viewController else {
                call.reject("no view", "FAILED")
                return
            }
            let sheet = UIActivityViewController(activityItems: [file], applicationActivities: nil)
            ShellPlugin.anchor(sheet, in: presenter)
            presenter.present(sheet, animated: true) {
                call.resolve()
            }
        }
    }

    @objc func save(_ call: CAPPluginCall) {
        guard let data = imageData(call) else {
            call.reject("no image data")
            return
        }
        let name = ImagePlugin.fileName(call.getString("name"))
        PHPhotoLibrary.requestAuthorization(for: .addOnly) { status in
            switch status {
            case .authorized, .limited:
                PHPhotoLibrary.shared().performChanges({
                    let request = PHAssetCreationRequest.forAsset()
                    let options = PHAssetResourceCreationOptions()
                    options.originalFilename = name
                    request.addResource(with: .photo, data: data, options: options)
                }, completionHandler: { done, error in
                    if done {
                        call.resolve()
                    } else {
                        call.reject(error?.localizedDescription ?? "save failed", "FAILED")
                    }
                })
            case .denied, .restricted:
                call.reject("photo access denied", "DENIED")
            default:
                call.reject("photo access unknown", "FAILED")
            }
        }
    }

    @objc func info(_ call: CAPPluginCall) {
        call.resolve(["save": true, "share": true])
    }
}
