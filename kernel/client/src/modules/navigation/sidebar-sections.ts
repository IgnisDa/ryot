import type { NavigationData, NavigationView } from "@ryot-app/ryotql-recipes/navigation";

export type SidebarItem = NavigationView & { readonly kind: "home" | "view" | "collection" };

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
	pluginSlug: null,
	isDisabled: false,
} satisfies SidebarItem;

const enabledItems = (items: readonly SidebarItem[]) =>
	items.filter((item) => !item.isDisabled).sort((a, b) => a.sortOrder - b.sortOrder);

const withKind = (item: NavigationView, kind: SidebarItem["kind"]): SidebarItem => ({
	...item,
	kind,
});

export function sidebarSections(props: {
	readonly data: NavigationData;
	readonly workspaceSlug: string | undefined;
}): SidebarSections {
	return {
		views: [
			homeItem,
			...enabledItems(
				props.data.savedViews
					.filter((item) => item.pluginSlug === props.workspaceSlug)
					.map((item) => withKind(item, "view")),
			),
		],
		savedViews: enabledItems(
			props.data.savedViews
				.filter((item) => item.pluginSlug === null)
				.map((item) => withKind(item, "view")),
		),
		collections: enabledItems(props.data.collections.map((item) => withKind(item, "collection"))),
	};
}

export const workspaceSummary = (sections: Pick<SidebarSections, "views">) =>
	`${sections.views.length} view${sections.views.length === 1 ? "" : "s"}`;

export const sidebarItemKey = (item: SidebarItem) =>
	item.kind === "home" ? "home" : `${item.kind}:${item.slug}`;

export function activeSidebarKey(pathname: string) {
	const view = pathname.match(/^\/v\/([^/]+)(?:\/|$)/)?.[1];
	if (view !== undefined) {
		return `view:${view}`;
	}
	const collection = pathname.match(/^\/e\/([^/]+)(?:\/|$)/)?.[1];
	return collection === undefined ? null : `collection:${collection}`;
}
