export const facets = [
	{
		id: "facet-1",
		slug: "media",
		name: "Media",
		icon: "film",
		description: "Track movies, shows, books, and games",
		isEnabled: true,
		isBuiltin: true,
		entitySchemas: [
			{ id: "schema-1", name: "Movies", slug: "movies" },
			{ id: "schema-2", name: "Books", slug: "books" },
			{ id: "schema-3", name: "TV Shows", slug: "tv-shows" },
		],
	},
	{
		id: "facet-2",
		slug: "fitness",
		name: "Fitness",
		icon: "dumbbell",
		description: "Track workouts and measurements",
		isEnabled: true,
		isBuiltin: true,
		entitySchemas: [
			{ id: "schema-4", name: "Workouts", slug: "workouts" },
			{ id: "schema-5", name: "Measurements", slug: "measurements" },
		],
	},
	{
		id: "facet-3",
		slug: "whiskey",
		name: "Whiskey",
		icon: "wine",
		description: "Track whiskey tastings",
		isEnabled: true,
		isBuiltin: false,
		entitySchemas: [{ id: "schema-6", name: "Whiskeys", slug: "whiskeys" }],
	},
	{
		id: "facet-4",
		slug: "places",
		name: "Places",
		icon: "map-pin",
		description: "Track places visited",
		isEnabled: true,
		isBuiltin: false,
		entitySchemas: [{ id: "schema-7", name: "Places", slug: "places" }],
	},
];

export const savedViews = [
	{
		id: "view-1",
		name: "Currently Reading",
		facetSlug: "media",
		schemaSlug: "books",
	},
	{
		id: "view-2",
		name: "Watchlist",
		facetSlug: "media",
		schemaSlug: "movies",
	},
	{
		id: "view-3",
		name: "Favorite Distilleries",
		facetSlug: "whiskey",
		schemaSlug: "whiskeys",
	},
];

export const entities = [
	{
		id: "entity-1",
		name: "Interstellar",
		schemaName: "Movies",
		image:
			"https://images.unsplash.com/photo-1536440136628-849c177e76a1?w=400&h=600&fit=crop&auto=format",
		properties: {
			year: "2014",
			director: "Christopher Nolan",
			genre: "Sci-Fi",
			rating: 9.2,
		},
		lastEvent: "Watched on March 5, 2026",
	},
	{
		id: "entity-2",
		name: "The Martian",
		schemaName: "Books",
		image:
			"https://images.unsplash.com/photo-1512820790803-83ca734da794?w=400&h=600&fit=crop&auto=format",
		properties: {
			author: "Andy Weir",
			year: "2011",
			pages: 369,
			rating: 8.5,
		},
		lastEvent: "Started reading on March 1, 2026",
	},
	{
		id: "entity-3",
		name: "Breaking Bad",
		schemaName: "TV Shows",
		image:
			"https://images.unsplash.com/photo-1522869635100-9f4c5e86aa37?w=400&h=600&fit=crop&auto=format",
		properties: {
			year: "2008-2013",
			seasons: 5,
			genre: "Drama",
			rating: 9.5,
		},
		lastEvent: "Finished Season 3 on Feb 28, 2026",
	},
	{
		id: "entity-4",
		name: "Full Body Strength",
		schemaName: "Workouts",
		image:
			"https://images.unsplash.com/photo-1534438327276-14e5300c3a48?w=400&h=600&fit=crop&auto=format",
		properties: {
			type: "Strength Training",
			duration: "45 min",
			exercises: 6,
		},
		lastEvent: "Completed on March 8, 2026",
	},
	{
		id: "entity-5",
		name: "Lagavulin 16",
		schemaName: "Whiskeys",
		image:
			"https://images.unsplash.com/photo-1569529465841-dfecdab7503b?w=400&h=600&fit=crop&auto=format",
		properties: {
			distillery: "Lagavulin",
			age: "16 years",
			region: "Islay",
			abv: "43%",
			rating: 9.0,
		},
		lastEvent: "Tasted on March 3, 2026",
	},
	{
		id: "entity-6",
		name: "Kyoto, Japan",
		schemaName: "Places",
		image:
			"https://images.unsplash.com/photo-1493976040374-85c8e12f0c0e?w=400&h=600&fit=crop&auto=format",
		properties: {
			country: "Japan",
			visitedDate: "2025-12-15",
			type: "City",
			rating: 9.8,
		},
		lastEvent: "Visited in December 2025",
	},
	{
		id: "entity-7",
		name: "Dune",
		schemaName: "Movies",
		image:
			"https://images.unsplash.com/photo-1478720568477-152d9b164e26?w=400&h=600&fit=crop&auto=format",
		properties: {
			year: "2021",
			director: "Denis Villeneuve",
			genre: "Sci-Fi",
			rating: 8.8,
		},
		lastEvent: "Watched on Feb 20, 2026",
	},
	{
		id: "entity-8",
		name: "Atomic Habits",
		schemaName: "Books",
		image:
			"https://images.unsplash.com/photo-1544947950-fa07a98d237f?w=400&h=600&fit=crop&auto=format",
		properties: {
			author: "James Clear",
			year: "2018",
			pages: 320,
			rating: 8.9,
		},
		lastEvent: "Finished on March 7, 2026",
	},
];

export const events = [
	{
		id: "event-1",
		entityName: "Interstellar",
		schemaName: "Movies",
		type: "watched",
		occurredAt: "March 5, 2026, 8:30 PM",
		properties: { platform: "Netflix", rating: 9.2 },
	},
	{
		id: "event-2",
		entityName: "Full Body Strength",
		schemaName: "Workouts",
		type: "completed",
		occurredAt: "March 8, 2026, 6:00 AM",
		properties: { sets: 18, totalWeight: "4,500 lbs" },
	},
	{
		id: "event-3",
		entityName: "Atomic Habits",
		schemaName: "Books",
		type: "finished",
		occurredAt: "March 7, 2026, 11:00 PM",
		properties: { rating: 8.9, review: "Life-changing book!" },
	},
	{
		id: "event-4",
		entityName: "Lagavulin 16",
		schemaName: "Whiskeys",
		type: "tasted",
		occurredAt: "March 3, 2026, 7:45 PM",
		properties: {
			rating: 9.0,
			notes: "Peaty with hints of vanilla and sea salt",
		},
	},
	{
		id: "event-5",
		entityName: "The Martian",
		schemaName: "Books",
		type: "started",
		occurredAt: "March 1, 2026, 9:15 PM",
		properties: {},
	},
];

export const stats = [
	{ label: "Total Entities", value: "247", change: "+12 this month" },
	{ label: "Events Logged", value: "1,384", change: "+34 this week" },
	{ label: "Active Facets", value: "4", change: "" },
	{ label: "Saved Views", value: "12", change: "+2 new" },
];
