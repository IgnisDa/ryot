import type { NavigationData, NavigationView } from "@ryot-app/ryotql-recipes/navigation";
import type { PluginClientCatalog } from "@ryot-app/ryotql-recipes/plugin-client-catalog";

import { sortWorkspaces } from "#/modules/navigation/workspace-state";

export type CustomizeSection = "workspaces" | "views" | "savedViews";

export type CustomizeDraftItem = {
	readonly slug: string;
	readonly name: string;
	readonly icon: string;
	readonly isDisabled: boolean;
};

export type CustomizeDraftViewItem = CustomizeDraftItem & { readonly pluginSlug: string | null };

export type CustomizeDraft = {
	readonly views: readonly CustomizeDraftViewItem[];
	readonly workspaces: readonly CustomizeDraftItem[];
	readonly savedViews: readonly CustomizeDraftViewItem[];
};

const clampIndex = (index: number, length: number) =>
	Math.min(Math.max(index, 0), Math.max(length - 1, 0));

const draftItems = (items: readonly NavigationView[], scopeSlug: string | null | undefined) =>
	[...items]
		.filter((item) => item.pluginSlug === scopeSlug)
		.sort((left, right) => left.sortOrder - right.sortOrder)
		.map(({ icon, name, slug, isDisabled, pluginSlug }) => ({
			icon,
			slug,
			name,
			isDisabled,
			pluginSlug,
		}));

const draftWorkspaces = (catalog: PluginClientCatalog) =>
	sortWorkspaces(catalog).map(({ icon, name, slug, isDisabled }) => ({
		icon,
		slug,
		name,
		isDisabled,
	}));

const withVisibilityFlipped = (item: CustomizeDraftItem) => ({
	...item,
	isDisabled: !item.isDisabled,
});

const areSectionsEqual = (
	left: readonly CustomizeDraftItem[],
	right: readonly CustomizeDraftItem[],
) =>
	left.length === right.length &&
	left.every(
		(item, index) =>
			item.slug === right[index]?.slug && item.isDisabled === right[index]?.isDisabled,
	);

export function initCustomizeDraft(props: {
	readonly data: NavigationData;
	readonly catalog: PluginClientCatalog;
	readonly workspaceSlug: string | undefined;
}): CustomizeDraft {
	return {
		workspaces: draftWorkspaces(props.catalog),
		savedViews: draftItems(props.data.savedViews, null),
		views: draftItems(props.data.savedViews, props.workspaceSlug),
	};
}

export function moveCustomizeItem(props: {
	readonly toIndex: number;
	readonly fromIndex: number;
	readonly draft: CustomizeDraft;
	readonly section: CustomizeSection;
}): CustomizeDraft {
	const items = props.draft[props.section];
	if (items.length === 0) {
		return props.draft;
	}

	const fromIndex = clampIndex(props.fromIndex, items.length);
	const toIndex = clampIndex(props.toIndex, items.length);
	const item = items[fromIndex];
	if (fromIndex === toIndex) {
		return props.draft;
	}

	const next = [...items];
	next.splice(fromIndex, 1);
	next.splice(toIndex, 0, item);

	return { ...props.draft, [props.section]: next };
}

export function toggleCustomizeItem(props: {
	readonly slug: string;
	readonly draft: CustomizeDraft;
	readonly section: CustomizeSection;
}): CustomizeDraft {
	const items = props.draft[props.section];
	const item = items.find(({ slug }) => slug === props.slug);
	if (item === undefined) {
		return props.draft;
	}
	if (
		props.section === "workspaces" &&
		!item.isDisabled &&
		items.filter(({ isDisabled }) => !isDisabled).length === 1
	) {
		return props.draft;
	}

	return {
		...props.draft,
		[props.section]: items.map((sectionItem) =>
			sectionItem.slug === props.slug ? withVisibilityFlipped(sectionItem) : sectionItem,
		),
	};
}

export const isCustomizeDraftDirty = (props: {
	readonly draft: CustomizeDraft;
	readonly initial: CustomizeDraft;
}) =>
	!areSectionsEqual(props.draft.workspaces, props.initial.workspaces) ||
	!areSectionsEqual(props.draft.views, props.initial.views) ||
	!areSectionsEqual(props.draft.savedViews, props.initial.savedViews);

export function customizeSectionCounts(props: {
	readonly draft: CustomizeDraft;
	readonly section: CustomizeSection;
}) {
	const items = props.draft[props.section];
	const shown = items.filter((item) => !item.isDisabled).length;
	const pinned = props.section === "views" ? 1 : 0;

	return { shown: shown + pinned, total: items.length + pinned };
}

export function customizeSearchSection(search: {
	readonly section?: unknown;
}): CustomizeSection | undefined {
	if (
		search.section === "workspaces" ||
		search.section === "views" ||
		search.section === "savedViews"
	) {
		return search.section;
	}
	return undefined;
}
