import type { RawMediaData } from "../types/progress";

export class ApiClient {
	async sendProgressData(data: RawMediaData): Promise<void> {
		try {
			console.log("[RYOT] Sending message to background script:", data);
			const response = await browser.runtime.sendMessage({
				type: "SEND_PROGRESS_DATA",
				data: data,
			});
			console.log("[RYOT] Background response:", response);
		} catch (error) {
			console.error("[RYOT] Failed to send message to background:", error);
		}
	}
}
