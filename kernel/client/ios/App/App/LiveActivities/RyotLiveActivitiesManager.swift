import ActivityKit
import Foundation
import os
import UIKit

@available(iOS 16.2, *)
@MainActor
final class RyotLiveActivitiesManager {
    static let shared = RyotLiveActivitiesManager()
    private let registryKey = "ryot.live-activities"
    private let maximumRegistryEntries = 128
    private var registry: [IosLiveActivityRecord]
    private var observations: [String: Task<Void, Never>] = [:]
    private let logger = Logger(subsystem: "Ryot", category: "LiveActivities")

    private enum RequestError: Error { case invalidContent }

    private init() {
        if let data = UserDefaults.standard.data(forKey: registryKey),
           let entries = try? JSONDecoder().decode([IosLiveActivityRecord].self, from: data) {
            registry = entries
        } else {
            registry = []
        }
        synchronize()
    }

    private func persist() {
        if let data = try? JSONEncoder().encode(registry) {
            UserDefaults.standard.set(data, forKey: registryKey)
        }
    }

    private func activity(owner: String, key: String) -> Activity<RyotLiveActivityAttributes>? {
        Activity<RyotLiveActivityAttributes>.activities.first {
            $0.attributes.owner == owner && $0.attributes.key == key
        }
    }

    private func state(_ activity: Activity<RyotLiveActivityAttributes>) -> String {
        switch activity.activityState {
        case .active: return "active"
        case .stale: return "stale"
        case .dismissed: return "dismissed"
        default: return "ended"
        }
    }

    private func synchronize() {
        let activities = Activity<RyotLiveActivityAttributes>.activities
        registry = IosLiveActivityRegistry.reconcile(registry, activities: activities.map {
            IosLiveActivityRecord(owner: $0.attributes.owner, key: $0.attributes.key, startedAt: $0.attributes.startedAt, state: state($0))
        })
        for activity in activities {
            if observations[activity.id] == nil && (activity.activityState == .active || activity.activityState == .stale) {
                observations[activity.id] = Task { [weak self] in
                    for await next in activity.activityStateUpdates {
                        guard let self else { return }
                        self.logger.notice("Activity state: \(String(describing: next), privacy: .public)")
                        self.synchronize()
                        if next == .dismissed || next == .ended {
                            self.observations.removeValue(forKey: activity.id)
                            return
                        }
                    }
                }
            }
        }
        persist()
    }

    func retainOwners(_ owners: Set<String>) async {
        synchronize()
        for activity in Activity<RyotLiveActivityAttributes>.activities where !owners.contains(activity.attributes.owner) {
            logger.notice("Ending activity after its authenticated owner was removed")
            await activity.end(nil, dismissalPolicy: .immediate)
        }
        synchronize()
    }

    private func content(_ raw: Any?) throws -> RyotLiveActivityAttributes.ContentState {
        guard let raw, JSONSerialization.isValidJSONObject(raw) else { throw RequestError.invalidContent }
        let data = try JSONSerialization.data(withJSONObject: raw)
        guard data.count <= 3072 else { throw RequestError.invalidContent }
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .custom { decoder in
            let value = try decoder.singleValueContainer().decode(String.self)
            let fractional = ISO8601DateFormatter()
            fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            if let date = fractional.date(from: value) ?? ISO8601DateFormatter().date(from: value) {
                return date
            }
            throw RequestError.invalidContent
        }
        let content = try decoder.decode(RyotLiveActivityAttributes.ContentState.self, from: data)
        for value in [content.primary, content.secondary].compactMap({ $0 }) {
            switch value.kind {
            case .text:
                guard value.text != nil else { throw RequestError.invalidContent }
            case .duration:
                guard let seconds = value.seconds, seconds.isFinite, seconds >= 0 else { throw RequestError.invalidContent }
            case .elapsed:
                guard value.startedAt != nil else { throw RequestError.invalidContent }
            case .countdown:
                guard let start = value.startedAt, let end = value.deadline, start <= end else { throw RequestError.invalidContent }
            }
        }
        return content
    }

    private func activityContent(_ content: RyotLiveActivityAttributes.ContentState) -> ActivityContent<RyotLiveActivityAttributes.ContentState> {
        ActivityContent(state: content, staleDate: content.staleAt)
    }

    func request(owner: String, request: [String: Any]) async throws -> [String: Any] {
        synchronize()
        guard let action = request["action"] as? String else { throw RequestError.invalidContent }
        if action == "availability" {
            return ["status": ActivityAuthorizationInfo().areActivitiesEnabled ? "available" : "disabled"]
        }
        if action == "list" {
            return ["status": "done", "activities": registry.filter { $0.owner == owner }.map { ["key": $0.key, "state": $0.state] }]
        }
        guard let key = request["key"] as? String, !key.isEmpty, key.count <= 128, owner.count == 64 else {
            throw RequestError.invalidContent
        }
        let existing = activity(owner: owner, key: key)
        if action == "end" {
            if let existing {
                let final = try request["content"].map { try content($0) }
                let delay = min(30, max(0, request["dismissalSeconds"] as? Double ?? 0))
                await existing.end(final.map(activityContent), dismissalPolicy: delay > 0 ? .after(Date().addingTimeInterval(delay)) : .immediate)
            }
            synchronize()
            return ["status": "ended"]
        }
        if let entry = registry.first(where: { $0.owner == owner && $0.key == key }), entry.state == "ended" || entry.state == "dismissed" {
            return ["status": entry.state]
        }
        guard ActivityAuthorizationInfo().areActivitiesEnabled else { return ["status": "disabled"] }
        let next = try content(request["content"])
        if let existing {
            guard try JSONEncoder().encode(existing.attributes).count + JSONEncoder().encode(next).count < 4096 else {
                throw RequestError.invalidContent
            }
            if existing.content.state != next {
                await existing.update(activityContent(next))
            }
            return ["status": "active"]
        }
        guard action == "start" else { return ["status": "ended"] }
        guard UIApplication.shared.applicationState == .active else { return ["status": "foreground-required"] }
        guard IosLiveActivityRegistry.hasCapacity(registry, owner: owner) else { return ["status": "capacity"] }
        let attributes = RyotLiveActivityAttributes(owner: owner, key: key, startedAt: Date())
        guard try JSONEncoder().encode(attributes).count + JSONEncoder().encode(next).count < 4096 else {
            throw RequestError.invalidContent
        }
        registry = IosLiveActivityRegistry.prune(registry, now: Date())
        if registry.count >= maximumRegistryEntries {
            return ["status": "capacity"]
        }
        do {
            _ = try Activity.request(attributes: attributes, content: activityContent(next), pushType: nil)
        } catch ActivityAuthorizationError.targetMaximumExceeded {
            return ["status": "capacity"]
        } catch ActivityAuthorizationError.globalMaximumExceeded {
            return ["status": "capacity"]
        }
        synchronize()
        return ["status": "active"]
    }
}
