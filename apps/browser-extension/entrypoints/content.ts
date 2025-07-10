import { ApiClient } from "../lib/api-client";
import { ProgressTracker } from "../lib/progress-tracker";
import { VideoDetector } from "../lib/video-detector";
import type { RawMediaData } from "../types/progress";

export default defineContentScript({
	matches: ["<all_urls>"],
	runAt: "document_start",
	main() {
		let videoDetector: VideoDetector | null = null;
		let progressTracker: ProgressTracker | null = null;
		let apiClient: ApiClient | null = null;

		function handleDataSend(data: RawMediaData) {
			console.log(
				"[RYOT] Sending progress:",
				data.title,
				`${Math.round((data.progress || 0) * 100)}%`,
			);

			if (apiClient) {
				apiClient.sendProgressData(data);
			}
		}

		function onVideoFound(video: HTMLVideoElement) {
			console.log("[RYOT] Video detected:", video.src || video.currentSrc);

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
			apiClient = new ApiClient();
			progressTracker = new ProgressTracker(handleDataSend);
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
