import type { PluginLeadingIntent } from "@ryot-app/client-plugin-contract";

export type EdgeOwner = "kernel" | "plugin";
export type EdgeIntent = PluginLeadingIntent;

export type EdgeResolution = {
	readonly owner: EdgeOwner;
	readonly compact: boolean;
	readonly intent: EdgeIntent;
};

export const isSettingsPath = (pathname: string) => /^\/settings(?:\/|$)/.test(pathname);

export const isCustomizeSidebarPath = (pathname: string) =>
	/^\/customize-sidebar(?:\/|$)/.test(pathname);

// A route that carries its own back affordance keeps the drawer, the mobile header, and the edge
// gesture out of its way; the route's own control is the only way out.
export const hasWorkspaceChrome = (pathname: string) =>
	!isSettingsPath(pathname) && !isCustomizeSidebarPath(pathname);

export function resolveEdge(input: {
	readonly atRoot: boolean;
	readonly pathname: string;
	readonly canGoBack: boolean;
	readonly isDesktop: boolean;
	readonly hasPluginBackScreen: boolean;
}): EdgeResolution {
	const compact = !input.isDesktop;
	const hasDrawer = hasWorkspaceChrome(input.pathname);
	const intent = resolveIntent(input, hasDrawer);
	const owner = intent === "back" && input.hasPluginBackScreen && compact ? "plugin" : "kernel";
	return { owner, compact, intent };
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
