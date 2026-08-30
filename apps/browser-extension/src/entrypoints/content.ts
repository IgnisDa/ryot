import type { MetadataLookupResult } from "@ryot-app/media-plugin/contracts/operations";
import { debounce, throttle } from "@ryot-app/ts-utils/lodash";
import { Effect, Fiber } from "effect";

import { storage } from "#imports";

import { MESSAGE_TYPES, MIN_VIDEO_DURATION_SECONDS, STORAGE_KEYS } from "../lib/constants";
import type { RawMediaData } from "../lib/extension-types";
import { ExtensionStatus } from "../lib/extension-types";
import { logger } from "../lib/logger";
import { MetadataCache } from "../lib/metadata-cache";
import { extractMetadataTitle } from "../lib/metadata-extractor";
import { fromPlatform, run } from "../lib/platform";

const getHasFoundVideo = () =>
	fromPlatform(() => storage.getItem<boolean>(STORAGE_KEYS.HAS_FOUND_VIDEO)).pipe(
		Effect.map((value) => value ?? false),
	);

const setHasFoundVideo = (value: boolean) =>
	fromPlatform(() => storage.setItem(STORAGE_KEYS.HAS_FOUND_VIDEO, value));

const updateExtensionStatus = (status: ExtensionStatus) =>
	fromPlatform(() => storage.setItem(STORAGE_KEYS.EXTENSION_STATUS, status));

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

	return { title, progress: (video.currentTime / video.duration) * 100 };
}

