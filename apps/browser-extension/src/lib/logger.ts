import { Effect } from "effect";

import { storage } from "#imports";

import { STORAGE_KEYS } from "./constants";
import { fromPlatform, run } from "./platform";

type LogLevel = "info" | "warn" | "debug" | "error";

class Logger {
	private debugMode = false;
	private unwatchStorage?: () => void;

	constructor() {
		this.setupStorageListener();
		this.loadDebugMode();
	}

	invalidateCache(): void {
		this.loadDebugMode();
	}

	info(message: string, data?: object): void {
		this.log("info", message, data);
	}

	warn(message: string, data?: object): void {
		this.log("warn", message, data);
	}

	debug(message: string, data?: object): void {
		this.log("debug", message, data);
	}

	error(message: string, data?: object): void {
		this.log("error", message, data);
	}

	public cleanup(): void {
		if (this.unwatchStorage) {
			this.unwatchStorage();
			this.unwatchStorage = undefined;
		}
	}

	private formatMessage(level: LogLevel, message: string): string {
		return `[RYOT] [${level.toUpperCase()}] ${message}`;
	}

	private setupStorageListener() {
		this.unwatchStorage = storage.watch(STORAGE_KEYS.DEBUG_MODE, () => {
			this.loadDebugMode();
		});
	}

	private shouldLog(level: LogLevel): boolean {
		if (level === "error" || level === "warn" || level === "info") {
			return true;
		}
		return this.debugMode;
	}

	private loadDebugMode() {
		run(
			fromPlatform(() => storage.getItem<boolean>(STORAGE_KEYS.DEBUG_MODE)).pipe(
				Effect.match({
					onFailure: () => {
						this.debugMode = false;
					},
					onSuccess: (enabled) => {
						this.debugMode = enabled ?? false;
					},
				}),
			),
		);
	}

	private log(level: LogLevel, message: string, data?: object): void {
		if (!this.shouldLog(level)) {
			return;
		}

		const formattedMessage = this.formatMessage(level, message);

		switch (level) {
			case "info":
			case "debug":
				if (data) {
					console.log(formattedMessage, data);
				} else {
					console.log(formattedMessage);
				}
				break;
			case "warn":
				if (data) {
					console.warn(formattedMessage, data);
				} else {
					console.warn(formattedMessage);
				}
				break;
			case "error":
				if (data) {
					console.error(formattedMessage, data);
				} else {
					console.error(formattedMessage);
				}
				break;
		}
	}
}

export const logger = new Logger();
