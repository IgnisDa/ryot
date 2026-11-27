import ActivityKit
import Foundation

@available(iOS 16.2, *)
struct RyotLiveActivityAttributes: ActivityAttributes {
    struct Value: Codable, Hashable {
        enum Kind: String, Codable { case text, duration, elapsed, countdown }
        let kind: Kind
        let label: String
        let text: String?
        let seconds: Double?
        let startedAt: Date?
        let deadline: Date?
    }

    struct Metric: Codable, Hashable {
        let label: String
        let value: String
    }

    struct ContentState: Codable, Hashable {
        let title: String
        let status: String
        let detail: String?
        let primary: Value
        let secondary: Value?
        let icon: String
        let tone: String
        let progress: Double?
        let metrics: [Metric]
        let staleAt: Date?
        let staleMessage: String?
    }

    let owner: String
    let key: String
    let startedAt: Date
}
