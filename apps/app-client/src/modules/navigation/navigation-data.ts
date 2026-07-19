import type { ListedPlugin } from "@ryot/contract/modules/definitions/schemas";
import type { ListedSavedView } from "@ryot/contract/modules/saved-views/schemas";

type NavigationPlugin = Pick<
	ListedPlugin,
	"name" | "icon" | "sortOrder" | "isDisabled" | "accentColor"
> & {
	slug: string;
};

type NavigationView = Pick<
	ListedSavedView,
	"name" | "icon" | "sortOrder" | "isDisabled" | "accentColor"
> & {
	slug: string;
	pluginSlug: string | null;
};

export type NavigationCollection = NavigationView;
export type NavigationItem = NavigationView & { kind: "view" | "collection" | "home" };

export const navigationData = {
	// TODO: Replace this fixture with definitions/plugins and savedViews/list API data.
	workspaces: [
		{
			slug: "media",
			name: "Media",
			description: "Personal library",
			icon: "clapperboard",
		},
		{
			slug: "fitness",
			name: "Fitness",
			description: "Training and wellness",
			icon: "dumbbell",
		},
		{
			slug: "collections",
			name: "Collections",
			description: "Curated collections",
			icon: "layers-3",
		},
	],
	views: [
		{
			slug: "home",
			name: "Home",
			icon: "house",
			sortOrder: 0,
			isDisabled: false,
			accentColor: "#fd7e14",
			pluginSlug: null,
		},
		{
			slug: "movies",
			name: "Movies",
			icon: "film",
			sortOrder: 1,
			isDisabled: false,
			accentColor: "#fd7e14",
			pluginSlug: "media",
		},
		{
			slug: "shows",
			name: "Shows",
			icon: "tv",
			sortOrder: 2,
			isDisabled: false,
			accentColor: "#fd7e14",
			pluginSlug: "media",
		},
		{
			slug: "books",
			name: "Books",
			icon: "book-open",
			sortOrder: 3,
			isDisabled: false,
			accentColor: "#fd7e14",
			pluginSlug: "media",
		},
		{
			slug: "music",
			name: "Music",
			icon: "music-2",
			sortOrder: 4,
			isDisabled: false,
			accentColor: "#fd7e14",
			pluginSlug: "media",
		},
		{
			slug: "audio-books",
			name: "Audio Books",
			icon: "headphones",
			sortOrder: 5,
			isDisabled: false,
			accentColor: "#fd7e14",
			pluginSlug: "media",
		},
		{
			slug: "video-games",
			name: "Video Games",
			icon: "gamepad-2",
			sortOrder: 6,
			isDisabled: false,
			accentColor: "#fd7e14",
			pluginSlug: "media",
		},
		{
			slug: "people",
			name: "People",
			icon: "users",
			sortOrder: 7,
			isDisabled: false,
			accentColor: "#fd7e14",
			pluginSlug: "media",
		},
		{
			slug: "groups",
			name: "Groups",
			icon: "folder-kanban",
			sortOrder: 8,
			isDisabled: false,
			accentColor: "#fd7e14",
			pluginSlug: "media",
		},
		{
			slug: "genres",
			name: "Genres",
			icon: "tags",
			sortOrder: 9,
			isDisabled: false,
			accentColor: "#fd7e14",
			pluginSlug: "media",
		},
	],
	collections: [
		{
			slug: "sci-fi-essentials",
			name: "Sci-Fi Essentials",
			icon: "sparkles",
			sortOrder: 0,
			isDisabled: false,
			accentColor: "#3a6389",
			pluginSlug: "media",
		},
		{
			slug: "comfort-rewatch",
			name: "Comfort Rewatch",
			icon: "heart",
			sortOrder: 1,
			isDisabled: false,
			accentColor: "#a8422e",
			pluginSlug: "media",
		},
		{
			slug: "currently-reading",
			name: "Currently Reading",
			icon: "book-marked",
			sortOrder: 2,
			isDisabled: false,
			accentColor: "#3d6d2f",
			pluginSlug: "media",
		},
		{
			slug: "owned-on-vinyl",
			name: "Owned on Vinyl",
			icon: "disc-3",
			sortOrder: 3,
			isDisabled: false,
			accentColor: "#c6871f",
			pluginSlug: "media",
		},
		{
			slug: "top-rated",
			name: "Top Rated",
			icon: "star",
			sortOrder: 4,
			isDisabled: false,
			accentColor: "#c6871f",
			pluginSlug: "media",
		},
	],
	savedViews: [
		{
			slug: "sci-fi-watchlist",
			name: "Sci-Fi Watchlist",
			icon: "bookmark",
			sortOrder: 0,
			isDisabled: false,
			accentColor: "#3a6389",
			pluginSlug: "media",
		},
		{
			slug: "backlog",
			name: "Backlog",
			icon: "inbox",
			sortOrder: 1,
			isDisabled: false,
			accentColor: "#a24e08",
			pluginSlug: "media",
		},
		{
			slug: "2024-rewatch",
			name: "2024 Rewatch",
			icon: "rotate-ccw",
			sortOrder: 2,
			isDisabled: false,
			accentColor: "#a8422e",
			pluginSlug: "media",
		},
		{
			slug: "comfort-shows",
			name: "Comfort Shows",
			icon: "heart",
			sortOrder: 3,
			isDisabled: false,
			accentColor: "#a8422e",
			pluginSlug: "media",
		},
		{
			slug: "owned-on-vinyl",
			name: "Owned on Vinyl",
			icon: "disc-3",
			sortOrder: 4,
			isDisabled: false,
			accentColor: "#c6871f",
			pluginSlug: "media",
		},
	],
} satisfies {
	workspaces: ReadonlyArray<
		Pick<NavigationPlugin, "slug" | "name" | "icon"> & { description: string }
	>;
	views: ReadonlyArray<NavigationView>;
	collections: ReadonlyArray<NavigationCollection>;
	savedViews: ReadonlyArray<NavigationView>;
};