const sendProgressUpdate = (progressData: RawMediaData, metadata: MetadataLookupResult) =>
	fromPlatform(() =>
		browser.runtime.sendMessage({
			type: MESSAGE_TYPES.SEND_PROGRESS_DATA,
			data: { metadata, rawData: progressData },
		}),
	).pipe(
		Effect.catch((error) =>
			Effect.sync(() => {
				logger.error("Failed to send progress update", { error });
			}),
		),
	);

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
		let retryFiber: Fiber.Fiber<void> | null = null;

		const cleanup = {
			abortController: new AbortController(),

			cleanupAll() {
				const controller = this.abortController;
				return Effect.gen(function* () {
					controller.abort();
					clearRetry();
					isRunning = false;
					yield* setHasFoundVideo(false);
					retryAttempts = 0;
					logger.cleanup();
					logger.debug("All resources cleaned up");
				});
			},
		};

		const getOrLookupMetadata = Effect.fn("getOrLookupMetadata")(function* () {
			const title = extractMetadataTitle();
			if (!title) {
				return null;
			}

			if (!metadataCache) {
				return null;
			}

			let metadata = yield* metadataCache.getMetadataForCurrentPage();

			if (!metadata) {
				yield* updateExtensionStatus(ExtensionStatus.LookupInProgress);

				metadata = yield* metadataCache.lookupAndCacheMetadata();

				if (!metadata) {
					yield* updateExtensionStatus(ExtensionStatus.LookupFailed);
					return null;
				}
			}

			return metadata;
		});

		function startTrackingWithMetadataAndVideo(
			metadata: MetadataLookupResult,
			video: HTMLVideoElement,
		) {
			run(updateExtensionStatus(ExtensionStatus.TrackingActive));

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
					run(sendProgressUpdate(progressData, metadata));
				}
			};

			const throttledProgressUpdate = throttle(sendProgress, 8000);

			video.addEventListener("timeupdate", throttledProgressUpdate, {
				signal: cleanup.abortController.signal,
			});
			video.addEventListener("play", sendProgress, { signal: cleanup.abortController.signal });
			video.addEventListener("pause", sendProgress, { signal: cleanup.abortController.signal });
			video.addEventListener(
				"ended",
				() => {
					logger.debug("Video ended, stopping tracking");
					sendProgress();
				},
				{ signal: cleanup.abortController.signal },
			);

			sendProgress();
		}

		const detectVideoWithRetry = Effect.fn("detectVideoWithRetry")(function* () {
			const hasFoundVideo = yield* getHasFoundVideo();
			if (hasFoundVideo || retryAttempts >= MAX_RETRY_ATTEMPTS) {
				return;
			}

			const metadata = yield* getOrLookupMetadata();
			if (!metadata) {
				scheduleRetry();
				return;
			}

			const video = findBestVideo();
			if (!video) {
				scheduleRetry();
				return;
			}

			yield* setHasFoundVideo(true);
			clearRetry();
			logger.debug(`Video detected after ${retryAttempts} attempts`);
			yield* updateExtensionStatus(ExtensionStatus.VideoDetected);
			startTrackingWithMetadataAndVideo(metadata, video);
		});

		function scheduleRetry() {
			if (retryAttempts >= MAX_RETRY_ATTEMPTS) {
				logger.debug("Max retry attempts reached, giving up video detection");
				return;
			}

			const delay = RETRY_INTERVALS[retryAttempts] || 20000;
			retryAttempts++;

			logger.debug(`Scheduling retry attempt ${retryAttempts} in ${delay}ms`);

			retryFiber = Effect.runFork(
				Effect.sleep(delay).pipe(Effect.tap(() => Effect.sync(() => run(detectVideoWithRetry())))),
			);
		}

		function clearRetry() {
			if (retryFiber) {
				Effect.runFork(Fiber.interrupt(retryFiber));
				retryFiber = null;
			}
		}

		function setupVideoElementListeners() {
			const videos = document.querySelectorAll("video");
			for (const video of videos) {
				attachVideoReadinessListeners(video);
			}
		}

		function attachVideoReadinessListeners(video: HTMLVideoElement) {
			const checkVideoReady = Effect.fn("checkVideoReady")(function* () {
				const hasFoundVideo = yield* getHasFoundVideo();
				if (
					!hasFoundVideo &&
					video.readyState > 0 &&
					video.duration >= MIN_VIDEO_DURATION_SECONDS
				) {
					logger.debug("Video became ready, triggering detection");
					run(detectVideoWithRetry());
				}
			});

			const handleVideoReady = () => {
				run(checkVideoReady());
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

		const startMainLoop = Effect.fn("startMainLoop")(function* () {
			isRunning = true;
			logger.debug("Starting video detection");

			yield* updateExtensionStatus(ExtensionStatus.Idle);

			setupVideoDetection();
		});

		function setupVideoDetection() {
			run(detectVideoWithRetry());
			setupVideoElementListeners();

			const checkForVideos = debounce(
				() =>
					run(
						Effect.gen(function* () {
							const hasFoundVideo = yield* getHasFoundVideo();
							if (!isRunning || currentUrl !== window.location.href || hasFoundVideo) {
								return;
							}
							run(detectVideoWithRetry());
						}),
					),
				500,
			);

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
									checkForVideos();
									return;
								}
							}
						}
					} else if (
						mutation.type === "attributes" &&
						mutation.target instanceof HTMLVideoElement
					) {
						if (mutation.attributeName === "src" || mutation.attributeName === "currentSrc") {
							checkForVideos();
						}
					}
				}
			});

			// oxlint-disable-next-line typescript/no-unnecessary-condition -- document.body can be null at document_start despite the non-null lib.dom.d.ts type
			if (document.body) {
				observer.observe(document.body, {
					subtree: true,
					childList: true,
					attributes: true,
					attributeFilter: ["src", "currentSrc"],
				});
			}

			cleanup.abortController.signal.addEventListener("abort", () => {
				observer.disconnect();
				clearRetry();
			});

			checkForVideos();
		}

		function stopMainLoop() {
			isRunning = false;
			logger.debug("Stopping main monitoring loop");
		}

		const handleUrlChange = Effect.fn("handleUrlChange")(function* () {
			logger.debug("URL changed, resetting video detection");
			stopMainLoop();
			clearRetry();

			retryAttempts = 0;
			yield* setHasFoundVideo(false);

			currentUrl = window.location.href;
			yield* updateExtensionStatus(ExtensionStatus.Idle);
			yield* Effect.sleep("1 second");
			yield* init();
		});

		function setupNavigationListeners() {
			if (navigationListenersAttached) {
				return;
			}

			navigationListenersAttached = true;

			const originalPushState = history.pushState.bind(history);
			const originalReplaceState = history.replaceState.bind(history);

			window.addEventListener("popstate", () => run(handleUrlChange()), {
				signal: cleanup.abortController.signal,
			});

			history.pushState = function (...args) {
				originalPushState(...args);
				run(handleUrlChange());
			};

			history.replaceState = function (...args) {
				originalReplaceState(...args);
				run(handleUrlChange());
			};

			cleanup.abortController.signal.addEventListener("abort", () => {
				history.pushState = originalPushState;
				history.replaceState = originalReplaceState;
				navigationListenersAttached = false;
			});
		}

		const handleVisibilityChange = Effect.fn("handleVisibilityChange")(function* () {
			if (document.hidden) {
				logger.debug("Page hidden, stopping loop");
				stopMainLoop();
				clearRetry();
				yield* setHasFoundVideo(false);
				retryAttempts = 0;
				return;
			}

			logger.debug("Page visible, restarting loop");
			if (!isRunning) {
				yield* startMainLoop();
			}
		});

		function setupVisibilityListener() {
			document.addEventListener("visibilitychange", () => run(handleVisibilityChange()), {
				signal: cleanup.abortController.signal,
			});
		}

		const init = Effect.fn("init")(function* () {
			const integrationUrl = yield* fromPlatform(() =>
				storage.getItem<string>(STORAGE_KEYS.INTEGRATION_URL),
			);

			if (!integrationUrl) {
				logger.info("Integration URL not set, monitoring disabled");
				return;
			}

			logger.info("Integration URL found, initializing extension");

			metadataCache = new MetadataCache();

			setupNavigationListeners();
			setupVisibilityListener();

			yield* startMainLoop();
		});

		window.addEventListener(
			"beforeunload",
			() => {
				run(cleanup.cleanupAll());
			},
			{ signal: cleanup.abortController.signal },
		);

		if (document.readyState === "loading") {
			document.addEventListener(
				"DOMContentLoaded",
				() => {
					run(init());
				},
				{ signal: cleanup.abortController.signal },
			);
		} else {
			run(init());
		}
	},
});
