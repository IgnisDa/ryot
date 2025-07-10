export class VideoDetector {
	private currentVideo: HTMLVideoElement | null = null;
	private observer: MutationObserver | null = null;
	private onVideoFound: (video: HTMLVideoElement) => void;

	constructor(onVideoFound: (video: HTMLVideoElement) => void) {
		this.onVideoFound = onVideoFound;
	}

	start() {
		this.detectVideos();
		this.setupObserver();
	}

	stop() {
		if (this.observer) {
			this.observer.disconnect();
			this.observer = null;
		}
	}

	getCurrentVideo(): HTMLVideoElement | null {
		return this.currentVideo;
	}

	private detectVideos() {
		const videos = document.querySelectorAll("video");

		let bestVideo: HTMLVideoElement | null = null;

		for (const video of videos) {
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
		this.observer = new MutationObserver(() => {
			this.detectVideos();
		});

		this.observer.observe(document.body, {
			childList: true,
			subtree: true,
		});
	}
}
