import type { ListedPlugin } from "@ryot/contract/modules/definitions/schemas";
import type { RowItem, RyotQLResponse } from "@ryot/contract/modules/ryotql/language";
import type { ListedSavedView } from "@ryot/contract/modules/saved-views/schemas";

type NavigationPlugin = Omit<
	Pick<ListedPlugin, "slug" | "name" | "icon" | "sortOrder" | "isDisabled" | "accentColor">,
	"slug"
> & { slug: string };

type NavigationView = Omit<
	Pick<
		ListedSavedView,
		"slug" | "name" | "icon" | "sortOrder" | "isDisabled" | "accentColor" | "pluginSlug"
	>,
	"slug" | "pluginSlug"
> & { slug: string; pluginSlug: string | null };

export type NavigationCollection = NavigationView;
export type NavigationWorkspace = NavigationPlugin;
export type NavigationItem = NavigationView & { kind: "view" | "collection" | "home" };

export type NavigationData = {
	savedViews: readonly NavigationView[];
	workspaces: readonly NavigationWorkspace[];
	collections: readonly NavigationCollection[];
};

export type NavigationItems = {
	views: readonly NavigationItem[];
	savedViews: readonly NavigationItem[];
	collections: readonly NavigationItem[];
};

const homeView = {
	slug: "home",
	sortOrder: 0,
	name: "Home",
	icon: "house",
	accentColor: "",
	pluginSlug: null,
	isDisabled: false,
} satisfies NavigationView;

function getTextField(row: RowItem, key: string) {
	const field = row[key];
	if (!field || !("kind" in field) || field.kind !== "text" || typeof field.value !== "string") {
		return undefined;
	}
	return field.value;
}

function getNumberField(row: RowItem, key: string) {
	const field = row[key];
	if (!field || !("kind" in field) || field.kind !== "number" || typeof field.value !== "number") {
		return undefined;
	}
	return field.value;
}

function getBooleanField(row: RowItem, key: string) {
	const field = row[key];
	if (
		!field ||
		!("kind" in field) ||
		field.kind !== "boolean" ||
		typeof field.value !== "boolean"
	) {
		return undefined;
	}
	return field.value;
}

function getNullableTextField(row: RowItem, key: string) {
	const field = row[key];
	if (!field || !("kind" in field)) {
		return undefined;
	}
	if (field.kind === "null") {
		return null;
	}
	return field.kind === "text" && typeof field.value === "string" ? field.value : undefined;
}

export function mapNavigationResponse(response: RyotQLResponse): NavigationData {
	const workspaces = response.data.workspaces;
	const savedViews = response.data.savedViews;
	const collections = response.data.collections;
	return {
		workspaces:
			workspaces?.type === "rows"
				? getEnabledItems(
						workspaces.items.flatMap((row, index) => {
							const slug = getTextField(row, "slug");
							const name = getTextField(row, "name");
							const icon = getTextField(row, "icon");
							const accentColor = getTextField(row, "accentColor");
							if (!slug || !name || !icon || !accentColor) {
								return [];
							}
							return [
								{
									slug,
									name,
									icon,
									accentColor,
									sortOrder: getNumberField(row, "sortOrder") ?? index,
									isDisabled: getBooleanField(row, "isDisabled") ?? false,
								},
							];
						}),
					)
				: [],
		savedViews:
			savedViews?.type === "rows"
				? savedViews.items.flatMap((row) => {
						const slug = getTextField(row, "slug");
						const name = getTextField(row, "name");
						const icon = getTextField(row, "icon");
						const accentColor = getTextField(row, "accentColor");
						const sortOrder = getNumberField(row, "sortOrder");
						const isDisabled = getBooleanField(row, "isDisabled");
						const pluginSlug = getNullableTextField(row, "pluginSlug");
						if (
							!slug ||
							!name ||
							!icon ||
							!accentColor ||
							sortOrder === undefined ||
							isDisabled === undefined ||
							pluginSlug === undefined
						) {
							return [];
						}
						return [{ slug, name, icon, accentColor, sortOrder, isDisabled, pluginSlug }];
					})
				: [],
		collections:
			collections?.type === "rows"
				? collections.items.flatMap((row, index) => {
						const slug = getTextField(row, "id");
						const name = getTextField(row, "name");
						if (!slug || !name) {
							return [];
						}

						return [
							{
								name,
								slug,
								accentColor: "",
								sortOrder: index,
								icon: "layers-3",
								pluginSlug: null,
								isDisabled: false,
							},
						];
					})
				: [],
	};
}

export function getEnabledItems<T extends Pick<NavigationView, "isDisabled" | "sortOrder">>(
	items: readonly T[],
) {
	return items.filter((item) => !item.isDisabled).sort((a, b) => a.sortOrder - b.sortOrder);
}

const withKind = (item: NavigationView, kind: NavigationItem["kind"]) =>
	Object.assign({}, item, { kind });

export function getNavigationItems(props: { data: NavigationData; workspaceSlug: string }) {
	const workspaceViews = props.data.savedViews.filter(
		(item) => item.pluginSlug === props.workspaceSlug,
	);
	const savedViews = props.data.savedViews.filter((item) => item.pluginSlug === null);

	return {
		savedViews: getEnabledItems(savedViews.map((item) => withKind(item, "view"))),
		collections: getEnabledItems(
			props.data.collections.map((item) => withKind(item, "collection")),
		),
		views: getEnabledItems([
			withKind(homeView, "home"),
			...workspaceViews.map((item) => withKind(item, "view")),
		]),
	};
}

export function getWorkspaceSummary(items: Pick<NavigationItems, "savedViews" | "views">) {
	const views = `${items.views.length} view${items.views.length === 1 ? "" : "s"}`;
	const savedViews =
		items.savedViews.length === 0
			? "no saved views"
			: `${items.savedViews.length} saved view${items.savedViews.length === 1 ? "" : "s"}`;
	return `${views} · ${savedViews}`;
}

export function getWorkspacePickerSummary(items: Pick<NavigationItems, "views">) {
	const views = items.views.filter((item) => item.kind !== "home");
	if (views.length === 0) {
		return "Custom workspace · 0 views";
	}

	const names = views.slice(0, 3).map((item) => item.name);
	const remaining = views.length - names.length;
	return `${names.join(", ")}${remaining > 0 ? ` +${remaining}` : ""}`;
}

export function getCurrentWorkspace(
	workspaces: readonly NavigationWorkspace[],
	routeWorkspace: string | undefined,
	persistedWorkspace: string,
): NavigationWorkspace | undefined {
	return (
		workspaces.find((item) => item.slug === routeWorkspace) ??
		workspaces.find((item) => item.slug === persistedWorkspace) ??
		workspaces[0]
	);
}

export function getNavigationHref(workspace: string, item: Pick<NavigationItem, "kind" | "slug">) {
	if (item.kind === "home") {
		return { pathname: "/[workspace]" as const, params: { workspace } };
	}
	if (item.kind === "collection") {
		return { params: { entityId: item.slug }, pathname: "/e/[entityId]" as const };
	}
	return { params: { viewSlug: item.slug }, pathname: "/v/[viewSlug]" as const };
}

export function getActiveNavigationKey(pathname: string) {
	if (pathname.endsWith("/settings")) {
		return "settings";
	}
	const viewMatch = pathname.match(/\/v\/([^/]+)/);
	if (viewMatch?.[1]) {
		return `view:${viewMatch[1]}`;
	}
	const collectionMatch = pathname.match(/\/e\/([^/]+)/);
	if (collectionMatch?.[1]) {
		return `collection:${collectionMatch[1]}`;
	}
	return "home";
}
