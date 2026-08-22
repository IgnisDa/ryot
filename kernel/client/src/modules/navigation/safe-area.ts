import { useEffect, useState } from "react";

export type SafeAreaInsets = {
	readonly safeAreaTop: number;
	readonly safeAreaBottom: number;
};

const PROBE_STYLE =
	"position:fixed;top:0;left:0;width:0;visibility:hidden;pointer-events:none;padding-top:env(safe-area-inset-top);padding-bottom:env(safe-area-inset-bottom)";

const inset = (value: string) => {
	const measured = Number.parseFloat(value);
	return Number.isFinite(measured) ? measured : 0;
};

export const measureSafeAreaInsets = (): SafeAreaInsets => {
	if (typeof document === "undefined") {
		return { safeAreaTop: 0, safeAreaBottom: 0 };
	}
	const probe = document.createElement("div");
	probe.setAttribute("aria-hidden", "true");
	probe.setAttribute("style", PROBE_STYLE);
	document.body.append(probe);
	const style = window.getComputedStyle(probe);
	const insets = {
		safeAreaTop: inset(style.paddingTop),
		safeAreaBottom: inset(style.paddingBottom),
	};
	probe.remove();
	return insets;
};

export function useSafeAreaInsets() {
	const [insets, setInsets] = useState(measureSafeAreaInsets);

	useEffect(() => {
		const remeasure = () =>
			setInsets((current) => {
				const next = measureSafeAreaInsets();
				return next.safeAreaTop === current.safeAreaTop &&
					next.safeAreaBottom === current.safeAreaBottom
					? current
					: next;
			});
		remeasure();
		window.addEventListener("resize", remeasure);
		window.addEventListener("orientationchange", remeasure);
		return () => {
			window.removeEventListener("resize", remeasure);
			window.removeEventListener("orientationchange", remeasure);
		};
	}, []);

	return insets;
}
