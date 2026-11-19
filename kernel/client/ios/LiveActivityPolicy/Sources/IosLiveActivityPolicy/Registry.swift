import Foundation

struct IosLiveActivityRecord: Codable, Equatable {
    let owner: String
    let key: String
    let startedAt: Date
    var state: String
}

enum IosLiveActivityRegistry {
    static func reconcile(_ entries: [IosLiveActivityRecord], activities: [IosLiveActivityRecord]) -> [IosLiveActivityRecord] {
        var next = entries
        for activity in activities {
            if let index = next.firstIndex(where: { $0.owner == activity.owner && $0.key == activity.key }) {
                next[index] = activity
            } else {
                next.append(activity)
            }
        }
        for index in next.indices where next[index].state == "active" || next[index].state == "stale" {
            let entry = next[index]
            if !activities.contains(where: { $0.owner == entry.owner && $0.key == entry.key }) {
                next[index].state = "dismissed"
            }
        }
        return next
    }

    static func prune(_ entries: [IosLiveActivityRecord], now: Date) -> [IosLiveActivityRecord] {
        entries.filter {
            !(($0.state == "ended" || $0.state == "dismissed") && $0.startedAt < now.addingTimeInterval(-8 * 60 * 60))
        }
    }

    static func hasCapacity(_ activities: [IosLiveActivityRecord], owner: String) -> Bool {
        let active = activities.filter { $0.state == "active" || $0.state == "stale" }
        return active.count < 4 && !active.contains(where: { $0.owner == owner })
    }
}
