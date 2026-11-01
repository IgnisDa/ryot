import { useEffect, useEffectEvent } from "react";

export const RUN_POLL_MS = 2_000;
export const RUN_LIST_POLL_MS = 10_000;

export function useRunPolling(props: {
	readonly enabled: boolean;
	readonly intervalMs: number;
	readonly refresh: () => void;
}) {
	const tick = useEffectEvent(() => {
		if (document.visibilityState === "visible") {
			props.refresh();
		}
	});

	useEffect(() => {
		if (!props.enabled) {
			return undefined;
		}
		const interval = setInterval(tick, props.intervalMs);
		return () => clearInterval(interval);
	}, [props.enabled, props.intervalMs]);
}
