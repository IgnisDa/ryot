import type { MetadataLookupResult } from "@ryot/media-fitness/operations/schemas";
import { debounce, throttle } from "@ryot/ts-utils/lodash";

import { storage } from "#imports";

import { MESSAGE_TYPES, MIN_VIDEO_DURATION_SECONDS, STORAGE_KEYS } from "../lib/constants";
import type { RawMediaData } from "../lib/extension-types";
import { ExtensionStatus } from "../lib/extension-types";
import { logger } from "../lib/logger";
import { MetadataCache } from "../lib/metadata-cache";
import { extractMetadataTitle } from "../lib/metadata-extractor";

async function getHasFoundVideo(): Promise<boolean> {
	return (await storage.getItem<boolean>(STORAGE_KEYS.HAS_FOUND_VIDEO)) ?? false;
}

async function setHasFoundVideo(value: boolean): Promise<void> {
	await storage.setItem(STORAGE_KEYS.HAS_FOUND_VIDEO, value);
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

async function updateExtensionStatus(status: ExtensionStatus) {
	await storage.setItem(STORAGE_KEYS.EXTENSION_STATUS, status);
}

function findBestVideo(): HTMLVideoElement | null {
	const videos = document.querySelectorAll("video");
	let bestVideo: HTMLVideoElement | null = null;
	let highestScore = -1;

	for (const video of videos) {
		if (video.readyState <= 0 || video.duration < MIN_VIDEO_DURATION_SECONDS) {
			continue;
		}

		let score = 0;
		if (!video.paused && !video.ended) {
			score += 10;
		}
		if (video.readyState > 2) {
			score += 5;
		}
		if (video.duration > 0) {
			score += 1;
		}

		if (score > highestScore) {
			highestScore = score;
			bestVideo = video;
		}
	}

	return bestVideo;
}

function extractProgressData(video: HTMLVideoElement): RawMediaData | null {
	const title = extractMetadataTitle();
	if (!title || !video.duration || video.duration < MIN_VIDEO_DURATION_SECONDS) {
		return null;
	}

	return {
		title,
		progress: (video.currentTime / video.duration) * 100,
	};
}

async function sendProgressUpdate(progressData: RawMediaData, metadata: MetadataLookupResult) {
	try {
		await browser.runtime.sendMessage({
			type: MESSAGE_TYPES.SEND_PROGRESS_DATA,
			data: { rawData: progressData, metadata },
		});
	} catch (error) {
		logger.error("Failed to send progress update", { error });
	}
}

export default defineContentScript({
	allFrames: true,
	matches: ["*://*/*"],
	runAt: "document_start",
	main() {
		let metadataCache: MetadataCache | null = null;
		let isRunning = false;
		let currentUrl = window.location.href;
		let navigationListenersAttached = false;

		let retryAttempts = 0;
		const MAX_RETRY_ATTEMPTS = 10;
		const RETRY_INTERVALS = [2000, 3000, 4000, 5000, 6000, 8000, 10000, 12000, 15000, 20000];
		let retryTimeoutId: ReturnType<typeof setTimeout> | null = null;

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

		async function getOrLookupMetadata(): Promise<MetadataLookupResult | null> {
			const title = extractMetadataTitle();
			if (!title) {
				return null;
			}

			if (!metadataCache) {
				return null;
			}

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

		function startTrackingWithMetadataAndVideo(
			metadata: MetadataLookupResult,
			video: HTMLVideoElement,
		) {
			void updateExtensionStatus(ExtensionStatus.TrackingActive);

			const sendProgress = () => {
				if (!document.contains(video) || !isRunning || currentUrl !== window.location.href) {
					return;
				}

				const progressData = extractProgressData(video);
				if (progressData) {
					logger.debug("Sending progress", {
						title: progressData.title,
						progress: `${progressData.progress || 0}%`,
						showInformation: metadata.status === "notFound" ? null : metadata.showInformation,
					});
					void sendProgressUpdate(progressData, metadata);
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
				void detectVideoWithRetry();
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
					void detectVideoWithRetry();
				}
			};

			const handleVideoReady = () => {
				void checkVideoReady();
			};

			video.addEventListener("loadedmetadata", handleVideoReady, {
				signal: cleanup.abortController.signal,
			});
			video.addEventListener("durationchange", handleVideoReady, {
				signal: cleanup.abortController.signal,
			});
			video.addEventListener("canplay", handleVideoReady, {
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
			void detectVideoWithRetry();
			setupVideoElementListeners();

			const checkForVideos = debounce(async () => {
				const hasFoundVideo = await getHasFoundVideo();
				if (!isRunning || currentUrl !== window.location.href || hasFoundVideo) {
					return;
				}
				void detectVideoWithRetry();
			}, 500);

			const observer = new MutationObserver((mutations) => {
				for (const mutation of mutations) {
					if (mutation.type === "childList") {
						for (const node of mutation.addedNodes) {
							if (node instanceof Element) {
								const element = node;

								if (element instanceof HTMLVideoElement) {
									attachVideoReadinessListeners(element);
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
									void checkForVideos();
									return;
								}
							}
						}
					} else if (
						mutation.type === "attributes" &&
						mutation.target instanceof HTMLVideoElement
					) {
						if (mutation.attributeName === "src" || mutation.attributeName === "currentSrc") {
							void checkForVideos();
						}
					}
				}
			});

			// oxlint-disable-next-line typescript/no-unnecessary-condition -- document.body can be null at document_start despite the non-null lib.dom.d.ts type
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

			void checkForVideos();
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
			if (navigationListenersAttached) {
				return;
			}

			navigationListenersAttached = true;

			const originalPushState = history.pushState.bind(history);
			const originalReplaceState = history.replaceState.bind(history);

			window.addEventListener("popstate", () => void handleUrlChange(), {
				signal: cleanup.abortController.signal,
			});

			history.pushState = function (...args) {
				originalPushState(...args);
				void handleUrlChange();
			};

			history.replaceState = function (...args) {
				originalReplaceState(...args);
				void handleUrlChange();
			};

			cleanup.abortController.signal.addEventListener("abort", () => {
				history.pushState = originalPushState;
				history.replaceState = originalReplaceState;
				navigationListenersAttached = false;
			});
		}

		function setupVisibilityListener() {
			const handleVisibilityChange = async () => {
				if (document.hidden) {
					logger.debug("Page hidden, stopping loop");
					stopMainLoop();
					clearRetryTimeout();
					await setHasFoundVideo(false);
					retryAttempts = 0;
					return;
				}

				logger.debug("Page visible, restarting loop");
				if (!isRunning) {
					await startMainLoop();
				}
			};

			document.addEventListener("visibilitychange", () => void handleVisibilityChange(), {
				signal: cleanup.abortController.signal,
			});
		}

		async function init() {
			const integrationUrl = await storage.getItem<string>(STORAGE_KEYS.INTEGRATION_URL);

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
				void cleanup.cleanupAll();
			},
			{ signal: cleanup.abortController.signal },
		);

		if (document.readyState === "loading") {
			document.addEventListener(
				"DOMContentLoaded",
				() => {
					void init();
				},
				{ signal: cleanup.abortController.signal },
			);
		} else {
			void init();
		}
	},
});
