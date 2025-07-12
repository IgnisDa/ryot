import type { RawMediaData } from "./extension-types";
import type { MetadataCache } from "./metadata-cache";
import { extractTitle } from "./title-extractor";

export class ProgressTracker {
	private video: HTMLVideoElement | null = null;
	private isTracking = false;
	private lastProgressTime = 0;
	private onDataSend: (data: RawMediaData) => void;
	private metadataCache: MetadataCache;

	constructor(
		onDataSend: (data: RawMediaData) => void,
		metadataCache: MetadataCache,
	) {
		this.onDataSend = onDataSend;
		this.metadataCache = metadataCache;
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

	private async sendCurrentData() {
		if (!this.video) {
			return;
		}

		const cachedLookup = await this.metadataCache.getMetadataForCurrentPage();

		if (!cachedLookup) {
			console.error(
				"[RYOT] No cached metadata found, cannot send progress data",
			);
			return;
		}

		const title = extractTitle();

		const data: RawMediaData = {
			title,
			url: window.location.href,
			domain: window.location.hostname,
			timestamp: new Date().toISOString(),
			runtime: this.video.duration || undefined,
			currentTime: this.video.currentTime || undefined,
			progress: this.video.duration
				? this.video.currentTime / this.video.duration
				: undefined,
		};

		this.onDataSend(data);
	}
}
