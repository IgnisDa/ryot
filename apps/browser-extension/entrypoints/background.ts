import type { RawMediaData } from "../types/progress";

export default defineBackground(() => {
	console.log("[RYOT] Background script initialized");

	const WEBHOOK_URL =
		"https://webhook.site/26a6767d-0e5c-4291-babe-32a98445eaca";

	browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
		if (message.type === "SEND_PROGRESS_DATA") {
			handleProgressData(message.data)
				.then((result) => {
					sendResponse({ success: true, result });
				})
				.catch((error) => {
					console.error("[RYOT] Webhook request failed:", error);
					sendResponse({ success: false, error: error.message });
				});

			return true;
		}
	});

	async function handleProgressData(
		data: RawMediaData,
	): Promise<{ status: number; statusText: string; ok: boolean }> {
		try {
			const response = await fetch(WEBHOOK_URL, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
				},
				body: JSON.stringify(data),
			});

			const result = {
				status: response.status,
				statusText: response.statusText,
				ok: response.ok,
			};

			return result;
		} catch (error) {
			console.error("[RYOT] Webhook request failed:", error);
			throw error;
		}
	}
});
