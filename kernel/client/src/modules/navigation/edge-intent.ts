export type EdgeIntent = "back" | "drawer" | "none";

export const isSettingsPath = (pathname: string) => /^\/settings(?:\/|$)/.test(pathname);

export function resolveEdgeIntent(input: {
	readonly atRoot: boolean;
	readonly pathname: string;
	readonly canGoBack: boolean;
}): EdgeIntent {
	const hasDrawer = !isSettingsPath(input.pathname);
	if (hasDrawer && input.atRoot) {
		return "drawer";
	}
	if (input.canGoBack) {
		return "back";
	}
	return hasDrawer ? "drawer" : "none";
}
