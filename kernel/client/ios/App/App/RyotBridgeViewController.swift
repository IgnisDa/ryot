import Capacitor

class RyotBridgeViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(RyotLiveActivitiesPlugin())
    }
}
