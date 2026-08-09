import type { NavigationData, NavigationView } from "@ryot-app/ryotql-recipes/navigation";

export type CustomizeSection = "views" | "savedViews";

export type CustomizeDraftItem = {
	readonly slug: string;
	readonly name: string;
	readonly icon: string;
	readonly isDisabled: boolean;
	readonly pluginSlug: string | null;
};

export type CustomizeDraft = {
	readonly views: readonly CustomizeDraftItem[];
	readonly savedViews: readonly CustomizeDraftItem[];
};

const clampIndex = (index: number, length: number) =>
	Math.min(Math.max(index, 0), Math.max(length - 1, 0));

const draftItems = (items: readonly NavigationView[], scopeSlug: string | null | undefined) =>
	[...items]
		.filter((item) => item.pluginSlug === scopeSlug)
		.sort((left, right) => left.sortOrder - right.sortOrder)
		.map(({ icon, isDisabled, name, pluginSlug, slug }) => ({
			icon,
			slug,
			name,
			isDisabled,
			pluginSlug,
		}));

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
	readonly workspaceSlug: string | undefined;
}): CustomizeDraft {
	return {
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
	if (fromIndex === toIndex || item === undefined) {
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
	if (!items.some((item) => item.slug === props.slug)) {
		return props.draft;
	}

	return {
		...props.draft,
		[props.section]: items.map((item) =>
			item.slug === props.slug ? Object.assign(item, { isDisabled: !item.isDisabled }) : item,
		),
	};
}

export const isCustomizeDraftDirty = (props: {
	readonly draft: CustomizeDraft;
	readonly initial: CustomizeDraft;
}) =>
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
	if (search.section === "views" || search.section === "savedViews") {
		return search.section;
	}
	return undefined;
}
