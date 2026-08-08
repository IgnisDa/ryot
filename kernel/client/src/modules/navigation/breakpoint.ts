import { useEffect, useEffectEvent } from "react";

const DESKTOP_MEDIA_QUERY = "(min-width: 768px)";

export function useDesktopEffect(onDesktop: () => void) {
	const run = useEffectEvent(onDesktop);

	useEffect(() => {
		if (typeof window.matchMedia !== "function") {
			return undefined;
		}
		const desktop = window.matchMedia(DESKTOP_MEDIA_QUERY);
		const runWhenDesktop = () => {
			if (desktop.matches) {
				run();
			}
		};
		runWhenDesktop();
		desktop.addEventListener("change", runWhenDesktop);
		return () => desktop.removeEventListener("change", runWhenDesktop);
	}, []);
}
