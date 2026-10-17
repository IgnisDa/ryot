import { useEffect, useRef } from "react";

export function useUnmountSignal() {
	const controller = useRef(new AbortController());
	useEffect(() => {
		const current = new AbortController();
		controller.current = current;
		return () => current.abort();
	}, []);
	return () => controller.current.signal;
}
