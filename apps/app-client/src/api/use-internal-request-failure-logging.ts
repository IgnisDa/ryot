import { Cause, Effect } from "effect";
import { useEffect } from "react";

export const useInternalRequestFailureLogging = (label: string, cause?: unknown) => {
	useEffect(() => {
		if (cause === undefined) {
			return;
		}
		const detail = Cause.isCause(cause) ? Cause.pretty(cause) : cause;
		Effect.runSync(Effect.logWarning(label, detail));
	}, [cause, label]);
};
