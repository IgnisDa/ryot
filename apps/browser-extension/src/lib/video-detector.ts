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

		if (
			videos.length === 0 &&
			canvases.length === 0 &&
			videoContainers.length === 0
		) {
			return;
		}

		let bestVideo: HTMLVideoElement | null = null;

		for (let i = 0; i < videos.length; i++) {
			const video = videos[i];

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

	private setupPeriodicScan() {
		this.scanInterval = setInterval(() => {
			this.detectVideos();
		}, 5000);
	}
}
