import { DateTime, Duration } from "effect";

export interface PollOptions {
	timeoutMs?: number;
	intervalMs?: number;
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function pollUntil<T>(
	label: string,
	check: () => Promise<T | null>,
	options: PollOptions = {},
): Promise<T> {
	const { intervalMs = 500, timeoutMs = 30_000 } = options;
	const deadlineMs = DateTime.unsafeNow().pipe(
		(now) => DateTime.addDuration(now, Duration.millis(timeoutMs)),
		DateTime.toEpochMillis,
	);

	const poll = async (): Promise<T> => {
		const result = await check();
		if (result !== null) {
			return result;
		}

		const remainingMs = deadlineMs - DateTime.toEpochMillis(DateTime.unsafeNow());
		if (remainingMs <= 0) {
			throw new Error(`'${label}' did not complete within ${timeoutMs}ms`);
		}

		await delay(Math.min(intervalMs, remainingMs));
		return poll();
	};

	return poll();
}
