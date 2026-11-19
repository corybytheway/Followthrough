// Created by Cory McCabe
import UIKit
import UserNotifications
import UserNotificationsUI

final class CaptureNotificationViewController: UIViewController, UNNotificationContentExtension {
    private let stack = UIStackView()
    private let taskStack = UIStackView()
    private let taskTitle = UILabel()
    private var receipt: CaptureReceiptView?
    private var previewLoad: Task<Void, Never>?

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = UIColor(red: 21 / 255, green: 36 / 255, blue: 59 / 255, alpha: 1)
        let secondary = UIColor(red: 204 / 255, green: 214 / 255, blue: 226 / 255, alpha: 1)

        let bolt = UIImageView(image: UIImage(named: "CaptureBolt"))
        bolt.contentMode = .scaleAspectFit
        bolt.isAccessibilityElement = false
        bolt.translatesAutoresizingMaskIntoConstraints = false
        let logo = UIView()
        logo.addSubview(bolt)
        NSLayoutConstraint.activate([
            logo.heightAnchor.constraint(equalToConstant: 52),
            bolt.centerXAnchor.constraint(equalTo: logo.centerXAnchor),
            bolt.topAnchor.constraint(equalTo: logo.topAnchor),
            bolt.bottomAnchor.constraint(equalTo: logo.bottomAnchor),
            bolt.widthAnchor.constraint(equalToConstant: 40)
        ])

        let title = UILabel()
        title.text = String(localized: "New Task")
        title.font = UIFontMetrics(forTextStyle: .title2).scaledFont(for: .boldSystemFont(ofSize: 26))
        title.adjustsFontForContentSizeCategory = true
        title.numberOfLines = 0
        title.textColor = .white
        title.textAlignment = .center
        title.accessibilityTraits = .header

        let hint = UILabel()
        hint.text = String(localized: "Type or dictate what you need to do.")
        hint.font = .preferredFont(forTextStyle: .subheadline)
        hint.adjustsFontForContentSizeCategory = true
        hint.numberOfLines = 0
        hint.textColor = secondary
        hint.textAlignment = .center

        let next = UILabel()
        next.text = String(localized: "Up Next")
        next.font = .preferredFont(forTextStyle: .caption1)
        next.adjustsFontForContentSizeCategory = true
        next.textColor = secondary
        next.accessibilityTraits = .header
        taskTitle.font = .preferredFont(forTextStyle: .headline)
        taskTitle.adjustsFontForContentSizeCategory = true
        taskTitle.numberOfLines = 3
        taskTitle.textColor = .white

        let divider = UIView()
        divider.backgroundColor = UIColor.white.withAlphaComponent(0.16)
        divider.heightAnchor.constraint(equalToConstant: 1 / UIScreen.main.scale).isActive = true
        taskStack.axis = .vertical
        taskStack.spacing = 5
        taskStack.addArrangedSubview(divider)
        taskStack.setCustomSpacing(10, after: divider)
        taskStack.addArrangedSubview(next)
        taskStack.addArrangedSubview(taskTitle)
        taskStack.isHidden = true

        stack.axis = .vertical
        stack.spacing = 8
        [logo, title, hint, taskStack].forEach(stack.addArrangedSubview)
        stack.setCustomSpacing(15, after: hint)
        stack.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.topAnchor.constraint(equalTo: view.topAnchor, constant: 16),
            stack.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 22),
            stack.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -22)
        ])
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        if let receipt, !receipt.isHidden, view.bounds.width > 0 {
            let size = CGSize(width: view.bounds.width, height: receipt.height(for: view.bounds.width))
            if preferredContentSize != size { preferredContentSize = size }
            return
        }
        guard stack.bounds.width > 0 else { return }
        let targetSize = CGSize(width: stack.bounds.width, height: UIView.layoutFittingCompressedSize.height)
        let contentHeight = stack.systemLayoutSizeFitting(
            targetSize, withHorizontalFittingPriority: .required, verticalFittingPriority: .fittingSizeLevel
        ).height
        let size = CGSize(width: view.bounds.width, height: ceil(contentHeight) + 32)
        if preferredContentSize != size { preferredContentSize = size }
    }

    func didReceive(_ notification: UNNotification) {
        loadViewIfNeeded()
        previewLoad?.cancel()
        if let target = ControlCaptureNotifications.receiptTarget(in: notification.request.content) {
            showReceipt(target)
            return
        }
        receipt?.isHidden = true
        stack.isHidden = false
        taskStack.isHidden = true
        taskTitle.text = nil
        extensionContext?.notificationActions = [ControlCaptureNotifications.replyAction]
        let target = ControlCaptureNotifications.target(in: notification.request.content)
        previewLoad = Task {
            let settings = await UNUserNotificationCenter.current().notificationSettings()
            guard !Task.isCancelled else { return }
            let preview = settings.showPreviewsSetting == .never ? nil : ControlCapturePreview.read()
            if let preview, preview.target == target {
                taskTitle.text = preview.projectLabel.map { "\($0): \(preview.title)" } ?? preview.title
                taskStack.isHidden = false
                extensionContext?.notificationActions = [ControlCaptureNotifications.replyAction] +
                    preview.actions.map(\.notificationAction)
            }
            view.setNeedsLayout()
            ControlCaptureNotifications.logger.notice("Capture preview rendered with Up Next: \(!self.taskStack.isHidden, privacy: .public)")
        }
    }

    private func showReceipt(_ target: ControlCaptureReceiptTarget) {
        let receipt = receipt ?? installReceiptView()
        stack.isHidden = true
        receipt.isHidden = false
        receipt.show(nil)
        extensionContext?.notificationActions = [ControlCaptureNotifications.openTaskAction]
        previewLoad = Task {
            let settings = await UNUserNotificationCenter.current().notificationSettings()
            guard !Task.isCancelled else { return }
            let details = settings.showPreviewsSetting == .never ? nil : ControlCaptureReceipt.details(for: target)
            receipt.show(details)
            view.setNeedsLayout()
            ControlCaptureNotifications.logger.notice("Capture receipt preview rendered with task details: \(details != nil, privacy: .public)")
        }
    }

    private func installReceiptView() -> CaptureReceiptView {
        let receipt = CaptureReceiptView(frame: .zero)
        self.receipt = receipt
        receipt.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(receipt)
        NSLayoutConstraint.activate([
            receipt.topAnchor.constraint(equalTo: view.topAnchor),
            receipt.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            receipt.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            receipt.bottomAnchor.constraint(equalTo: view.bottomAnchor)
        ])
        return receipt
    }
}
