import { ApiClient } from "../lib/api-client";
import { ProgressTracker } from "../lib/progress-tracker";
import { VideoDetector } from "../lib/video-detector";
import type { RawMediaData } from "../types/progress";

export default defineContentScript({
	matches: ["<all_urls>"],
	runAt: "document_start",
	allFrames: true,
	main() {
		const isIframe = window !== window.top;
		let videoDetector: VideoDetector | null = null;
		let progressTracker: ProgressTracker | null = null;
		let apiClient: ApiClient | null = null;

		function handleDataSend(data: RawMediaData) {
			console.log("[RYOT] handleDataSend called with:", data);
			console.log(
				"[RYOT] Sending progress:",
				data.title,
				`${Math.round((data.progress || 0) * 100)}%`,
			);

			if (apiClient) {
				apiClient.sendProgressData(data);
			} else {
				console.error("[RYOT] No API client available to send progress data");
			}
		}

		function onVideoFound(video: HTMLVideoElement) {
			console.log("[RYOT] Video detected:", {
				src: video.src || video.currentSrc,
				duration: video.duration,
				currentTime: video.currentTime,
				readyState: video.readyState,
				paused: video.paused,
				ended: video.ended,
			});

			if (progressTracker) {
				progressTracker.startTracking(video);
			} else {
				console.error("[RYOT] No progress tracker available");
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
			console.log("[RYOT] Content script init called, isIframe:", isIframe);
			if (isIframe) {
				initIframeMode();
			} else {
				initMainFrameMode();
			}
		}

		function initIframeMode() {
			console.log("[RYOT] Initializing iframe mode");
			console.log("[RYOT] Current window location:", window.location.href);
			console.log("[RYOT] Document referrer:", document.referrer);
			console.log(
				"[RYOT] Parent window:",
				window.parent !== window ? "exists" : "same as current",
			);

			progressTracker = new ProgressTracker((data) => {
				console.log("[RYOT] Iframe sending progress data to top frame:", data);

				try {
					// Send to top-level window instead of just parent
					window.top?.postMessage({ type: "iframe-video-progress", data }, "*");
					console.log("[RYOT] Message posted to top frame successfully");
				} catch (error) {
					console.error("[RYOT] Failed to post message to top frame:", error);

					// Fallback to parent frame
					try {
						const parentOrigin = document.referrer
							? new URL(document.referrer).origin
							: "*";
						console.log(
							"[RYOT] Fallback: posting to parent origin:",
							parentOrigin,
						);
						window.parent.postMessage(
							{ type: "iframe-video-progress", data },
							parentOrigin,
						);
						console.log("[RYOT] Fallback message posted successfully");
					} catch (fallbackError) {
						console.error("[RYOT] Fallback also failed:", fallbackError);
					}
				}
			});
			videoDetector = new VideoDetector(onVideoFound);
			videoDetector.start();
		}

		function initMainFrameMode() {
			console.log("[RYOT] Initializing main frame mode");
			apiClient = new ApiClient();
			progressTracker = new ProgressTracker(handleDataSend);
			videoDetector = new VideoDetector(onVideoFound);

			console.log("[RYOT] API client created:", !!apiClient);
			console.log("[RYOT] Progress tracker created:", !!progressTracker);

			videoDetector.start();

			window.addEventListener("message", (event) => {
				console.log("[RYOT] Main frame received message:", event.data);
				if (
					event.data?.type === "iframe-video-progress" &&
					event.source !== window
				) {
					console.log("[RYOT] Processing iframe video progress data");
					handleDataSend(event.data.data);
				}
			});

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
