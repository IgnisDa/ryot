import { useEffect, useEffectEvent, useSyncExternalStore } from "react";

const DESKTOP_MEDIA_QUERY = "(min-width: 768px)";

const desktopQuery = () =>
	typeof window.matchMedia === "function" ? window.matchMedia(DESKTOP_MEDIA_QUERY) : undefined;

export function useIsDesktop() {
	return useSyncExternalStore(
		(notify) => {
			const desktop = desktopQuery();
			desktop?.addEventListener("change", notify);
			return () => desktop?.removeEventListener("change", notify);
		},
		() => desktopQuery()?.matches ?? false,
	);
}

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
