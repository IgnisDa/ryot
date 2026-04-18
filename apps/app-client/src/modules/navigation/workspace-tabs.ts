import type { NavigationItem, NavigationItems } from "./navigation-data";

export const DIRECT_WORKSPACE_TAB_COUNT = 4;

export type WorkspaceTab = {
	key: string;
	icon: string;
	label: string;
	item?: NavigationItem;
};

function getNavigationItemKey(item: Pick<NavigationItem, "kind" | "slug">) {
	return item.kind === "home" ? "home" : `${item.kind}:${item.slug}`;
}

export function getWorkspaceTabs(items: Pick<NavigationItems, "views">): WorkspaceTab[] {
	return [
		...items.views.slice(0, DIRECT_WORKSPACE_TAB_COUNT).map((item) => ({
			item,
			icon: item.icon,
			label: item.name,
			key: getNavigationItemKey(item),
		})),
		{ key: "more", label: "More", icon: "more-horizontal" },
	];
}

export function getSelectedWorkspaceTabKey(activeKey: string, tabs: readonly WorkspaceTab[]) {
	return tabs.some((tab) => tab.item && tab.key === activeKey)
		? activeKey
		: (tabs[0]?.key ?? "home");
}
