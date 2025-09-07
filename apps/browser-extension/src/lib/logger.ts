import { storage } from "#imports";
import { STORAGE_KEYS } from "./constants";

type LogLevel = "debug" | "info" | "warn" | "error";

class Logger {
	private debugMode = false;
	private unwatchStorage?: () => void;

	constructor() {
		this.setupStorageListener();
		this.loadDebugMode();
	}

	private setupStorageListener() {
		this.unwatchStorage = storage.watch(STORAGE_KEYS.DEBUG_MODE, () => {
			this.loadDebugMode();
		});
	}

	public cleanup(): void {
		if (this.unwatchStorage) {
			this.unwatchStorage();
			this.unwatchStorage = undefined;
		}
	}

	private loadDebugMode() {
		storage
			.getItem<boolean>(STORAGE_KEYS.DEBUG_MODE)
			.then((enabled) => {
				this.debugMode = enabled ?? false;
			})
			.catch(() => {
				this.debugMode = false;
			});
	}

	private shouldLog(level: LogLevel): boolean {
		if (level === "error" || level === "warn" || level === "info") {
			return true;
		}
		return this.debugMode;
	}

	private formatMessage(level: LogLevel, message: string): string {
		return `[RYOT] [${level.toUpperCase()}] ${message}`;
	}

	private log(level: LogLevel, message: string, data?: object): void {
		if (!this.shouldLog(level)) {
			return;
		}

		const formattedMessage = this.formatMessage(level, message);

		switch (level) {
			case "debug":
			case "info":
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

	debug(message: string, data?: object): void {
		this.log("debug", message, data);
	}

	info(message: string, data?: object): void {
		this.log("info", message, data);
	}

	warn(message: string, data?: object): void {
		this.log("warn", message, data);
	}

	error(message: string, data?: object): void {
		this.log("error", message, data);
	}

	invalidateCache(): void {
		this.loadDebugMode();
	}
}

export const logger = new Logger();
