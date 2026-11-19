import Capacitor
import Foundation
import os

@objc(RyotLiveActivitiesPlugin)
public class RyotLiveActivitiesPlugin: CAPPlugin, CAPBridgedPlugin {
    private static let logger = Logger(subsystem: "Ryot", category: "LiveActivities")
    public let identifier = "RyotLiveActivitiesPlugin"
    public let jsName = "RyotLiveActivities"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "request", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "retainOwners", returnType: CAPPluginReturnPromise)
    ]

    @objc func request(_ call: CAPPluginCall) {
        guard #available(iOS 16.2, *) else {
            call.resolve(["status": "unsupported"])
            return
        }
        guard let owner = call.getString("owner"),
              let request = call.getObject("request") else {
            call.reject("Invalid Live Activity request")
            return
        }
        Task { @MainActor in
            do {
                let result = try await RyotLiveActivitiesManager.shared.request(owner: owner, request: request)
                if let action = request["action"] as? String,
                   let status = result["status"] as? String,
                   (action != "list" && action != "update") || (status != "active" && status != "done") {
                    Self.logger.notice("Request \(action, privacy: .public): \(status, privacy: .public)")
                }
                call.resolve(result)
            } catch {
                Self.logger.error("Request failed: \(String(describing: error), privacy: .public)")
                call.reject("Live Activity request failed", nil, error)
            }
        }
    }

    @objc func retainOwners(_ call: CAPPluginCall) {
        guard #available(iOS 16.2, *) else {
            call.resolve()
            return
        }
        guard let owners = call.getArray("owners", String.self) else {
            call.reject("Invalid Live Activity owners")
            return
        }
        Task { @MainActor in
            await RyotLiveActivitiesManager.shared.retainOwners(Set(owners))
            call.resolve()
        }
    }
}
