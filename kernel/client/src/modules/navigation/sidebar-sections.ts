import type { NavigationData, NavigationView } from "@ryot-app/ryotql-recipes/navigation";

import { savedViewHref } from "#/modules/plugins/plugin-location";

type NavigationCollection = NavigationData["collections"][number];

export type SidebarEntry =
	| (NavigationView & { readonly kind: "view" })
	| (NavigationCollection & { readonly kind: "collection" });
export type SidebarItem = SidebarEntry | (NavigationCollection & { readonly kind: "home" });

export type SidebarSections = {
	readonly views: readonly SidebarItem[];
	readonly savedViews: readonly SidebarEntry[];
	readonly collections: readonly SidebarEntry[];
};

const homeItem = {
	name: "Home",
	sortOrder: 0,
	kind: "home",
	slug: "home",
	icon: "house",
	isHidden: false,
	reference: null,
	packageId: null,
	pluginInstallationId: null,
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

export const workspaceSummary = (sections: Pick<SidebarSections, "views">) =>
	`${sections.views.length} view${sections.views.length === 1 ? "" : "s"}`;

export function workspacePickerSummary(data: NavigationData, installationId: string) {
	const views = data.savedViews
		.filter((item) => item.pluginInstallationId === installationId && !item.isHidden)
		.sort((a, b) => a.sortOrder - b.sortOrder);
	if (views.length === 0) {
		return "Custom workspace · 0 views";
	}

	const names = views.slice(0, 3).map((item) => item.name);
	const remaining = views.length - names.length;
	return `${names.join(", ")}${remaining > 0 ? ` +${remaining}` : ""}`;
}

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
