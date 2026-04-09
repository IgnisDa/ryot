import { dayjs } from "@ryot/ts-utils";

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
	const deadline = dayjs().add(timeoutMs, "millisecond");

	for (;;) {
		const result = await check();
		if (result !== null) {
			return result;
		}

		const remainingMs = deadline.diff(dayjs());
		if (remainingMs <= 0) {
			break;
		}

		await delay(Math.min(intervalMs, remainingMs));
	}

	throw new Error(`'${label}' did not complete within ${timeoutMs}ms`);
}
