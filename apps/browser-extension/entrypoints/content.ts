import { ApiClient } from "../lib/api-client";
import { ProgressTracker } from "../lib/progress-tracker";
import { VideoDetector } from "../lib/video-detector";
import type { RawMediaData } from "../types/progress";

export default defineContentScript({
	matches: ["<all_urls>"],
	runAt: "document_start",
	main() {
		const WEBHOOK_URL =
			"https://webhook.site/26a6767d-0e5c-4291-babe-32a98445eaca";

		let videoDetector: VideoDetector | null = null;
		let progressTracker: ProgressTracker | null = null;
		let apiClient: ApiClient | null = null;

		function handleDataSend(data: RawMediaData) {
			if (apiClient) {
				apiClient.sendProgressData(data);
			}
		}

		function onVideoFound(video: HTMLVideoElement) {
			if (progressTracker) {
				progressTracker.startTracking(video);
			}
		}

		function handleVisibilityChange() {
			if (!progressTracker) return;

			if (document.hidden) {
				progressTracker.pauseTracking();
			} else {
				progressTracker.resumeTracking();
			}
		}

		function handleUrlChange() {
			if (videoDetector) {
				videoDetector.start();
			}
		}

		function init() {
			apiClient = new ApiClient(WEBHOOK_URL);
			progressTracker = new ProgressTracker(WEBHOOK_URL, handleDataSend);
			videoDetector = new VideoDetector(onVideoFound);

			videoDetector.start();

			document.addEventListener("visibilitychange", handleVisibilityChange);

			let lastUrl = window.location.href;
			new MutationObserver(() => {
				const currentUrl = window.location.href;
				if (currentUrl !== lastUrl) {
					lastUrl = currentUrl;
					handleUrlChange();
				}
			}).observe(document, { subtree: true, childList: true });
		}

		if (document.readyState === "loading") {
			document.addEventListener("DOMContentLoaded", init);
		} else {
			init();
		}
	},
});
