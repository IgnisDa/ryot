import { useEffect, useState } from "react";

const PROBE_STYLE =
	"position:fixed;top:0;left:0;width:0;visibility:hidden;pointer-events:none;padding-top:env(safe-area-inset-top)";

export const measureSafeAreaTop = () => {
	if (typeof document === "undefined") {
		return 0;
	}
	const probe = document.createElement("div");
	probe.setAttribute("aria-hidden", "true");
	probe.setAttribute("style", PROBE_STYLE);
	document.body.append(probe);
	const measured = Number.parseFloat(window.getComputedStyle(probe).paddingTop);
	probe.remove();
	return Number.isFinite(measured) ? measured : 0;
};

export function useSafeAreaTop() {
	const [safeAreaTop, setSafeAreaTop] = useState(measureSafeAreaTop);

	useEffect(() => {
		const remeasure = () => setSafeAreaTop(measureSafeAreaTop());
		remeasure();
		window.addEventListener("resize", remeasure);
		window.addEventListener("orientationchange", remeasure);
		return () => {
			window.removeEventListener("resize", remeasure);
			window.removeEventListener("orientationchange", remeasure);
		};
	}, []);

	return safeAreaTop;
}
