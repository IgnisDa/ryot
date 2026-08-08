export type EdgeOwner = "kernel" | "plugin";
export type EdgeIntent = "back" | "drawer" | "none";

export type EdgeResolution = {
	readonly owner: EdgeOwner;
	readonly intent: EdgeIntent;
};

export const isSettingsPath = (pathname: string) => /^\/settings(?:\/|$)/.test(pathname);

export function resolveEdge(input: {
	readonly atRoot: boolean;
	readonly pathname: string;
	readonly canGoBack: boolean;
	readonly isDesktop: boolean;
	readonly hasPluginDocument: boolean;
}): EdgeResolution {
	const hasDrawer = !isSettingsPath(input.pathname);
	const intent = resolveIntent(input, hasDrawer);
	const owner =
		intent === "back" && input.hasPluginDocument && !input.isDesktop ? "plugin" : "kernel";
	return { owner, intent };
}

function resolveIntent(
	input: { readonly atRoot: boolean; readonly canGoBack: boolean },
	hasDrawer: boolean,
): EdgeIntent {
	if (hasDrawer && input.atRoot) {
		return "drawer";
	}
	if (input.canGoBack) {
		return "back";
	}
	return hasDrawer ? "drawer" : "none";
}
