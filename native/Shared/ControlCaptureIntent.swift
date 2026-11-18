// Created by Cory McCabe
#if os(iOS)
import AppIntents

struct ControlCaptureIntent: AppIntent {
    static let title: LocalizedStringResource = "Talk or Type"
    static let authenticationPolicy: IntentAuthenticationPolicy = .requiresLocalDeviceAuthentication
    static let isDiscoverable = false
    static let openAppWhenRun = false

    @available(iOS 26.0, *)
    static var supportedModes: IntentModes { .background }

    @available(iOS 27.0, *)
    static var allowedExecutionTargets: IntentExecutionTargets { .main }

    @Parameter(title: "What do you need to do?", requestValueDialog: "Talk or type your task.")
    var request: String?
}
#endif
