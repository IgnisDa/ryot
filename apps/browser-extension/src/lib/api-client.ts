import { MESSAGE_TYPES } from "./constants";
import type { RawMediaData } from "./extension-types";

export class ApiClient {
	async sendProgressData(data: RawMediaData) {
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