export const primaryViews = navigationData.views.slice(0, 4);
export const secondaryViews = navigationData.views.slice(4);

export function getEnabledItems(items: readonly NavigationItem[]) {
	return items.filter((item) => !item.isDisabled).sort((a, b) => a.sortOrder - b.sortOrder);
}

const withKind = (item: NavigationView, kind: NavigationItem["kind"]) =>
	Object.assign({}, item, { kind });

export function getNavigationItems() {
	return {
		collections: getEnabledItems(
			navigationData.collections.map((item) => withKind(item, "collection")),
		),
		savedViews: getEnabledItems(navigationData.savedViews.map((item) => withKind(item, "view"))),
		views: getEnabledItems(
			navigationData.views.map((item) => withKind(item, item.slug === "home" ? "home" : "view")),
		),
	};
}

export function getNavigationHref(workspace: string, item: Pick<NavigationItem, "kind" | "slug">) {
	if (item.kind === "home") {
		return { pathname: "/[workspace]" as const, params: { workspace } };
	}
	if (item.kind === "collection") {
		return {
			pathname: "/[workspace]/collections/[collectionSlug]" as const,
			params: { collectionSlug: item.slug, workspace },
		};
	}
	return {
		pathname: "/[workspace]/views/[viewSlug]" as const,
		params: { viewSlug: item.slug, workspace },
	};
}

export function getActiveNavigationKey(pathname: string) {
	if (pathname.endsWith("/settings")) {
		return "settings";
	}
	const viewMatch = pathname.match(/\/views\/([^/]+)/);
	if (viewMatch?.[1]) {
		return `view:${viewMatch[1]}`;
	}
	const collectionMatch = pathname.match(/\/collections\/([^/]+)/);
	if (collectionMatch?.[1]) {
		return `collection:${collectionMatch[1]}`;
	}
	return "home";
}
