/* oxlint-disable perfectionist/sort-jsx-props -- Keep tracer adapter values grouped by source. */
import { StyleXTracerPanel } from "@ryot-app/client-ui-sdk/stylex-tracer";
import { useRouteContext } from "@tanstack/react-router";
import { useEffect, useState, useSyncExternalStore } from "react";

import { AppScreen } from "#/modules/navigation/app-screen";
import { useEdge, useShellChrome } from "#/modules/navigation/authenticated-shell-context";

export function StyleXTracerScreen() {
	const { theme } = useRouteContext({ from: "/_authenticated/stylex-tracer-kernel" });
	const edge = useEdge();
	const chrome = useShellChrome();
	const resolvedTheme = useSyncExternalStore(theme.subscribe, theme.getSnapshot, theme.getSnapshot);
	const [portalRoot, setPortalRoot] = useState<HTMLDivElement | null>(null);

	useEffect(() => {
		const root = document.createElement("div");
		root.dataset.testid = "stylex-tracer-portal-root";
		document.body.append(root);
		setPortalRoot(root);
		return () => root.remove();
	}, []);

	return (
		<AppScreen width="readable" title="StyleX tracer">
			<StyleXTracerPanel
				compact={edge.compact}
				portalRoot={portalRoot}
				safeAreaTop={chrome.safeAreaTop}
				safeAreaBottom={chrome.safeAreaBottom}
				resolvedTheme={resolvedTheme.resolvedMode}
			/>
		</AppScreen>
	);
}
