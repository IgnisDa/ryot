import Capacitor
import UIKit

class RyotBridgeViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(RyotLiveActivitiesPlugin())

        guard let webView else { return }
        let container = UIView()
        view = container
        container.addSubview(webView)
        webView.translatesAutoresizingMaskIntoConstraints = false

        let keyboard = container.keyboardLayoutGuide
        if #available(iOS 17.0, *) {
            keyboard.usesBottomSafeArea = false
        }
        NSLayoutConstraint.activate([
            webView.topAnchor.constraint(equalTo: container.topAnchor),
            webView.leadingAnchor.constraint(equalTo: container.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: container.trailingAnchor),
            webView.bottomAnchor.constraint(equalTo: keyboard.topAnchor)
        ])
    }
}
