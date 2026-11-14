import Foundation
import XCTest
@testable import IosLiveActivityPolicy

final class RegistryTests: XCTestCase {
    private let now = Date(timeIntervalSince1970: 1_800_000_000)

    private func record(_ key: String, owner: String = "fitness", state: String = "active", age: TimeInterval = 0) -> IosLiveActivityRecord {
        IosLiveActivityRecord(owner: owner, key: key, startedAt: now.addingTimeInterval(-age), state: state)
    }

    func testMissingActivitiesBecomeDismissedWithoutForgettingTheSession() {
        let entries = [record("running"), record("rest", state: "stale"), record("saved", state: "ended")]
        let next = IosLiveActivityRegistry.reconcile(entries, activities: [])
        XCTAssertEqual(next.map(\.key), ["running", "rest", "saved"])
        XCTAssertEqual(next.map(\.state), ["dismissed", "dismissed", "ended"])
    }

    func testNativeDiscoveryRecoversLostStartRepliesWithoutDuplicatingEntries() {
        let native = [record("session", state: "stale"), record("session", owner: "other")]
        let recovered = IosLiveActivityRegistry.reconcile([record("session")], activities: native)
        XCTAssertEqual(recovered, native)
        XCTAssertEqual(IosLiveActivityRegistry.reconcile(recovered, activities: native), native)
    }

    func testPruningKeepsRecentDismissalsAndActiveSessions() {
        let entries = [record("recent", state: "dismissed", age: 60), record("expired", state: "ended", age: 28_801), record("active", age: 28_801)]
        XCTAssertEqual(IosLiveActivityRegistry.prune(entries, now: now).map(\.key), ["recent", "active"])
    }

    func testCapacityDoesNotReplaceAnotherPluginOrDuplicateAnOwner() {
        let active = [record("one"), record("two", owner: "import", state: "stale")]
        XCTAssertFalse(IosLiveActivityRegistry.hasCapacity(active, owner: "fitness"))
        XCTAssertTrue(IosLiveActivityRegistry.hasCapacity(active, owner: "focus"))
        let full = active + [record("three", owner: "focus"), record("four", owner: "media")]
        XCTAssertFalse(IosLiveActivityRegistry.hasCapacity(full, owner: "another"))
        XCTAssertTrue(IosLiveActivityRegistry.hasCapacity([record("old", state: "ended")], owner: "fitness"))
    }
}
