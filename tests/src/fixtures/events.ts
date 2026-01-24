import type { Client } from "./auth";
import { type PollOptions, pollUntil } from "./polling";

export async function waitForEventCount(
	client: Client,
	cookies: string,
	entityId: string,
	expectedCount: number,
	options: PollOptions = {},
) {
	return pollUntil(
		`${expectedCount} events on entity ${entityId}`,
		async () => {
			const result = await client.GET("/events", {
				headers: { Cookie: cookies },
				params: { query: { entityId } },
			});
			const events = result.data?.data ?? [];
			return events.length >= expectedCount ? events : null;
		},
		{ timeoutMs: 5000, intervalMs: 200, ...options },
	);
}
