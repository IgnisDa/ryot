import { storage } from "#imports";
import { STORAGE_KEYS } from "./constants";

type LogLevel = "debug" | "info" | "warn" | "error";

class Logger {
	private debugMode: boolean | null = null;

	private async getDebugMode(): Promise<boolean> {
		if (this.debugMode === null) {
			this.debugMode =
				(await storage.getItem<boolean>(STORAGE_KEYS.DEBUG_MODE)) ?? false;
		}
		return this.debugMode;
	}

	private async shouldLog(level: LogLevel): Promise<boolean> {
		if (level === "error" || level === "warn" || level === "info") {
			return true;
		}
		return await this.getDebugMode();
	}

	private formatMessage(level: LogLevel, message: string): string {
		return `[RYOT] [${level.toUpperCase()}] ${message}`;
	}

	private async log(
		level: LogLevel,
		message: string,
		data?: object,
	): Promise<void> {
		if (!(await this.shouldLog(level))) {
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

	async debug(message: string, data?: object): Promise<void> {
		await this.log("debug", message, data);
	}

	async info(message: string, data?: object): Promise<void> {
		await this.log("info", message, data);
	}

	async warn(message: string, data?: object): Promise<void> {
		await this.log("warn", message, data);
	}

	async error(message: string, data?: object): Promise<void> {
		await this.log("error", message, data);
	}

	async updateDebugMode(): Promise<void> {
		this.debugMode = null;
	}
}

export const logger = new Logger();
