import type { DisplayText } from "@ryot-app/i18n/message";
import { kernelMessage } from "@ryot-app/kernel-messages/message";
import type { NavigationData, NavigationView } from "@ryot-app/ryotql-recipes/navigation";

import { savedViewHref } from "#/modules/plugins/catalog/location";

export type SidebarEntry =
	| (NavigationView & { readonly kind: "view" })
	| (NavigationCollection & { readonly kind: "collection" });

export type SidebarItem =
	| SidebarEntry
	| (Omit<NavigationCollection, "name"> & { readonly kind: "home"; readonly name: DisplayText });
export type SidebarSections = {
	readonly views: readonly SidebarItem[];
	readonly savedViews: readonly SidebarEntry[];
	readonly collections: readonly SidebarEntry[];
};

type NavigationCollection = NavigationData["collections"][number];

const homeItem = {
	kind: "home",
	sortOrder: 0,
	slug: "home",
	icon: "house",
	isHidden: false,
	reference: null,
	packageId: null,
	pluginInstallationId: null,
	name: kernelMessage("client.shell.home"),
} satisfies SidebarItem;

const viewEntry = (item: NavigationView): SidebarEntry => ({ ...item, kind: "view" });

const collectionEntry = (item: NavigationCollection): SidebarEntry => ({
	...item,
	kind: "collection",
});

const enabledItems = <Item extends SidebarItem>(items: readonly Item[]) =>
	items.filter((item) => !item.isHidden).sort((a, b) => a.sortOrder - b.sortOrder);

export function sidebarSections(props: {
	readonly data: NavigationData;
	readonly workspaceInstallationId: string | undefined;
}): SidebarSections {
	return {
		collections: enabledItems(props.data.collections.map(collectionEntry)),
		savedViews: enabledItems(
			props.data.savedViews.filter((item) => item.pluginInstallationId === null).map(viewEntry),
		),
		views: [
			homeItem,
			...enabledItems(
				props.data.savedViews
					.filter((item) => item.pluginInstallationId === props.workspaceInstallationId)
					.map(viewEntry),
			),
		],
	};
}

export const SIDEBAR_SECTION_VISIBLE_LIMIT = 7;

export type SidebarSectionName = "views" | "savedViews" | "collections";

export const sidebarOverflow = <Item extends SidebarItem>(
	items: readonly Item[],
	input: { readonly stored: boolean | undefined; readonly isActive: (item: Item) => boolean },
) => {
	if (items.length <= SIDEBAR_SECTION_VISIBLE_LIMIT) {
		return { visible: items, hiddenCount: 0, expanded: true, collapsible: false };
	}
	const activeIndex = items.findIndex(input.isActive);
	const expanded = input.stored ?? activeIndex >= SIDEBAR_SECTION_VISIBLE_LIMIT;
	if (expanded) {
		return { visible: items, hiddenCount: 0, expanded: true, collapsible: true };
	}
	const visible = items.filter(
		(_item, index) => index < SIDEBAR_SECTION_VISIBLE_LIMIT || index === activeIndex,
	);
	return {
		visible,
		expanded: false,
		collapsible: true,
		hiddenCount: items.length - visible.length,
	};
};

export const workspaceSummary = (sections: Pick<SidebarSections, "views">) =>
	kernelMessage("client.shell.sidebar.workspace-summary", { count: sections.views.length });

export const navigationViewHref = (view: Pick<NavigationView, "packageId" | "reference">) => {
	const href = savedViewHref(view.reference, view.packageId);
	if (href === undefined) {
		throw new Error("Plugin saved view is missing its package identity");
	}
	return href;
};

export const sidebarItemKey = (item: SidebarItem) => {
	if (item.kind === "home") {
		return "home";
	}
	return item.kind === "view" ? `view:${navigationViewHref(item)}` : `collection:${item.slug}`;
};
