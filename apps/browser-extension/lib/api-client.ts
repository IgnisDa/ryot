import type { RawMediaData } from "./progress-tracker";

export class ApiClient {
	async sendProgressData(data: RawMediaData): Promise<void> {
		try {
			await browser.runtime.sendMessage({
				type: "SEND_PROGRESS_DATA",
				data: data,
			});
		} catch (error) {
			// Fire and forget - no error handling needed for Phase 1
			console.error("[RYOT] Failed to send message to background:", error);
		}
	}
}
