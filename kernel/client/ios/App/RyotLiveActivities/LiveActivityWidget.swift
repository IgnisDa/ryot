import ActivityKit
import SwiftUI
import WidgetKit

@main
struct RyotLiveActivitiesBundle: WidgetBundle {
    var body: some Widget {
        RyotLiveActivityWidget()
    }
}

struct RyotLiveActivityWidget: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: RyotLiveActivityAttributes.self) { context in
            ActivityCard(context: context)
                .activityBackgroundTint(Color.black)
                .activitySystemActionForegroundColor(.white)
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    Label(context.state.title, systemImage: symbol(context.state.icon))
                        .font(.caption).lineLimit(1)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    ActivityValue(value: context.state.primary, end: activityEnd(context))
                        .font(.title2).monospacedDigit()
                        .multilineTextAlignment(.trailing)
                        .frame(maxWidth: 120, alignment: .trailing)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    ActivityDetails(context: context)
                }
            } compactLeading: {
                Image(systemName: symbol(context.state.icon)).foregroundStyle(toneColor(context.state.tone))
            } compactTrailing: {
                ActivityValue(value: context.state.primary, end: activityEnd(context))
                    .font(.caption).monospacedDigit()
                    .multilineTextAlignment(.trailing)
                    .frame(width: 58, alignment: .trailing)
            } minimal: {
                Image(systemName: symbol(context.state.icon)).foregroundStyle(toneColor(context.state.tone))
            }
        }
    }
}

private func activityEnd(_ context: ActivityViewContext<RyotLiveActivityAttributes>) -> Date {
    context.attributes.startedAt.addingTimeInterval(8 * 60 * 60)
}

private func symbol(_ icon: String) -> String {
    switch icon {
    case "timer": return "timer"
    case "progress": return "chart.bar.fill"
    default: return "waveform.path"
    }
}

private func toneColor(_ tone: String) -> Color {
    switch tone {
    case "success": return .green
    case "warning": return .yellow
    case "neutral": return .white
    default: return .orange
    }
}

private struct ActivityValue: View {
    let value: RyotLiveActivityAttributes.Value
    let end: Date

    var body: some View {
        Group {
            switch value.kind {
            case .text:
                Text(value.text ?? "")
            case .duration:
                Text(duration(value.seconds ?? 0))
            case .elapsed:
                if let start = value.startedAt {
                    Text(timerInterval: start...max(start, end), countsDown: false)
                }
            case .countdown:
                if let start = value.startedAt, let deadline = value.deadline {
                    Text(timerInterval: start...max(start, deadline), countsDown: true)
                }
            }
        }
        .lineLimit(1)
        .minimumScaleFactor(0.7)
        .accessibilityLabel(value.label)
        .privacySensitive()
    }

    private func duration(_ seconds: Double) -> String {
        let total = Int(min(Double(Int.max / 2), max(0, seconds)))
        return total >= 3600
            ? String(format: "%d:%02d:%02d", total / 3600, total / 60 % 60, total % 60)
            : String(format: "%d:%02d", total / 60, total % 60)
    }
}

private struct ActivityCard: View {
    let context: ActivityViewContext<RyotLiveActivityAttributes>

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Label(context.state.title, systemImage: symbol(context.state.icon))
                    .font(.subheadline.weight(.semibold)).lineLimit(1).privacySensitive()
                Spacer(minLength: 8)
                ActivityValue(value: context.state.primary, end: activityEnd(context))
                    .font(.title2.weight(.semibold)).monospacedDigit()
                    .multilineTextAlignment(.trailing)
                    .frame(maxWidth: 120, alignment: .trailing)
            }
            ActivityDetails(context: context)
        }
        .foregroundStyle(.white)
        .tint(toneColor(context.state.tone))
        .padding(14)
    }
}

private struct ActivityDetails: View {
    let context: ActivityViewContext<RyotLiveActivityAttributes>

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(context.isStale ? (context.state.staleMessage ?? "Open Ryot to refresh") : context.state.status)
                .font(.subheadline.weight(.medium)).foregroundStyle(toneColor(context.state.tone)).lineLimit(1)
            if let detail = context.state.detail, !detail.isEmpty {
                Text(detail).font(.caption).lineLimit(1).privacySensitive()
            }
            if context.state.primary.kind == .countdown,
               let start = context.state.primary.startedAt, let deadline = context.state.primary.deadline {
                ProgressView(timerInterval: start...max(start, deadline), countsDown: false) { EmptyView() } currentValueLabel: { EmptyView() }
            } else if let progress = context.state.progress {
                ProgressView(value: progress)
            }
            HStack(alignment: .firstTextBaseline, spacing: 16) {
                if let secondary = context.state.secondary {
                    HStack(spacing: 4) {
                        Text(secondary.label)
                        ActivityValue(value: secondary, end: activityEnd(context)).monospacedDigit()
                    }
                }
                ForEach(context.state.metrics.indices, id: \.self) { index in
                    let metric = context.state.metrics[index]
                    Text("\(metric.label) \(metric.value)").lineLimit(1).privacySensitive()
                }
            }
            .font(.caption2)
        }
    }
}
