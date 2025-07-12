import { storage } from "#imports";
import { ApiClient } from "../lib/api-client";
import { STORAGE_KEYS } from "../lib/constants";
import type { CachedLookupData, RawMediaData } from "../lib/extension-types";
import { MetadataCache } from "../lib/metadata-cache";
import { ProgressTracker } from "../lib/progress-tracker";
import { VideoDetector } from "../lib/video-detector";

export default defineContentScript({
	allFrames: true,
	matches: ["<all_urls>"],
	runAt: "document_start",
	main() {
		const isIframe = window !== window.top;
		let apiClient: ApiClient | null = null;
		let videoDetector: VideoDetector | null = null;
		let metadataCache: MetadataCache | null = null;
		let progressTracker: ProgressTracker | null = null;

		function handleDataSend(data: RawMediaData) {
			console.log(
				"[RYOT] Sending progress:",
				data.title,
				`${Math.round((data.progress || 0) * 100)}%`,
			);

			apiClient?.sendProgressData(data);
		}

		function onVideoFound(video: HTMLVideoElement) {
			console.log("[RYOT] Video detected:", video.src || video.currentSrc);

			progressTracker?.startTracking(video);
		}

		function handleVisibilityChange() {
			if (document.hidden) {
				progressTracker?.pauseTracking();
			} else {
				progressTracker?.resumeTracking();
			}
		}

		async function handleUrlChange() {
			console.log("[RYOT] URL changed, checking metadata for new URL");

			if (metadataCache) {
				const cachedMetadata: CachedLookupData =
					await metadataCache.getMetadataForCurrentPage();

				if (cachedMetadata) {
					console.log("[RYOT] Found cached metadata for new URL");
					videoDetector?.start();
				} else {
					console.log(
						"[RYOT] No cached metadata, performing lookup for new URL",
					);
					const lookupResult = await metadataCache.lookupAndCacheMetadata();

					if (lookupResult) {
						console.log("[RYOT] Metadata lookup successful for new URL");
						videoDetector?.start();
					} else {
						console.log(
							"[RYOT] Metadata lookup failed for new URL, stopping video monitoring",
						);
						progressTracker?.stopTracking();
					}
				}
			}
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

			console.log("[RYOT] Integration URL found, checking metadata");

			metadataCache = new MetadataCache();

			const cachedMetadata: CachedLookupData =
				await metadataCache.getMetadataForCurrentPage();

			if (cachedMetadata) {
				console.log("[RYOT] Using cached metadata for current page");
				startVideoMonitoring();
			} else {
				console.log("[RYOT] No cached metadata, performing lookup");
				const lookupResult = await metadataCache.lookupAndCacheMetadata();

				if (lookupResult) {
					console.log(
						"[RYOT] Metadata lookup successful, starting video monitoring",
					);
					startVideoMonitoring();
				} else {
					console.log(
						"[RYOT] Metadata lookup failed, video monitoring disabled",
					);
				}
			}
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
			apiClient = new ApiClient();
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
