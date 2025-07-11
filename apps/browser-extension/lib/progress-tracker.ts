import type { RawMediaData } from "../types/progress";
import { extractMetadata } from "./title-extractor";

export class ProgressTracker {
	private video: HTMLVideoElement | null = null;
	private isTracking = false;
	private lastProgressTime = 0;
	private onDataSend: (data: RawMediaData) => void;

	constructor(onDataSend: (data: RawMediaData) => void) {
		this.onDataSend = onDataSend;
	}

	startTracking(video: HTMLVideoElement) {
		if (this.video === video) {
			return;
		}

		this.stopTracking();

		this.video = video;
		this.isTracking = true;

		video.addEventListener("timeupdate", this.onVideoProgress);
		video.addEventListener("play", this.onVideoProgress);
		video.addEventListener("pause", this.onVideoProgress);

		this.sendCurrentData();
	}

	stopTracking() {
		if (this.video) {
			this.video.removeEventListener("timeupdate", this.onVideoProgress);
			this.video.removeEventListener("play", this.onVideoProgress);
			this.video.removeEventListener("pause", this.onVideoProgress);
		}

		this.video = null;
		this.isTracking = false;
	}

	pauseTracking() {
		this.isTracking = false;
	}

	resumeTracking() {
		this.isTracking = true;
	}

	private onVideoProgress = () => {
		if (!this.video || !this.isTracking) {
			return;
		}

		const now = Date.now();
		if (now - this.lastProgressTime < 2000) {
			return;
		}

		this.lastProgressTime = now;
		this.sendCurrentData();
	};

	private sendCurrentData() {
		if (!this.video) {
			return;
		}

		const metadata = extractMetadata();

		const data: RawMediaData = {
			...metadata,
			domain: window.location.hostname,
			url: window.location.href,
			runtime: this.video.duration || undefined,
			currentTime: this.video.currentTime || undefined,
			progress: this.video.duration
				? this.video.currentTime / this.video.duration
				: undefined,
			timestamp: new Date().toISOString(),
		};

		this.onDataSend(data);
	}
}
