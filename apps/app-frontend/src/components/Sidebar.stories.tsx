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
		views: [
			{
				icon: "film",
				name: "Movies",
				facetId: "media",
				id: "movies-view",
				accentColor: "#5B7FFF",
			},
			{
				icon: "tv",
				name: "TV Shows",
				facetId: "media",
				id: "tv-shows-view",
				accentColor: "#FB7185",
			},
			{
				name: "Books",
				facetId: "media",
				id: "books-view",
				icon: "book-open",
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
		views: [
			{
				icon: "dumbbell",
				name: "Workouts",
				facetId: "fitness",
				id: "workouts-view",
				accentColor: "#2DD4BF",
			},
			{
				icon: "apple",
				name: "Nutrition",
				facetId: "fitness",
				id: "nutrition-view",
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
		views: [
			{
				icon: "wine",
				name: "Bottles",
				id: "bottles-view",
				facetId: "whiskey",
				accentColor: "#D4A574",
			},
			{
				name: "Tastings",
				facetId: "whiskey",
				id: "tastings-view",
				icon: "glass-water",
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
		views: [
			{
				icon: "map-pin",
				name: "Visited",
				facetId: "places",
				id: "visited-view",
				accentColor: "#A78BFA",
			},
			{
				icon: "bookmark",
				name: "Wishlist",
				facetId: "places",
				id: "wishlist-view",
				accentColor: "#60A5FA",
			},
		],
	},
] as SidebarFacet[];

const fakeViews = [
	{
		facetId: null,
		icon: "book-open",
		accentColor: "#5B7FFF",
		id: "currently-reading",
		name: "Currently Reading",
	},
	{
		icon: "eye",
		facetId: null,
		id: "watchlist",
		name: "Watchlist",
		accentColor: "#FB7185",
	},
	{
		icon: "star",
		facetId: null,
		id: "favorites",
		name: "Favorites",
		accentColor: "#D4A574",
	},
	{
		id: "recent",
		icon: "clock",
		facetId: null,
		name: "Recent",
		accentColor: "#2DD4BF",
	},
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
