import { useEffect, useEffectEvent } from "react";
import { AppState } from "react-native";

export const IMPORT_LIST_POLL_MS = 10_000;
export const IMPORT_RUN_POLL_MS = 2_000;

export function useImportRunPolling(props: {
	readonly enabled: boolean;
	readonly intervalMs: number;
	readonly refresh: () => void;
}) {
	const tick = useEffectEvent(() => {
		if (AppState.currentState === "active") {
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
