// Created by Cory McCabe
import SwiftUI
import WatchKit

struct WatchFailedActionRow: View {
    let request: WatchCaptureRequest
    let relay: WatchCaptureRelay
    @State private var errorMessage: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("A task action needs attention.").font(.footnote)
            Button("Dismiss failed action") {
                do { try relay.dismissFailedAction(id: request.id) }
                catch { errorMessage = error.localizedDescription }
            }
            if let errorMessage { Text(errorMessage).font(.footnote).foregroundStyle(.orange) }
        }
    }
}

struct WatchCaptureReceipt: View {
    let isWaiting: Bool
    var body: some View {
        if isWaiting {
            Label("Saved on Watch", systemImage: "checkmark.circle.fill")
                .font(.footnote).foregroundStyle(.mint)
                .accessibilityIdentifier("watchCaptureReceipt")
        } else {
            Label("Sent to iPhone", systemImage: "checkmark.circle.fill")
                .font(.footnote).foregroundStyle(.mint)
                .accessibilityIdentifier("watchCaptureReceipt")
        }
    }
}

struct WatchConnectionStatus: View {
    let relay: WatchCaptureRelay
    var body: some View {
        if relay.connected {
            Label("iPhone account connected", systemImage: "iphone")
                .font(.footnote).foregroundStyle(.secondary)
        } else {
            Button("Connect to iPhone") { relay.refreshConnection() }
                .accessibilityIdentifier("watchConnectToPhone")
            if relay.phoneNeedsSignIn {
                Text("Sign in to Followthrough on your iPhone, then tap Connect to iPhone.")
                    .font(.footnote).foregroundStyle(.secondary)
            } else {
                Text("Keep your iPhone nearby to connect once.")
                    .font(.footnote).foregroundStyle(.secondary)
            }
        }
        if let error = relay.error { Text(error).font(.footnote).foregroundStyle(.orange) }
    }
}
