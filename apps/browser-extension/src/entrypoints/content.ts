import { debounce, throttle } from "@ryot/ts-utils";
import { storage } from "#imports";
import { MESSAGE_TYPES, STORAGE_KEYS } from "../lib/constants";
import type {
	ExtensionStatus,
	MetadataLookupData,
	RawMediaData,
} from "../lib/extension-types";
import { logger } from "../lib/logger";
import { MetadataCache } from "../lib/metadata-cache";
import { extractTitle } from "../lib/title-extractor";

export default defineContentScript({
	allFrames: true,
	matches: ["<all_urls>"],
	runAt: "document_start",
	main() {
		let metadataCache: MetadataCache | null = null;
		let isRunning = false;
		let currentUrl = window.location.href;

		const cleanup = {
			abortController: new AbortController(),

			cleanupAll() {
				this.abortController.abort();
				isRunning = false;

				logger.debug("All resources cleaned up");
			},
		};

		function sleep(ms: number): Promise<void> {
			return new Promise((resolve) => setTimeout(resolve, ms));
		}

		async function updateExtensionStatus(status: ExtensionStatus) {
			await storage.setItem(STORAGE_KEYS.EXTENSION_STATUS, status);
		}

		async function getOrLookupMetadata(): Promise<MetadataLookupData | null> {
			const title = extractTitle();
			if (!title) return null;

			if (!metadataCache) return null;

			let metadata = await metadataCache.getMetadataForCurrentPage();

			if (!metadata) {
				await updateExtensionStatus({
					state: "lookup_in_progress",
					message: "Metadata lookup under way...",
				});

				metadata = await metadataCache.lookupAndCacheMetadata();

				if (!metadata) {
					await updateExtensionStatus({
						state: "lookup_failed",
						message: "Metadata lookup failed - extension inactive",
					});
					return null;
				}
			}

			return metadata;
		}

		function findBestVideo(): HTMLVideoElement | null {
			const videos = document.querySelectorAll("video");

			for (const video of videos) {
				if (!video.paused && !video.ended && video.readyState > 0) {
					return video;
				}
			}

			for (const video of videos) {
				if (video.readyState > 0) {
					return video;
				}
			}

			return null;
		}

		function extractProgressData(video: HTMLVideoElement): RawMediaData | null {
			const title = extractTitle();
			if (!title || !video.duration || video.duration <= 0) return null;

			return {
				title,
				progress: (video.currentTime / video.duration) * 100,
			};
		}

		async function sendProgressUpdate(
			progressData: RawMediaData,
			metadata: MetadataLookupData,
		) {
			try {
				await browser.runtime.sendMessage({
					type: MESSAGE_TYPES.SEND_PROGRESS_DATA,
					data: { rawData: progressData, metadata },
				});
			} catch (error) {
				logger.error("Failed to send progress update", { error });
			}
		}

		function startTrackingWithMetadataAndVideo(
			metadata: MetadataLookupData,
			video: HTMLVideoElement,
		) {
			updateExtensionStatus({
				state: "tracking_active",
				message: "Tracking active",
				videoTitle: extractTitle() || "Unknown",
			});

			const sendProgress = () => {
				if (
					!document.contains(video) ||
					!isRunning ||
					currentUrl !== window.location.href
				) {
					return;
				}

				const progressData = extractProgressData(video);
				if (progressData) {
					logger.debug("Sending progress", {
						title: progressData.title,
						progress: `${Math.round(progressData.progress || 0)}%`,
					});
					sendProgressUpdate(progressData, metadata);
				}
			};

			const throttledProgressUpdate = throttle(sendProgress, 8000);

			video.addEventListener("timeupdate", throttledProgressUpdate, {
				signal: cleanup.abortController.signal,
			});
			video.addEventListener("play", sendProgress, {
				signal: cleanup.abortController.signal,
			});
			video.addEventListener("pause", sendProgress, {
				signal: cleanup.abortController.signal,
			});
			video.addEventListener(
				"ended",
				() => {
					logger.debug("Video ended, stopping tracking");
					sendProgress();
				},
				{
					signal: cleanup.abortController.signal,
				},
			);

			sendProgress();
		}

		async function startMainLoop() {
			isRunning = true;
			logger.debug("Starting video detection");

			await updateExtensionStatus({
				state: "idle",
				message: "Starting extension...",
			});

			setupVideoDetection();
		}

		function setupVideoDetection() {
			const checkForVideos = debounce(async () => {
				if (!isRunning || currentUrl !== window.location.href) return;

				try {
					const metadata = await getOrLookupMetadata();
					if (!metadata) return;

					const video = findBestVideo();
					if (!video) return;

					logger.debug("Video detected", {
						src: video.src || video.currentSrc,
					});

					await updateExtensionStatus({
						state: "video_detected",
						message: "Video found, starting tracking...",
						videoTitle: extractTitle() || "Unknown",
					});

					startTrackingWithMetadataAndVideo(metadata, video);
				} catch (error) {
					logger.error("Video detection error", { error });
				}
			}, 500);

			const observer = new MutationObserver((mutations) => {
				for (const mutation of mutations) {
					if (mutation.type === "childList") {
						for (const node of mutation.addedNodes) {
							if (node.nodeType === Node.ELEMENT_NODE) {
								const element = node as Element;
								if (
									element.tagName === "VIDEO" ||
									element.querySelector("video") ||
									element.matches(
										'[class*="video"], [class*="player"], [id*="video"], [id*="player"]',
									)
								) {
									checkForVideos();
									return;
								}
							}
						}
					} else if (
						mutation.type === "attributes" &&
						mutation.target instanceof HTMLVideoElement
					) {
						if (
							mutation.attributeName === "src" ||
							mutation.attributeName === "currentSrc"
						) {
							checkForVideos();
						}
					}
				}
			});

			if (document.body) {
				observer.observe(document.body, {
					childList: true,
					subtree: true,
					attributes: true,
					attributeFilter: ["src", "currentSrc"],
				});
			}

			cleanup.abortController.signal.addEventListener("abort", () => {
				observer.disconnect();
			});

			checkForVideos();
		}

		function stopMainLoop() {
			isRunning = false;
			logger.debug("Stopping main monitoring loop");
		}

		async function handleUrlChange() {
			logger.debug("URL changed, restarting extension");
			stopMainLoop();
			currentUrl = window.location.href;

			await updateExtensionStatus({
				state: "idle",
				message: "Page changed, restarting...",
			});

			await sleep(1000);
			await init();
		}

		function setupNavigationListeners() {
			window.addEventListener("popstate", handleUrlChange, {
				signal: cleanup.abortController.signal,
			});

			const originalPushState = history.pushState;
			const originalReplaceState = history.replaceState;

			history.pushState = function (...args) {
				originalPushState.apply(this, args);
				handleUrlChange();
			};

			history.replaceState = function (...args) {
				originalReplaceState.apply(this, args);
				handleUrlChange();
			};

			cleanup.abortController.signal.addEventListener("abort", () => {
				history.pushState = originalPushState;
				history.replaceState = originalReplaceState;
			});
		}

		function setupVisibilityListener() {
			document.addEventListener(
				"visibilitychange",
				() => {
					if (document.hidden) {
						logger.debug("Page hidden, stopping loop");
						stopMainLoop();
					} else {
						logger.debug("Page visible, restarting loop");
						if (!isRunning) {
							startMainLoop();
						}
					}
				},
				{ signal: cleanup.abortController.signal },
			);
		}

		async function init() {
			const integrationUrl = await storage.getItem<string>(
				STORAGE_KEYS.INTEGRATION_URL,
			);

			if (!integrationUrl) {
				logger.info("Integration URL not set, monitoring disabled");
				return;
			}

			logger.info("Integration URL found, initializing extension");

			metadataCache = new MetadataCache();

			setupNavigationListeners();
			setupVisibilityListener();

			await startMainLoop();
		}

		window.addEventListener(
			"beforeunload",
			() => {
				cleanup.cleanupAll();
			},
			{ signal: cleanup.abortController.signal },
		);

		if (document.readyState === "loading") {
			document.addEventListener(
				"DOMContentLoaded",
				() => {
					init();
				},
				{ signal: cleanup.abortController.signal },
			);
		} else {
			init();
		}
	},
});
