import type { ExtendedHTMLVideoElement } from "../types/progress";

export class VideoDetector {
	private currentVideo: HTMLVideoElement | null = null;
	private observer: MutationObserver | null = null;
	private scanInterval: NodeJS.Timeout | null = null;
	private onVideoFound: (video: HTMLVideoElement) => void;

	constructor(onVideoFound: (video: HTMLVideoElement) => void) {
		this.onVideoFound = onVideoFound;
	}

	start() {
		this.detectVideos();
		this.setupObserver();
		this.setupPeriodicScan();
	}

	stop() {
		if (this.observer) {
			this.observer.disconnect();
			this.observer = null;
		}
		if (this.scanInterval) {
			clearInterval(this.scanInterval);
			this.scanInterval = null;
		}
		this.currentVideo = null;
	}

	getCurrentVideo(): HTMLVideoElement | null {
		return this.currentVideo;
	}

	private detectVideos() {
		const videos = document.querySelectorAll("video");

		const iframes = document.querySelectorAll("iframe");

		for (let i = 0; i < iframes.length; i++) {
			const iframe = iframes[i];

			try {
				const iframeDoc =
					iframe.contentDocument || iframe.contentWindow?.document;
				if (iframeDoc) {
					const iframeVideos = iframeDoc.querySelectorAll("video");
					if (iframeVideos.length > 0) {
						for (const video of iframeVideos) {
							videos[videos.length] = video;
						}
					}
				}
			} catch {}
		}

		const canvases = document.querySelectorAll("canvas");
		const videoContainers = document.querySelectorAll(
			[
				'[class*="video"]',
				'[class*="player"]',
				'[id*="video"]',
				'[id*="player"]',
				"[data-video]",
				"[data-player]",
			].join(", "),
		);

		const videoIframes = Array.from(iframes).filter((iframe) => {
			const src = iframe.src.toLowerCase();
			const className = iframe.className.toLowerCase();
			const id = iframe.id.toLowerCase();

			return (
				src.includes("video") ||
				src.includes("player") ||
				src.includes("embed") ||
				src.includes("vidsrc") ||
				src.includes("stream") ||
				className.includes("video") ||
				className.includes("player") ||
				id.includes("video") ||
				id.includes("player")
			);
		});

		if (
			videos.length === 0 &&
			canvases.length === 0 &&
			videoContainers.length === 0 &&
			videoIframes.length === 0
		) {
			return;
		}

		let bestVideo: HTMLVideoElement | null = null;
		const videoDetails: Array<{
			index: number;
			src: string;
			readyState: number;
			paused: boolean;
			ended: boolean;
			duration: number;
			currentTime: number;
			className: string;
			id: string;
		}> = [];

		for (let i = 0; i < videos.length; i++) {
			const video = videos[i];
			const details = {
				index: i,
				src: video.src || video.currentSrc || "no-src",
				readyState: video.readyState,
				paused: video.paused,
				ended: video.ended,
				duration: video.duration || 0,
				currentTime: video.currentTime || 0,
				className: video.className || "no-class",
				id: video.id || "no-id",
			};
			videoDetails.push(details);

			if (!video.paused && !video.ended) {
				bestVideo = video;
				break;
			}
			if (!bestVideo && video.readyState > 0) {
				bestVideo = video;
			}
		}

		if (bestVideo && bestVideo !== this.currentVideo) {
			this.currentVideo = bestVideo;
			this.onVideoFound(bestVideo);
		} else if (videoIframes.length > 0) {
			const targetIframe = videoIframes[0];
			const currentIframeSrc =
				this.currentVideo &&
				(this.currentVideo as ExtendedHTMLVideoElement).__iframe?.src;
			const isAlreadyTracking = currentIframeSrc === targetIframe.src;

			if (!isAlreadyTracking) {
				const proxyVideo = this.createProxyVideoElement(targetIframe);

				if (proxyVideo) {
					this.currentVideo = proxyVideo;
					this.onVideoFound(proxyVideo);
				}
			}
		}
	}

	private setupObserver() {
		if (!document.body) {
			const bodyObserver = new MutationObserver(() => {
				if (document.body) {
					bodyObserver.disconnect();
					this.setupObserver();
				}
			});
			bodyObserver.observe(document.documentElement, {
				childList: true,
				subtree: true,
			});
			return;
		}

		this.observer = new MutationObserver((mutations) => {
			let hasVideoChanges = false;
			for (const mutation of mutations) {
				if (mutation.type === "childList") {
					for (const node of mutation.addedNodes) {
						if (node.nodeType === Node.ELEMENT_NODE) {
							const element = node as Element;
							if (
								element.tagName === "VIDEO" ||
								element.tagName === "IFRAME" ||
								element.tagName === "CANVAS" ||
								element.querySelector("video") ||
								element.querySelector("iframe") ||
								element.querySelector("canvas") ||
								element.matches(
									'[class*="video"], [class*="player"], [id*="video"], [id*="player"]',
								)
							) {
								hasVideoChanges = true;
								break;
							}
						}
					}
				}
			}

			if (hasVideoChanges) this.detectVideos();
		});

		this.observer.observe(document.body, {
			childList: true,
			subtree: true,
		});
	}

	private createProxyVideoElement(
		iframe: HTMLIFrameElement,
	): HTMLVideoElement | null {
		const proxyVideo = document.createElement("video") as HTMLVideoElement;

		Object.defineProperty(proxyVideo, "src", {
			get: () => iframe.src,
			configurable: true,
		});

		Object.defineProperty(proxyVideo, "currentSrc", {
			get: () => iframe.src,
			configurable: true,
		});

		Object.defineProperty(proxyVideo, "duration", {
			get: () => 7200,
			configurable: true,
		});

		Object.defineProperty(proxyVideo, "currentTime", {
			get: () => 0,
			configurable: true,
		});

		Object.defineProperty(proxyVideo, "paused", {
			get: () => false,
			configurable: true,
		});

		Object.defineProperty(proxyVideo, "ended", {
			get: () => false,
			configurable: true,
		});

		Object.defineProperty(proxyVideo, "readyState", {
			get: () => 4,
			configurable: true,
		});

		(proxyVideo as ExtendedHTMLVideoElement).__iframe = iframe;
		(proxyVideo as ExtendedHTMLVideoElement).__isProxy = true;

		return proxyVideo;
	}

	private setupPeriodicScan() {
		this.scanInterval = setInterval(() => {
			this.detectVideos();
		}, 5000);
	}
}
