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
		icon: "film",
		sortOrder: 0,
		slug: "media",
		name: "Media",
		enabled: true,
		isExpanded: true,
		accentColor: "#5B7FFF",
		entitySchemas: [
			{
				id: "movies",
				icon: "film",
				name: "Movies",
				slug: "movies",
				accentColor: "#5B7FFF",
			},
			{
				icon: "tv",
				id: "tv-shows",
				name: "TV Shows",
				slug: "tv-shows",
				accentColor: "#FB7185",
			},
			{
				id: "books",
				icon: "book-open",
				name: "Books",
				slug: "books",
				accentColor: "#5B7FFF",
			},
		],
	},
	{
		sortOrder: 1,
		enabled: true,
		id: "fitness",
		slug: "fitness",
		name: "Fitness",
		icon: "dumbbell",
		isExpanded: false,
		accentColor: "#2DD4BF",
		entitySchemas: [
			{
				id: "workouts",
				icon: "dumbbell",
				name: "Workouts",
				slug: "workouts",
				accentColor: "#2DD4BF",
			},
			{
				icon: "apple",
				id: "nutrition",
				name: "Nutrition",
				slug: "nutrition",
				accentColor: "#84CC16",
			},
		],
	},
	{
		icon: "wine",
		sortOrder: 2,
		enabled: true,
		id: "whiskey",
		slug: "whiskey",
		name: "Whiskey",
		isExpanded: false,
		accentColor: "#D4A574",
		entitySchemas: [
			{
				id: "bottles",
				icon: "wine",
				name: "Bottles",
				slug: "bottles",
				accentColor: "#D4A574",
			},
			{
				id: "tastings",
				icon: "glass-water",
				name: "Tastings",
				slug: "tastings",
				accentColor: "#F59E0B",
			},
		],
	},
	{
		id: "places",
		sortOrder: 3,
		enabled: true,
		slug: "places",
		name: "Places",
		icon: "map-pin",
		isExpanded: false,
		accentColor: "#A78BFA",
		entitySchemas: [
			{
				id: "visited",
				icon: "map-pin",
				name: "Visited",
				slug: "visited",
				accentColor: "#A78BFA",
			},
			{
				id: "wishlist",
				icon: "bookmark",
				name: "Wishlist",
				slug: "wishlist",
				accentColor: "#60A5FA",
			},
		],
	},
] as SidebarFacet[];

const fakeViews = [
	{
		id: "currently-reading",
		name: "Currently Reading",
		slug: "currently-reading",
		icon: "book-open",
	},
	{ id: "watchlist", name: "Watchlist", slug: "watchlist", icon: "eye" },
	{ id: "favorites", name: "Favorites", slug: "favorites", icon: "star" },
	{ id: "recent", name: "Recent", slug: "recent", icon: "clock" },
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
