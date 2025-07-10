import type { RawMediaData } from "./progress-tracker";

export class ApiClient {
	private webhookUrl: string;

	constructor(webhookUrl: string) {
		this.webhookUrl = webhookUrl;
	}

	async sendProgressData(data: RawMediaData): Promise<void> {
		try {
			await fetch(this.webhookUrl, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
				},
				body: JSON.stringify(data),
			});
		} catch (_error) {
			// Fire and forget - no error handling needed for Phase 1
		}
	}
}
