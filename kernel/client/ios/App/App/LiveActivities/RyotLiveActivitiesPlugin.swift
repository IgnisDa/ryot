import Capacitor
import Foundation

@objc(RyotLiveActivitiesPlugin)
public class RyotLiveActivitiesPlugin: CAPPlugin, CAPBridgedPlugin {
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
                call.resolve(try await RyotLiveActivitiesManager.shared.request(owner: owner, request: request))
            } catch {
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
