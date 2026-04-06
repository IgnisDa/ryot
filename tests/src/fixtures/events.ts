import { dayjs } from "@ryot/ts-utils";
import type { Client } from "./auth";

export async function waitForEventCount(
	client: Client,
	cookies: string,
	entityId: string,
	expectedCount: number,
	options: { timeoutMs?: number; intervalMs?: number } = {},
) {
	const timeoutMs = options.timeoutMs ?? 5000;
	const intervalMs = options.intervalMs ?? 200;
	const deadline = dayjs().add(timeoutMs, "millisecond").valueOf();

	while (dayjs().valueOf() < deadline) {
		const result = await client.GET("/events", {
			headers: { Cookie: cookies },
			params: { query: { entityId } },
		});
		const currentCount = result.data?.data.length ?? 0;
		if (currentCount >= expectedCount) {
			return result.data?.data ?? [];
		}
		await new Promise<void>((resolve) => setTimeout(resolve, intervalMs));
	}

	throw new Error(
		`Timed out after ${timeoutMs}ms waiting for ${expectedCount} events on entity ${entityId}`,
	);
}
