import { storage } from "#imports";
import { MESSAGE_TYPES, STORAGE_KEYS } from "../lib/constants";
import type { ExtensionStatus, RawMediaData } from "../lib/extension-types";
import { MetadataCache } from "../lib/metadata-cache";
import { ProgressTracker } from "../lib/progress-tracker";
import { VideoDetector } from "../lib/video-detector";

export default defineContentScript({
	allFrames: true,
	matches: ["<all_urls>"],
	runAt: "document_start",
	main() {
		const isIframe = window !== window.top;
		let videoDetector: VideoDetector | null = null;
		let metadataCache: MetadataCache | null = null;
		let progressTracker: ProgressTracker | null = null;

		async function handleDataSend(data: RawMediaData) {
			console.log(
				"[RYOT] Sending progress:",
				data.title,
				`${Math.round((data.progress || 0) * 100)}%`,
			);

			try {
				await browser.runtime.sendMessage({
					data: data,
					type: MESSAGE_TYPES.SEND_PROGRESS_DATA,
				});
			} catch (error) {
				console.error("[RYOT] Failed to send message to background:", error);
			}
		}

		async function onVideoFound(video: HTMLVideoElement) {
			console.log("[RYOT] Video detected:", video.src || video.currentSrc);

			const videoTitle = document.title || "Unknown Video";
			await updateExtensionStatus({
				videoTitle,
				state: "video_detected",
				message: "Video found, checking metadata...",
			});

			if (!metadataCache) {
				console.error("[RYOT] MetadataCache not initialized");
				await updateExtensionStatus({
					state: "lookup_failed",
					message: "Extension error - metadata cache not available",
				});
				return;
			}

			// Check for cached metadata first
			const cachedMetadata = await metadataCache.getMetadataForCurrentPage();

			if (cachedMetadata) {
				console.log("[RYOT] Using cached metadata for current page");
				await updateExtensionStatus({
					videoTitle,
					state: "tracking_active",
					message: "Tracking active (cached metadata)",
				});
				progressTracker?.startTracking(video);
			} else {
				console.log("[RYOT] No cached metadata, performing lookup");
				await updateExtensionStatus({
					videoTitle,
					state: "lookup_in_progress",
					message: "Metadata lookup under way...",
				});

				const lookupResult = await metadataCache.lookupAndCacheMetadata();

				if (lookupResult) {
					console.log("[RYOT] Metadata lookup successful, starting tracking");
					await updateExtensionStatus({
						videoTitle,
						state: "tracking_active",
						message: "Tracking active",
					});
					progressTracker?.startTracking(video);
				} else {
					console.log(
						"[RYOT] Metadata lookup failed, video monitoring disabled",
					);
					await updateExtensionStatus({
						state: "lookup_failed",
						message: "Metadata lookup failed - extension inactive",
					});
				}
			}
		}

		function handleVisibilityChange() {
			if (document.hidden) {
				progressTracker?.pauseTracking();
			} else {
				progressTracker?.resumeTracking();
			}
		}

		async function updateExtensionStatus(status: ExtensionStatus) {
			await storage.setItem(STORAGE_KEYS.EXTENSION_STATUS, status);
		}

		async function handleUrlChange() {
			console.log("[RYOT] URL changed, resetting to idle state");

			// Stop any current tracking
			progressTracker?.stopTracking();

			// Reset to idle state and wait for video detection
			await updateExtensionStatus({
				state: "idle",
				message: "Waiting for video detection...",
			});

			// Video detector will continue running and will trigger onVideoFound when a video is detected
		}

		async function init() {
			const integrationUrl = await storage.getItem<string>(
				STORAGE_KEYS.INTEGRATION_URL,
			);

			if (!integrationUrl) {
				console.log(
					"[RYOT] Integration URL not set, video monitoring disabled",
				);
				return;
			}

			console.log("[RYOT] Integration URL found, waiting for video detection");

			await updateExtensionStatus({
				state: "idle",
				message: "Waiting for video detection...",
			});

			metadataCache = new MetadataCache();
			startVideoMonitoring();
		}

		function startVideoMonitoring() {
			if (isIframe) {
				initIframeMode();
			} else {
				initMainFrameMode();
			}
		}

		function initIframeMode() {
			progressTracker = new ProgressTracker((data) => {
				try {
					window.top?.postMessage({ type: "iframe-video-progress", data }, "*");
				} catch {
					try {
						const parentOrigin = document.referrer
							? new URL(document.referrer).origin
							: "*";
						window.parent.postMessage(
							{ type: "iframe-video-progress", data },
							parentOrigin,
						);
					} catch (fallbackError) {
						console.error(
							"[RYOT] Failed to send iframe progress:",
							fallbackError,
						);
					}
				}
			}, metadataCache as MetadataCache);
			videoDetector = new VideoDetector(onVideoFound);
			videoDetector.start();
		}

		function initMainFrameMode() {
			progressTracker = new ProgressTracker(
				handleDataSend,
				metadataCache as MetadataCache,
			);
			videoDetector = new VideoDetector(onVideoFound);

			videoDetector.start();

			window.addEventListener("message", (event) => {
				if (
					event.data?.type === "iframe-video-progress" &&
					event.source !== window
				) {
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

		let isInitialized = false;

		async function initIfNeeded() {
			if (isInitialized) return;

			const integrationUrl = await storage.getItem<string>(
				STORAGE_KEYS.INTEGRATION_URL,
			);
			if (integrationUrl) {
				await init();
				isInitialized = true;
			}
		}

		storage.watch(STORAGE_KEYS.INTEGRATION_URL, async (newValue) => {
			if (newValue && !isInitialized) {
				console.log("[RYOT] Integration URL added, starting video monitoring");
				await init();
				isInitialized = true;
			} else if (!newValue && isInitialized) {
				console.log(
					"[RYOT] Integration URL removed, stopping video monitoring",
				);
				videoDetector?.stop();
				progressTracker?.stopTracking();
				isInitialized = false;
			}
		});

		if (document.readyState === "loading") {
			document.addEventListener("DOMContentLoaded", initIfNeeded);
		} else {
			initIfNeeded();
		}
	},
});
