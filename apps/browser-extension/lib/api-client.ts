import type { RawMediaData } from "../types/progress";
import { MESSAGE_TYPES } from "./constants";

export class ApiClient {
	async sendProgressData(data: RawMediaData): Promise<void> {
		try {
			await browser.runtime.sendMessage({
				type: MESSAGE_TYPES.SEND_PROGRESS_DATA,
				data: data,
			});
		} catch (error) {
			console.error("[RYOT] Failed to send message to background:", error);
		}
	}
}
