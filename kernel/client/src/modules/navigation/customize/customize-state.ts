import type { NavigationData } from "@ryot/ryotql-recipes/navigation";

export type CustomizeSection = "views" | "savedViews";

export type CustomizeDraftItem = {
	slug: string;
	name: string;
	icon: string;
	isDisabled: boolean;
	pluginSlug: string | null;
};

export type CustomizeDraft = {
	views: readonly CustomizeDraftItem[];
	savedViews: readonly CustomizeDraftItem[];
};

type NavigationView = NavigationData["savedViews"][number];

function getCustomizeItems(items: readonly NavigationView[], scopeSlug: string | null) {
	return items
		.filter((item) => item.pluginSlug === scopeSlug)
		.sort((left, right) => left.sortOrder - right.sortOrder)
		.map(({ icon, isDisabled, name, pluginSlug, slug }) => ({
			icon,
			slug,
			name,
			isDisabled,
			pluginSlug,
		}));
}

function clampIndex(index: number, length: number) {
	return Math.min(Math.max(index, 0), length - 1);
}

function areSectionsEqual(
	left: readonly CustomizeDraftItem[],
	right: readonly CustomizeDraftItem[],
) {
	return (
		left.length === right.length &&
		left.every(
			(item, index) =>
				item.slug === right[index]?.slug && item.isDisabled === right[index]?.isDisabled,
		)
	);
}

export function initCustomizeDraft(props: { data: NavigationData; workspaceSlug: string }) {
	const views = getCustomizeItems(props.data.savedViews, props.workspaceSlug);
	const savedViews = getCustomizeItems(props.data.savedViews, null);

	return { views, savedViews };
}

export function moveCustomizeItem(props: {
	toIndex: number;
	fromIndex: number;
	draft: CustomizeDraft;
	section: CustomizeSection;
}) {
	const items = props.draft[props.section];
	if (items.length === 0) {
		return props.draft;
	}

	const fromIndex = clampIndex(props.fromIndex, items.length);
	const toIndex = clampIndex(props.toIndex, items.length);
	if (fromIndex === toIndex) {
		return props.draft;
	}

	const nextItems = [...items];
	const item = nextItems[fromIndex];

	nextItems.splice(fromIndex, 1);
	nextItems.splice(toIndex, 0, item);

	return { ...props.draft, [props.section]: nextItems };
}

export function toggleCustomizeItem(props: {
	slug: string;
	draft: CustomizeDraft;
	section: CustomizeSection;
}) {
	const itemIndex = props.draft[props.section].findIndex((item) => item.slug === props.slug);
	if (itemIndex === -1) {
		return props.draft;
	}

	const items = props.draft[props.section].map((item, index) =>
		index === itemIndex ? { ...item, isDisabled: !item.isDisabled } : item,
	);

	return { ...props.draft, [props.section]: items };
}

export function isCustomizeDraftDirty(props: { draft: CustomizeDraft; initial: CustomizeDraft }) {
	return (
		!areSectionsEqual(props.draft.views, props.initial.views) ||
		!areSectionsEqual(props.draft.savedViews, props.initial.savedViews)
	);
}

export function getCustomizeSectionCounts(props: {
	draft: CustomizeDraft;
	section: CustomizeSection;
}) {
	const total = props.draft[props.section].length;
	const shown = props.draft[props.section].filter((item) => !item.isDisabled).length;
	if (props.section === "views") {
		return { shown: shown + 1, total: total + 1 };
	}

	return { shown, total };
}
