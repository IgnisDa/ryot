import { debounce, throttle } from "@ryot/ts-utils";
import { storage } from "#imports";
import {
	MESSAGE_TYPES,
	MIN_VIDEO_DURATION_SECONDS,
	STORAGE_KEYS,
} from "../lib/constants";
import type { MetadataLookupData, RawMediaData } from "../lib/extension-types";
import { ExtensionStatus } from "../lib/extension-types";
import { logger } from "../lib/logger";
import { MetadataCache } from "../lib/metadata-cache";
import { extractMetadataTitle } from "../lib/metadata-extractor";

export default defineContentScript({
	allFrames: true,
	matches: ["*://*/*"],
	runAt: "document_start",
	main() {
		let metadataCache: MetadataCache | null = null;
		let isRunning = false;
		let currentUrl = window.location.href;

		let retryAttempts = 0;
		const MAX_RETRY_ATTEMPTS = 10;
		const RETRY_INTERVALS = [
			2000, 3000, 4000, 5000, 6000, 8000, 10000, 12000, 15000, 20000,
		];
		let retryTimeoutId: ReturnType<typeof setTimeout> | null = null;

		async function getHasFoundVideo(): Promise<boolean> {
			return (
				(await storage.getItem<boolean>(STORAGE_KEYS.HAS_FOUND_VIDEO)) || false
			);
		}

		async function setHasFoundVideo(value: boolean): Promise<void> {
			await storage.setItem(STORAGE_KEYS.HAS_FOUND_VIDEO, value);
		}

		const cleanup = {
			abortController: new AbortController(),

			async cleanupAll() {
				this.abortController.abort();
				clearRetryTimeout();
				isRunning = false;
				await setHasFoundVideo(false);
				retryAttempts = 0;
				logger.cleanup();
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
			const title = extractMetadataTitle();
			if (!title) return null;

			if (!metadataCache) return null;

			let metadata = await metadataCache.getMetadataForCurrentPage();

			if (!metadata) {
				await updateExtensionStatus(ExtensionStatus.LookupInProgress);

				metadata = await metadataCache.lookupAndCacheMetadata();

				if (!metadata) {
					await updateExtensionStatus(ExtensionStatus.LookupFailed);
					return null;
				}
			}

			return metadata;
		}

		function findBestVideo(): HTMLVideoElement | null {
			const videos = document.querySelectorAll("video");
			let bestVideo: HTMLVideoElement | null = null;
			let highestScore = -1;

			for (const video of videos) {
				if (
					video.readyState <= 0 ||
					video.duration < MIN_VIDEO_DURATION_SECONDS
				) {
					continue;
				}

				let score = 0;
				if (!video.paused && !video.ended) score += 10;
				if (video.readyState > 2) score += 5;
				if (video.duration > 0) score += 1;

				if (score > highestScore) {
					highestScore = score;
					bestVideo = video;
				}
			}

			return bestVideo;
		}

		function extractProgressData(video: HTMLVideoElement): RawMediaData | null {
			const title = extractMetadataTitle();
			if (
				!title ||
				!video.duration ||
				video.duration < MIN_VIDEO_DURATION_SECONDS
			)
				return null;

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
			updateExtensionStatus(ExtensionStatus.TrackingActive);

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
						progress: `${progressData.progress || 0}%`,
						showInformation:
							"notFound" in metadata ? null : metadata.showInformation,
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

		async function detectVideoWithRetry() {
			const hasFoundVideo = await getHasFoundVideo();
			if (hasFoundVideo || retryAttempts >= MAX_RETRY_ATTEMPTS) {
				return;
			}

			const metadata = await getOrLookupMetadata();
			if (!metadata) {
				scheduleRetry();
				return;
			}

			const video = findBestVideo();
			if (!video) {
				scheduleRetry();
				return;
			}

			await setHasFoundVideo(true);
			clearRetryTimeout();
			logger.debug(`Video detected after ${retryAttempts} attempts`);
			await updateExtensionStatus(ExtensionStatus.VideoDetected);
			startTrackingWithMetadataAndVideo(metadata, video);
		}

		function scheduleRetry() {
			if (retryAttempts >= MAX_RETRY_ATTEMPTS) {
				logger.debug("Max retry attempts reached, giving up video detection");
				return;
			}

			const delay = RETRY_INTERVALS[retryAttempts] || 20000;
			retryAttempts++;

			logger.debug(`Scheduling retry attempt ${retryAttempts} in ${delay}ms`);

			retryTimeoutId = setTimeout(() => {
				detectVideoWithRetry();
			}, delay);
		}

		function clearRetryTimeout() {
			if (retryTimeoutId) {
				clearTimeout(retryTimeoutId);
				retryTimeoutId = null;
			}
		}

		function setupVideoElementListeners() {
			const videos = document.querySelectorAll("video");
			for (const video of videos) {
				attachVideoReadinessListeners(video);
			}
		}

		function attachVideoReadinessListeners(video: HTMLVideoElement) {
			const checkVideoReady = async () => {
				const hasFoundVideo = await getHasFoundVideo();
				if (
					!hasFoundVideo &&
					video.readyState > 0 &&
					video.duration >= MIN_VIDEO_DURATION_SECONDS
				) {
					logger.debug("Video became ready, triggering detection");
					detectVideoWithRetry();
				}
			};

			video.addEventListener("loadedmetadata", checkVideoReady, {
				signal: cleanup.abortController.signal,
			});
			video.addEventListener("durationchange", checkVideoReady, {
				signal: cleanup.abortController.signal,
			});
			video.addEventListener("canplay", checkVideoReady, {
				signal: cleanup.abortController.signal,
			});
		}

		async function startMainLoop() {
			isRunning = true;
			logger.debug("Starting video detection");

			await updateExtensionStatus(ExtensionStatus.Idle);

			setupVideoDetection();
		}

		function setupVideoDetection() {
			detectVideoWithRetry();
			setupVideoElementListeners();

			const checkForVideos = debounce(async () => {
				const hasFoundVideo = await getHasFoundVideo();
				if (!isRunning || currentUrl !== window.location.href || hasFoundVideo)
					return;
				detectVideoWithRetry();
			}, 500);

			const observer = new MutationObserver((mutations) => {
				for (const mutation of mutations) {
					if (mutation.type === "childList") {
						for (const node of mutation.addedNodes) {
							if (node.nodeType === Node.ELEMENT_NODE) {
								const element = node as Element;

								if (element.tagName === "VIDEO") {
									attachVideoReadinessListeners(element as HTMLVideoElement);
								} else if (element.querySelector("video")) {
									for (const video of element.querySelectorAll("video")) {
										attachVideoReadinessListeners(video);
									}
								}

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
				clearRetryTimeout();
			});

			checkForVideos();
		}

		function stopMainLoop() {
			isRunning = false;
			logger.debug("Stopping main monitoring loop");
		}

		async function handleUrlChange() {
			logger.debug("URL changed, resetting video detection");
			stopMainLoop();
			clearRetryTimeout();

			retryAttempts = 0;
			await setHasFoundVideo(false);

			currentUrl = window.location.href;
			await updateExtensionStatus(ExtensionStatus.Idle);
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
				async () => {
					if (document.hidden) {
						logger.debug("Page hidden, stopping loop");
						stopMainLoop();
						clearRetryTimeout();
						await setHasFoundVideo(false);
						retryAttempts = 0;
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
