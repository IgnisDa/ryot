import { useEffect, useState } from "react";

export const RELATIVE_TIME_REFRESH_MS = 10_000;

export function useNowMs(intervalMs: number) {
	const [nowMs, setNowMs] = useState(Date.now);

	useEffect(() => {
		const interval = setInterval(() => setNowMs(Date.now()), intervalMs);
		return () => clearInterval(interval);
	}, [intervalMs]);

	return nowMs;
}
