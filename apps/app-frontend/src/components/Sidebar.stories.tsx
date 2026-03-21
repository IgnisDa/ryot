import preview from "#.storybook/preview";
import { Sidebar } from "./Sidebar";
import type { SidebarFacet } from "./Sidebar.types";

const meta = preview.meta({
	component: Sidebar,
	title: "Components/Sidebar",
});

export default meta;

const fakeFacets = [
	{
		id: "media",
		slug: "media",
		name: "Media",
		icon: "Film",
		enabled: true,
		sortOrder: 0,
		isExpanded: true,
		entitySchemas: [
			{ id: "movies", name: "Movies", slug: "movies" },
			{ id: "tv-shows", name: "TV Shows", slug: "tv-shows" },
			{ id: "books", name: "Books", slug: "books" },
		],
	},
	{
		sortOrder: 1,
		enabled: true,
		id: "fitness",
		slug: "fitness",
		name: "Fitness",
		icon: "Activity",
		isExpanded: false,
		entitySchemas: [
			{ id: "workouts", name: "Workouts", slug: "workouts" },
			{ id: "nutrition", name: "Nutrition", slug: "nutrition" },
		],
	},
	{
		icon: "Wine",
		sortOrder: 2,
		enabled: true,
		id: "whiskey",
		slug: "whiskey",
		name: "Whiskey",
		isExpanded: false,
		entitySchemas: [
			{ id: "bottles", name: "Bottles", slug: "bottles" },
			{ id: "tastings", name: "Tastings", slug: "tastings" },
		],
	},
	{
		id: "places",
		sortOrder: 3,
		enabled: true,
		slug: "places",
		name: "Places",
		icon: "MapPin",
		isExpanded: false,
		entitySchemas: [
			{ id: "visited", name: "Visited", slug: "visited" },
			{ id: "wishlist", name: "Wishlist", slug: "wishlist" },
		],
	},
];

const fakeViews = [
	{
		id: "currently-reading",
		name: "Currently Reading",
		slug: "currently-reading",
		icon: "BookOpen",
	},
	{ id: "watchlist", name: "Watchlist", slug: "watchlist", icon: "Eye" },
	{ id: "favorites", name: "Favorites", slug: "favorites", icon: "Star" },
	{ id: "recent", name: "Recent", slug: "recent", icon: "Clock" },
];

export const Default = meta.story({
	args: {
		views: fakeViews,
		facets: fakeFacets,
		isCustomizeMode: false,
		onToggleCustomizeMode: () => console.log("Toggle customize mode"),
		onSearch: (query: string) => console.log("Search:", query),
		onToggleFacet: (id: string) => console.log("Toggled facet:", id),
		onReorderFacets: (facets: SidebarFacet[]) =>
			console.log("Reordered facets:", facets),
	},
});

export const CustomizeMode = meta.story({
	args: {
		views: fakeViews,
		facets: fakeFacets,
		isCustomizeMode: true,
		onToggleCustomizeMode: () => console.log("Toggle customize mode"),
		onSearch: (query: string) => console.log("Search:", query),
		onToggleFacet: (id: string) => console.log("Toggled facet:", id),
		onReorderFacets: (facets: SidebarFacet[]) =>
			console.log("Reordered facets:", facets),
	},
});

export const Empty = meta.story({
	args: {
		views: [],
		facets: [],
		isCustomizeMode: false,
		onToggleCustomizeMode: () => console.log("Toggle customize mode"),
		onSearch: (query: string) => console.log("Search:", query),
		onToggleFacet: (id: string) => console.log("Toggled facet:", id),
		onReorderFacets: (facets: SidebarFacet[]) =>
			console.log("Reordered facets:", facets),
	},
});
