import type { SavedViewReference } from "@ryot-app/contract/modules/plugins/references";
import type { NavigationData, NavigationView } from "@ryot-app/ryotql-recipes/navigation";

import { savedViewHref } from "#/modules/plugins/plugin-location";

export type SidebarItem = Omit<NavigationView, "reference"> & {
	readonly reference: SavedViewReference | null;
	readonly kind: "home" | "view" | "collection";
};

export type SidebarSections = {
	readonly views: readonly SidebarItem[];
	readonly savedViews: readonly SidebarItem[];
	readonly collections: readonly SidebarItem[];
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

const enabledItems = (items: readonly SidebarItem[]) =>
	items.filter((item) => !item.isHidden).sort((a, b) => a.sortOrder - b.sortOrder);

const withKind = (item: Omit<SidebarItem, "kind">, kind: SidebarItem["kind"]): SidebarItem => ({
	...item,
	kind,
});

export function sidebarSections(props: {
	readonly data: NavigationData;
	readonly workspaceInstallationId: string | undefined;
}): SidebarSections {
	return {
		savedViews: enabledItems(
			props.data.savedViews
				.filter((item) => item.pluginInstallationId === null)
				.map((item) => withKind(item, "view")),
		),
		collections: enabledItems(
			props.data.collections.map((item) =>
				withKind({ ...item, reference: null, pluginInstallationId: null }, "collection"),
			),
		),
		views: [
			homeItem,
			...enabledItems(
				props.data.savedViews
					.filter((item) => item.pluginInstallationId === props.workspaceInstallationId)
					.map((item) => withKind(item, "view")),
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

export const navigationViewHref = (
	reference: SavedViewReference,
	packageId: NavigationView["packageId"],
) => {
	const href = savedViewHref(reference, packageId);
	if (href === undefined) {
		throw new Error("Plugin saved view is missing its package identity");
	}
	return href;
};

export const sidebarItemHref = (item: Pick<SidebarItem, "packageId" | "reference">) =>
	item.reference === null ? undefined : navigationViewHref(item.reference, item.packageId);

export const sidebarItemKey = (item: SidebarItem) => {
	if (item.kind === "home") {
		return "home";
	}
	const href = sidebarItemHref(item);
	if (href !== undefined) {
		return `view:${href}`;
	}
	return `collection:${item.slug}`;
};

export function activeSidebarKey(pathname: string) {
	const view = pathname.match(/^\/v\/(?:[ck]\/[^/]+|p\/[^/]+\/[^/]+\/[^/]+)(?:\/|$)/)?.[0];
	if (view !== undefined) {
		return `view:${view.replace(/\/$/, "")}`;
	}
	const collection = pathname.match(/^\/e\/([^/]+)(?:\/|$)/)?.[1];
	return collection === undefined ? null : `collection:${collection}`;
}
