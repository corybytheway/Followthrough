// Created by Cory McCabe
import UIKit

final class CaptureReceiptView: UIScrollView {
    private let stack = UIStackView()
    private let padding: CGFloat = 20
    private let mint = UIColor(red: 53 / 255, green: 234 / 255, blue: 177 / 255, alpha: 1)
    private let secondary = UIColor(red: 204 / 255, green: 214 / 255, blue: 226 / 255, alpha: 1)

    override init(frame: CGRect) {
        super.init(frame: frame)
        contentInsetAdjustmentBehavior = .never
        indicatorStyle = .white
        stack.axis = .vertical
        stack.spacing = 16
        stack.translatesAutoresizingMaskIntoConstraints = false
        addSubview(stack)
        NSLayoutConstraint.activate([
            stack.topAnchor.constraint(equalTo: contentLayoutGuide.topAnchor, constant: padding),
            stack.leadingAnchor.constraint(equalTo: contentLayoutGuide.leadingAnchor, constant: padding),
            stack.trailingAnchor.constraint(equalTo: contentLayoutGuide.trailingAnchor, constant: -padding),
            stack.bottomAnchor.constraint(equalTo: contentLayoutGuide.bottomAnchor, constant: -padding),
            stack.widthAnchor.constraint(equalTo: frameLayoutGuide.widthAnchor, constant: -2 * padding)
        ])
    }

    required init?(coder: NSCoder) { nil }

    func show(_ details: ControlCaptureReceiptTask?) {
        for view in stack.arrangedSubviews { view.removeFromSuperview() }
        setContentOffset(.zero, animated: false)
        guard let details else {
            stack.addArrangedSubview(label(String(localized: "Task added"), style: .title2, color: mint, header: true))
            stack.addArrangedSubview(label(String(localized: "Open task in Followthrough for details."), style: .body, color: secondary))
            return
        }

        let task = details.task
        let title = label(task.title, style: .title2, color: .white, header: true)
        stack.addArrangedSubview(title)
        stack.addArrangedSubview(field(String(localized: "Project"), details.projectName ?? String(localized: "No project")))

        let planning = UIStackView(arrangedSubviews: [
            label(String(localized: "Planning"), style: .headline, color: mint, header: true),
            field(String(localized: "Estimated time"), FTTask.duration(task.estimateMinutes)),
            field(String(localized: "Time remaining"), task.remainingLabel),
            field(String(localized: "Priority"), task.priority.title),
            field(String(localized: "Status"), statusLabel(task.status)),
            field(String(localized: "Deadline"), formattedDay(task.dueDate, timeZone: details.timeZone) ?? String(localized: "No deadline")),
            field(String(localized: "Start on or after"), formattedDay(task.notBefore, timeZone: details.timeZone) ?? String(localized: "No restriction")),
            field(String(localized: "Split into shorter calendar events"), task.splittable ? String(localized: "Yes") : String(localized: "No"))
        ])
        planning.axis = .vertical
        planning.spacing = 9
        stack.addArrangedSubview(planning)

        if !task.steps.isEmpty {
            let steps = UIStackView(arrangedSubviews: [label(String(localized: "Suggested steps"), style: .headline, color: mint, header: true)])
            steps.axis = .vertical
            steps.spacing = 8
            task.steps.forEach { steps.addArrangedSubview(stepRow($0)) }
            stack.addArrangedSubview(steps)
        }
        stack.addArrangedSubview(field(String(localized: "Task notes"), task.notes.isEmpty ? String(localized: "No notes") : task.notes))
        stack.addArrangedSubview(field(String(localized: "Blocked by"), details.blockers.isEmpty ? String(localized: "None") : details.blockers.joined(separator: "\n")))
        stack.addArrangedSubview(field(String(localized: "Original input"), task.source.isEmpty ? String(localized: "No original input") : task.source))
    }

    func height(for width: CGFloat) -> CGFloat {
        let fittingSize = CGSize(width: max(1, width - 2 * padding), height: UIView.layoutFittingCompressedSize.height)
        let height = stack.systemLayoutSizeFitting(
            fittingSize, withHorizontalFittingPriority: .required, verticalFittingPriority: .fittingSizeLevel
        ).height
        return min(430, ceil(height) + 2 * padding)
    }

    private func field(_ name: String, _ value: String) -> UIStackView {
        let row = UIStackView(arrangedSubviews: [
            label(name, style: .subheadline, color: secondary),
            label(value, style: .body, color: .white)
        ])
        row.axis = .vertical
        row.spacing = 2
        return row
    }

    private func stepRow(_ step: FTStep) -> UIStackView {
        let icon = UIImageView(image: UIImage(systemName: step.done ? "checkmark.circle.fill" : "circle"))
        icon.tintColor = step.done ? mint : secondary
        icon.preferredSymbolConfiguration = UIImage.SymbolConfiguration(textStyle: .body)
        icon.contentMode = .scaleAspectFit
        icon.widthAnchor.constraint(equalToConstant: UIFontMetrics(forTextStyle: .body).scaledValue(for: 22)).isActive = true
        icon.isAccessibilityElement = false
        let title = label(step.title, style: .body, color: .white)
        title.accessibilityValue = step.done ? String(localized: "Complete") : String(localized: "Incomplete")
        let row = UIStackView(arrangedSubviews: [icon, title])
        row.alignment = .top
        row.spacing = 8
        return row
    }

    private func label(_ text: String, style: UIFont.TextStyle, color: UIColor, header: Bool = false) -> UILabel {
        let label = UILabel()
        label.text = text
        label.font = .preferredFont(forTextStyle: style)
        label.adjustsFontForContentSizeCategory = true
        label.textColor = color
        label.numberOfLines = 0
        if header { label.accessibilityTraits = .header }
        return label
    }

    private func statusLabel(_ status: String) -> String {
        switch status {
        case "ready": String(localized: "Ready")
        case "waiting": String(localized: "Waiting")
        case "done": String(localized: "Done")
        case "archived": String(localized: "Archived")
        default: status.capitalized
        }
    }

    private func formattedDay(_ value: String?, timeZone: String) -> String? {
        let zone = TimeZone(identifier: timeZone) ?? .current
        guard let day = TaskDeadline(day: value, relativeTo: .now, timeZone: zone) else { return value }
        let formatter = DateFormatter()
        formatter.dateStyle = .medium
        formatter.timeZone = zone
        return formatter.string(from: day.date)
    }
}
