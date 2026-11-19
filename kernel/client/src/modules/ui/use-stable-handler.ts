import { useCallback, useLayoutEffect, useRef } from "react";

export function useStableHandler<Args extends unknown[], Result>(
	handler: (...args: Args) => Result,
) {
	const latest = useRef(handler);
	useLayoutEffect(() => {
		latest.current = handler;
	});
	return useCallback((...args: Args) => latest.current(...args), []);
}
