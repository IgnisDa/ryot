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
			urlMonitorInterval: null as NodeJS.Timeout | null,
			abortController: new AbortController(),

			cleanupAll() {
				if (this.urlMonitorInterval) {
					clearInterval(this.urlMonitorInterval);
					this.urlMonitorInterval = null;
				}

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
				runtime: video.duration,
				url: window.location.href,
				currentTime: video.currentTime,
				domain: window.location.hostname,
				timestamp: new Date().toISOString(),
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

		async function startTrackingWithMetadataAndVideo(
			metadata: MetadataLookupData,
			video: HTMLVideoElement,
		) {
			await updateExtensionStatus({
				state: "tracking_active",
				message: "Tracking active",
				videoTitle: extractTitle() || "Unknown",
			});

			while (isRunning && currentUrl === window.location.href) {
				if (!document.contains(video) || video.ended) {
					logger.debug("Video removed or ended, returning to main loop");
					break;
				}

				const progressData = extractProgressData(video);
				if (progressData) {
					logger.debug("Sending progress", {
						title: progressData.title,
						progress: `${Math.round(progressData.progress || 0)}%`,
					});
					await sendProgressUpdate(progressData, metadata);
				}

				await sleep(10000);
			}
		}

		async function startMainLoop() {
			isRunning = true;
			logger.debug("Starting main monitoring loop");

			await updateExtensionStatus({
				state: "idle",
				message: "Starting extension...",
			});

			while (isRunning && currentUrl === window.location.href) {
				try {
					const metadata = await getOrLookupMetadata();

					if (!metadata) {
						await sleep(5000);
						continue;
					}

					const video = findBestVideo();

					if (!video) {
						await sleep(2000);
						continue;
					}

					logger.debug("Video detected", {
						src: video.src || video.currentSrc,
					});
					await updateExtensionStatus({
						state: "video_detected",
						message: "Video found, starting tracking...",
						videoTitle: extractTitle() || "Unknown",
					});

					await startTrackingWithMetadataAndVideo(metadata, video);
				} catch (error) {
					logger.error("Main loop error", { error });
					await sleep(5000);
				}
			}
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

			if (!cleanup.urlMonitorInterval) {
				let lastUrl = window.location.href;
				cleanup.urlMonitorInterval = setInterval(() => {
					if (window.location.href !== lastUrl) {
						lastUrl = window.location.href;
						handleUrlChange();
					}
				}, 1000);

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
