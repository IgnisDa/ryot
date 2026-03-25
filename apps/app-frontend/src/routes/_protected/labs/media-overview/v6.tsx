// V6: Action-oriented overview — "what should I do next?"
// Leads with Continue (in-progress with progress bars), then Up Next (backlog),
// Rate These (unrated completions), This Week (activity), Library at a Glance.
// Every section is actionable. Stats are de-emphasized at the bottom.
//
// --- Add Flow Divergences from current SearchEntityModal API ---
//
// 1. TYPE SELECTION STEP: The existing SearchEntityModal receives a single
//    entitySchema prop. V6 adds a preceding type-picker step so users select
//    which media type (entity schema) to search within. In production, the
//    tracker's associated entity schemas would be fetched via the
//    /entity-schemas/list endpoint and displayed as the type grid.
//
// 2. ACTIONS AT ADD-TIME: The existing flow creates an entity and nothing else.
//    V6 exposes four independent actions per search result: Log (history event
//    with date + optional rating), Backlog (intent event), Collection (saved
//    view membership), and Rate & Review (rating event + optional text). In
//    production each action would POST /entities to ensure the entity exists,
//    then POST /events for the corresponding event schema. Actions are fully
//    independent — completing one does not affect availability of others.
//
// 3. SEARCH RESULT SHAPE: Matches the existing SearchResultItem type from
//    use-search.ts: { identifier, titleProperty, subtitleProperty,
//    imageProperty, badgeProperty }. The subtitleProperty.value is used as
//    a year (number) for visual media, null otherwise.
//
// 4. ENTITY SCHEMA SHAPE: Mock schemas match the real AppEntitySchema fields:
//    { id, name, slug, icon, accentColor, searchProviders[] }. The icon field
//    stores a string key; the real system would resolve this to a component.

import {
	ActionIcon,
	Badge,
	Box,
	Button,
	Container,
	Group,
	Loader,
	Modal,
	Paper,
	Progress,
	ScrollArea,
	SegmentedControl,
	SimpleGrid,
	Stack,
	Text,
	Textarea,
	TextInput,
	Tooltip,
	UnstyledButton,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { createFileRoute } from "@tanstack/react-router";
import {
	Bookmark,
	BookOpen,
	ChevronLeft,
	ChevronRight,
	Clock,
	FolderPlus,
	Gamepad2,
	Headphones,
	History,
	Image as ImageIcon,
	Monitor,
	Play,
	Plus,
	Search,
	Star,
	Tv,
} from "lucide-react";
import { useState } from "react";
import { useThemeTokens } from "#/hooks/theme";

export const Route = createFileRoute("/_protected/labs/media-overview/v6")({
	component: RouteComponent,
});

const GOLD = "#C9943A";

type MediaType =
	| "Book"
	| "Show"
	| "Movie"
	| "Anime"
	| "Manga"
	| "Music"
	| "Podcast"
	| "AudioBook"
	| "VideoGame"
	| "ComicBook"
	| "VisualNovel";

const TYPE_COLORS: Record<MediaType, string> = {
	Book: "#8B5E3C",
	Show: "#5B7FFF",
	Movie: "#E05252",
	Anime: "#FF6B6B",
	Manga: "#C9943A",
	Music: "#9B59B6",
	Podcast: "#1ABC9C",
	AudioBook: "#E67E22",
	VideoGame: "#27AE60",
	ComicBook: "#E74C3C",
	VisualNovel: "#F39C12",
};

const TYPE_ICONS: Record<MediaType, typeof BookOpen> = {
	Book: BookOpen,
	Show: Tv,
	Movie: Monitor,
	Anime: Tv,
	Manga: BookOpen,
	Music: Headphones,
	Podcast: Headphones,
	AudioBook: Headphones,
	VideoGame: Gamepad2,
	ComicBook: BookOpen,
	VisualNovel: BookOpen,
};

interface InProgressItem {
	id: string;
	sub: string;
	type: MediaType;
	title: string;
	coverUrl: string;
	current: number;
	total: number;
	unit: string;
	lastActivity: string;
	actionLabel: string;
}

interface BacklogItem {
	id: string;
	sub: string;
	type: MediaType;
	title: string;
	coverUrl: string;
	addedDate: string;
}

interface UnratedItem {
	id: string;
	sub: string;
	type: MediaType;
	title: string;
	coverUrl: string;
	completedDate: string;
}

interface ActivityEvent {
	id: string;
	sub: string;
	date: string;
	time: string;
	type: MediaType;
	title: string;
	action: string;
	coverUrl: string;
	rating: number | null;
}

interface WeekDay {
	day: string;
	count: number;
}

// --- Mock Data ---

const IN_PROGRESS: InProgressItem[] = [
	{
		id: "ip1",
		type: "Book",
		title: "The Wind Is Never Gone",
		sub: "Sally Mandel",
		current: 142,
		total: 380,
		unit: "pages",
		lastActivity: "2h ago",
		actionLabel: "Log Progress",
		coverUrl: "https://covers.openlibrary.org/b/id/240726-L.jpg",
	},
	{
		id: "ip2",
		type: "Anime",
		title: "Dungeon Meshi",
		sub: "Studio Trigger",
		current: 12,
		total: 24,
		unit: "episodes",
		lastActivity: "Yesterday",
		actionLabel: "Next Episode",
		coverUrl: "https://cdn.myanimelist.net/images/anime/1628/140081.jpg",
	},
	{
		id: "ip3",
		type: "Show",
		title: "Breaking Bad",
		sub: "S3 E7 · Vince Gilligan",
		current: 27,
		total: 62,
		unit: "episodes",
		lastActivity: "Yesterday",
		actionLabel: "Next Episode",
		coverUrl: "https://image.tmdb.org/t/p/w500/ggFHVNu6YYI5L9pCfOacjizRGt.jpg",
	},
	{
		id: "ip4",
		type: "Anime",
		title: "Solo Leveling",
		sub: "A-1 Pictures",
		current: 8,
		total: 12,
		unit: "episodes",
		lastActivity: "3d ago",
		actionLabel: "Next Episode",
		coverUrl: "https://cdn.myanimelist.net/images/anime/1258/135739.jpg",
	},
	{
		id: "ip5",
		type: "Book",
		title: "What to Do When I'm Gone",
		sub: "Suzy Hopkins",
		current: 34,
		total: 192,
		unit: "pages",
		lastActivity: "3d ago",
		actionLabel: "Log Progress",
		coverUrl: "https://covers.openlibrary.org/b/id/10527831-L.jpg",
	},
	{
		id: "ip6",
		type: "Manga",
		title: "Vagabond",
		sub: "Takehiko Inoue",
		current: 89,
		total: 327,
		unit: "chapters",
		lastActivity: "4d ago",
		actionLabel: "Log Progress",
		coverUrl: "https://cdn.myanimelist.net/images/manga/3/116498.jpg",
	},
	{
		id: "ip7",
		type: "AudioBook",
		title: "The Pragmatic Programmer",
		sub: "David Thomas",
		current: 4,
		total: 10,
		unit: "hours",
		lastActivity: "5d ago",
		actionLabel: "Resume",
		coverUrl: "https://m.media-amazon.com/images/I/41BKx1AxQWL.jpg",
	},
	{
		id: "ip8",
		type: "Music",
		title: "In Rainbows",
		sub: "Radiohead",
		current: 5,
		total: 10,
		unit: "tracks",
		lastActivity: "5d ago",
		actionLabel: "Listen",
		coverUrl:
			"https://upload.wikimedia.org/wikipedia/en/3/3e/In_Rainbows_Official_Cover.jpg",
	},
	{
		id: "ip9",
		type: "Podcast",
		title: "Lex Fridman Podcast",
		sub: "Lex Fridman",
		current: 23,
		total: 0,
		unit: "episodes",
		lastActivity: "1w ago",
		actionLabel: "Next Episode",
		coverUrl:
			"https://images.unsplash.com/photo-1478737270239-2f02b77fc618?w=300&fit=crop",
	},
	{
		id: "ip10",
		type: "ComicBook",
		title: "The Sandman",
		sub: "Neil Gaiman",
		current: 24,
		total: 75,
		unit: "issues",
		lastActivity: "1w ago",
		actionLabel: "Continue",
		coverUrl:
			"https://upload.wikimedia.org/wikipedia/en/f/f5/SandmanIssue1.jpg",
	},
	{
		id: "ip11",
		type: "VisualNovel",
		title: "Clannad",
		sub: "Key / Visual Arts",
		current: 12,
		total: 48,
		unit: "hours",
		lastActivity: "2w ago",
		actionLabel: "Continue",
		coverUrl: "https://cdn.myanimelist.net/images/anime/1811/97462.jpg",
	},
];

const BACKLOG: BacklogItem[] = [
	{
		id: "bl1",
		type: "Movie",
		title: "The Brutalist",
		sub: "Brady Corbet",
		addedDate: "2d ago",
		coverUrl: "https://image.tmdb.org/t/p/w500/1pdfLvkbY9ohJlCjQH2CZjjYVvJ.jpg",
	},
	{
		id: "bl2",
		type: "Book",
		title: "Project Hail Mary",
		sub: "Andy Weir",
		addedDate: "4d ago",
		coverUrl: "https://covers.openlibrary.org/b/id/10527831-L.jpg",
	},
	{
		id: "bl3",
		type: "VideoGame",
		title: "Silksong",
		sub: "Team Cherry",
		addedDate: "1w ago",
		coverUrl:
			"https://images.igdb.com/igdb/image/upload/t_cover_big/co3p2d.jpg",
	},
	{
		id: "bl4",
		type: "Anime",
		title: "Chainsaw Man S2",
		sub: "MAPPA",
		addedDate: "1w ago",
		coverUrl: "https://cdn.myanimelist.net/images/anime/1015/138006.jpg",
	},
	{
		id: "bl5",
		type: "Show",
		title: "The Bear S3",
		sub: "FX",
		addedDate: "2w ago",
		coverUrl: "https://image.tmdb.org/t/p/w500/oNF5oacaZFXMjGC8fWOTvmDCxLr.jpg",
	},
	{
		id: "bl6",
		type: "Podcast",
		title: "Huberman Lab",
		sub: "Andrew Huberman",
		addedDate: "2w ago",
		coverUrl:
			"https://images.unsplash.com/photo-1478737270239-2f02b77fc618?w=300&fit=crop",
	},
	{
		id: "bl7",
		type: "Manga",
		title: "Dandadan",
		sub: "Yukinobu Tatsu",
		addedDate: "3w ago",
		coverUrl: "https://cdn.myanimelist.net/images/manga/1/157897.jpg",
	},
];

const UNRATED: UnratedItem[] = [
	{
		id: "ur1",
		type: "Movie",
		title: "Poor Things",
		sub: "Yorgos Lanthimos",
		completedDate: "3d ago",
		coverUrl: "https://image.tmdb.org/t/p/w500/kCGlIMHnOm8JPXIwwzwrznhIiIT.jpg",
	},
	{
		id: "ur2",
		type: "AudioBook",
		title: "Atomic Habits",
		sub: "James Clear",
		completedDate: "1w ago",
		coverUrl: "https://m.media-amazon.com/images/I/513Y5o-DYtL.jpg",
	},
	{
		id: "ur3",
		type: "Music",
		title: "Random Access Memories",
		sub: "Daft Punk",
		completedDate: "1w ago",
		coverUrl:
			"https://upload.wikimedia.org/wikipedia/en/a/a7/Random_Access_Memories.jpg",
	},
];

const WEEK_ACTIVITY: WeekDay[] = [
	{ day: "Mon", count: 2 },
	{ day: "Tue", count: 0 },
	{ day: "Wed", count: 1 },
	{ day: "Thu", count: 3 },
	{ day: "Fri", count: 0 },
	{ day: "Sat", count: 4 },
	{ day: "Sun", count: 1 },
];

const RECENT_EVENTS: ActivityEvent[] = [
	{
		id: "e1",
		date: "Today",
		time: "2h ago",
		type: "Book",
		title: "The Wind Is Never Gone",
		sub: "pg 142 of 380",
		action: "Logged progress",
		coverUrl: "https://covers.openlibrary.org/b/id/240726-L.jpg",
		rating: null,
	},
	{
		id: "e2",
		date: "Today",
		time: "5h ago",
		type: "Anime",
		title: "Dungeon Meshi",
		sub: "Episode 12",
		action: "Watched",
		coverUrl: "https://cdn.myanimelist.net/images/anime/1628/140081.jpg",
		rating: null,
	},
	{
		id: "e3",
		date: "Yesterday",
		time: "Yesterday",
		type: "Show",
		title: "Breaking Bad",
		sub: "S3 E7",
		action: "Watched",
		coverUrl: "https://image.tmdb.org/t/p/w500/ggFHVNu6YYI5L9pCfOacjizRGt.jpg",
		rating: null,
	},
	{
		id: "e4",
		date: "Yesterday",
		time: "Yesterday",
		type: "Movie",
		title: "Poor Things",
		sub: "Yorgos Lanthimos",
		action: "Completed",
		coverUrl: "https://image.tmdb.org/t/p/w500/kCGlIMHnOm8JPXIwwzwrznhIiIT.jpg",
		rating: null,
	},
	{
		id: "e5",
		date: "3 days ago",
		time: "3d ago",
		type: "Anime",
		title: "Solo Leveling",
		sub: "Episode 8",
		action: "Watched",
		coverUrl: "https://cdn.myanimelist.net/images/anime/1258/135739.jpg",
		rating: null,
	},
	{
		id: "e6",
		date: "3 days ago",
		time: "3d ago",
		type: "Anime",
		title: "Frieren: Beyond Journey's End",
		sub: "28 of 28",
		action: "Completed",
		coverUrl: "https://cdn.myanimelist.net/images/anime/1015/138006.jpg",
		rating: 5,
	},
	{
		id: "e7",
		date: "1 week ago",
		time: "1w ago",
		type: "VideoGame",
		title: "Elden Ring",
		sub: "FromSoftware",
		action: "Completed",
		coverUrl:
			"https://images.igdb.com/igdb/image/upload/t_cover_big/co4jni.jpg",
		rating: 5,
	},
];

const LIBRARY_STATS = {
	total: 29,
	active: 11,
	completed: 15,
	onHold: 5,
	dropped: 1,
	avgRating: 4.6,
	thisWeekCompleted: 2,
	thisWeekHours: 18,
};

const TYPE_COUNTS: { type: MediaType; count: number }[] = [
	{ type: "Anime", count: 5 },
	{ type: "Book", count: 4 },
	{ type: "Movie", count: 3 },
	{ type: "Show", count: 3 },
	{ type: "VideoGame", count: 3 },
	{ type: "Music", count: 3 },
	{ type: "Manga", count: 2 },
	{ type: "AudioBook", count: 2 },
	{ type: "Podcast", count: 2 },
	{ type: "ComicBook", count: 2 },
	{ type: "VisualNovel", count: 2 },
];

// --- Add Flow: Mock entity schemas (matches AppEntitySchema shape) ---

interface MockEntitySchema {
	id: string;
	name: string;
	slug: string;
	icon: string;
	accentColor: string;
	searchProviders: {
		name: string;
		searchScriptId: string;
		detailsScriptId: string;
	}[];
}

const MOCK_ENTITY_SCHEMAS: MockEntitySchema[] = [
	{
		id: "es-movie",
		name: "Movie",
		slug: "movie",
		icon: "Monitor",
		accentColor: "#E05252",
		searchProviders: [
			{
				name: "TMDB",
				searchScriptId: "s-tmdb-movie",
				detailsScriptId: "d-tmdb-movie",
			},
			{
				name: "Letterboxd",
				searchScriptId: "s-lb-movie",
				detailsScriptId: "d-lb-movie",
			},
		],
	},
	{
		id: "es-show",
		name: "Show",
		slug: "show",
		icon: "Tv",
		accentColor: "#5B7FFF",
		searchProviders: [
			{
				name: "TMDB",
				searchScriptId: "s-tmdb-show",
				detailsScriptId: "d-tmdb-show",
			},
			{
				name: "TVDb",
				searchScriptId: "s-tvdb-show",
				detailsScriptId: "d-tvdb-show",
			},
		],
	},
	{
		id: "es-book",
		name: "Book",
		slug: "book",
		icon: "BookOpen",
		accentColor: "#8B5E3C",
		searchProviders: [
			{
				name: "Open Library",
				searchScriptId: "s-ol-book",
				detailsScriptId: "d-ol-book",
			},
			{
				name: "Hardcover",
				searchScriptId: "s-hc-book",
				detailsScriptId: "d-hc-book",
			},
			{
				name: "Google Books",
				searchScriptId: "s-gb-book",
				detailsScriptId: "d-gb-book",
			},
		],
	},
	{
		id: "es-anime",
		name: "Anime",
		slug: "anime",
		icon: "Tv",
		accentColor: "#FF6B6B",
		searchProviders: [
			{
				name: "MyAnimeList",
				searchScriptId: "s-mal-anime",
				detailsScriptId: "d-mal-anime",
			},
			{
				name: "AniList",
				searchScriptId: "s-al-anime",
				detailsScriptId: "d-al-anime",
			},
		],
	},
	{
		id: "es-manga",
		name: "Manga",
		slug: "manga",
		icon: "BookOpen",
		accentColor: "#C9943A",
		searchProviders: [
			{
				name: "MyAnimeList",
				searchScriptId: "s-mal-manga",
				detailsScriptId: "d-mal-manga",
			},
			{
				name: "AniList",
				searchScriptId: "s-al-manga",
				detailsScriptId: "d-al-manga",
			},
			{
				name: "MangaDex",
				searchScriptId: "s-md-manga",
				detailsScriptId: "d-md-manga",
			},
		],
	},
	{
		id: "es-videogame",
		name: "Video Game",
		slug: "video-game",
		icon: "Gamepad2",
		accentColor: "#27AE60",
		searchProviders: [
			{ name: "IGDB", searchScriptId: "s-igdb", detailsScriptId: "d-igdb" },
			{ name: "RAWG", searchScriptId: "s-rawg", detailsScriptId: "d-rawg" },
		],
	},
	{
		id: "es-music",
		name: "Music",
		slug: "music",
		icon: "Headphones",
		accentColor: "#9B59B6",
		searchProviders: [
			{ name: "MusicBrainz", searchScriptId: "s-mb", detailsScriptId: "d-mb" },
			{ name: "Last.fm", searchScriptId: "s-lfm", detailsScriptId: "d-lfm" },
		],
	},
	{
		id: "es-podcast",
		name: "Podcast",
		slug: "podcast",
		icon: "Headphones",
		accentColor: "#1ABC9C",
		searchProviders: [
			{
				name: "Podcast Index",
				searchScriptId: "s-pi",
				detailsScriptId: "d-pi",
			},
			{
				name: "Apple Podcasts",
				searchScriptId: "s-ap",
				detailsScriptId: "d-ap",
			},
		],
	},
	{
		id: "es-audiobook",
		name: "Audiobook",
		slug: "audiobook",
		icon: "Headphones",
		accentColor: "#E67E22",
		searchProviders: [
			{
				name: "Audible",
				searchScriptId: "s-audible",
				detailsScriptId: "d-audible",
			},
			{
				name: "Open Library",
				searchScriptId: "s-ol-audio",
				detailsScriptId: "d-ol-audio",
			},
		],
	},
	{
		id: "es-comic",
		name: "Comic Book",
		slug: "comic-book",
		icon: "BookOpen",
		accentColor: "#E74C3C",
		searchProviders: [
			{ name: "ComicVine", searchScriptId: "s-cv", detailsScriptId: "d-cv" },
			{
				name: "Marvel",
				searchScriptId: "s-marvel",
				detailsScriptId: "d-marvel",
			},
		],
	},
	{
		id: "es-vn",
		name: "Visual Novel",
		slug: "visual-novel",
		icon: "BookOpen",
		accentColor: "#F39C12",
		searchProviders: [
			{ name: "VNDB", searchScriptId: "s-vndb", detailsScriptId: "d-vndb" },
		],
	},
];

// Matches SearchResultItem from use-search.ts
interface MockSearchResult {
	identifier: string;
	badgeProperty: { kind: "null"; value: null };
	titleProperty: { kind: "text"; value: string };
	subtitleProperty: { kind: "number" | "null"; value: number | null };
	imageProperty: {
		kind: "image" | "null";
		value: { kind: "remote"; url: string } | null;
	};
}

// Keyed by searchScriptId — different providers return different results
const MOCK_SEARCH_RESULTS: Record<string, MockSearchResult[]> = {
	// Movie providers
	"s-tmdb-movie": [
		{
			identifier: "tmdb-872585",
			titleProperty: { kind: "text", value: "Oppenheimer" },
			subtitleProperty: { kind: "number", value: 2023 },
			imageProperty: {
				kind: "image",
				value: {
					kind: "remote",
					url: "https://image.tmdb.org/t/p/w500/8Gxv8gSFCU0XGDykEGv7zR1n2ua.jpg",
				},
			},
			badgeProperty: { kind: "null", value: null },
		},
		{
			identifier: "tmdb-693134",
			titleProperty: { kind: "text", value: "Dune: Part Two" },
			subtitleProperty: { kind: "number", value: 2024 },
			imageProperty: {
				kind: "image",
				value: {
					kind: "remote",
					url: "https://image.tmdb.org/t/p/w500/1pdfLvkbY9ohJlCjQH2CZjjYVvJ.jpg",
				},
			},
			badgeProperty: { kind: "null", value: null },
		},
		{
			identifier: "tmdb-792307",
			titleProperty: { kind: "text", value: "Poor Things" },
			subtitleProperty: { kind: "number", value: 2023 },
			imageProperty: {
				kind: "image",
				value: {
					kind: "remote",
					url: "https://image.tmdb.org/t/p/w500/kCGlIMHnOm8JPXIwwzwrznhIiIT.jpg",
				},
			},
			badgeProperty: { kind: "null", value: null },
		},
		{
			identifier: "tmdb-466420",
			titleProperty: { kind: "text", value: "Killers of the Flower Moon" },
			subtitleProperty: { kind: "number", value: 2023 },
			imageProperty: { kind: "image", value: null },
			badgeProperty: { kind: "null", value: null },
		},
	],
	"s-lb-movie": [
		{
			identifier: "lb-872585",
			titleProperty: { kind: "text", value: "Oppenheimer" },
			subtitleProperty: { kind: "number", value: 2023 },
			imageProperty: {
				kind: "image",
				value: {
					kind: "remote",
					url: "https://image.tmdb.org/t/p/w500/8Gxv8gSFCU0XGDykEGv7zR1n2ua.jpg",
				},
			},
			badgeProperty: { kind: "null", value: null },
		},
		{
			identifier: "lb-940721",
			titleProperty: { kind: "text", value: "Godzilla Minus One" },
			subtitleProperty: { kind: "number", value: 2023 },
			imageProperty: { kind: "image", value: null },
			badgeProperty: { kind: "null", value: null },
		},
	],
	// Show providers
	"s-tmdb-show": [
		{
			identifier: "tmdb-1396",
			titleProperty: { kind: "text", value: "Breaking Bad" },
			subtitleProperty: { kind: "number", value: 2008 },
			imageProperty: {
				kind: "image",
				value: {
					kind: "remote",
					url: "https://image.tmdb.org/t/p/w500/ggFHVNu6YYI5L9pCfOacjizRGt.jpg",
				},
			},
			badgeProperty: { kind: "null", value: null },
		},
		{
			identifier: "tmdb-95396",
			titleProperty: { kind: "text", value: "Severance" },
			subtitleProperty: { kind: "number", value: 2022 },
			imageProperty: {
				kind: "image",
				value: {
					kind: "remote",
					url: "https://image.tmdb.org/t/p/w500/oNF5oacaZFXMjGC8fWOTvmDCxLr.jpg",
				},
			},
			badgeProperty: { kind: "null", value: null },
		},
		{
			identifier: "tmdb-1438",
			titleProperty: { kind: "text", value: "The Wire" },
			subtitleProperty: { kind: "number", value: 2002 },
			imageProperty: {
				kind: "image",
				value: {
					kind: "remote",
					url: "https://image.tmdb.org/t/p/w500/4lkAHCDkH7KEELKBEMdFf7EGXcb.jpg",
				},
			},
			badgeProperty: { kind: "null", value: null },
		},
	],
	"s-tvdb-show": [
		{
			identifier: "tvdb-81189",
			titleProperty: { kind: "text", value: "Breaking Bad" },
			subtitleProperty: { kind: "number", value: 2008 },
			imageProperty: { kind: "image", value: null },
			badgeProperty: { kind: "null", value: null },
		},
		{
			identifier: "tvdb-371980",
			titleProperty: { kind: "text", value: "Severance" },
			subtitleProperty: { kind: "number", value: 2022 },
			imageProperty: { kind: "image", value: null },
			badgeProperty: { kind: "null", value: null },
		},
	],
	// Book providers
	"s-ol-book": [
		{
			identifier: "ol-W123",
			titleProperty: { kind: "text", value: "Project Hail Mary" },
			subtitleProperty: { kind: "number", value: 2021 },
			imageProperty: {
				kind: "image",
				value: {
					kind: "remote",
					url: "https://covers.openlibrary.org/b/id/10527831-L.jpg",
				},
			},
			badgeProperty: { kind: "null", value: null },
		},
		{
			identifier: "ol-W456",
			titleProperty: { kind: "text", value: "The Name of the Wind" },
			subtitleProperty: { kind: "number", value: 2007 },
			imageProperty: {
				kind: "image",
				value: {
					kind: "remote",
					url: "https://covers.openlibrary.org/b/id/9256378-L.jpg",
				},
			},
			badgeProperty: { kind: "null", value: null },
		},
		{
			identifier: "ol-W789",
			titleProperty: { kind: "text", value: "Atomic Habits" },
			subtitleProperty: { kind: "number", value: 2018 },
			imageProperty: {
				kind: "image",
				value: {
					kind: "remote",
					url: "https://m.media-amazon.com/images/I/513Y5o-DYtL.jpg",
				},
			},
			badgeProperty: { kind: "null", value: null },
		},
	],
	"s-hc-book": [
		{
			identifier: "hc-123",
			titleProperty: { kind: "text", value: "Project Hail Mary" },
			subtitleProperty: { kind: "number", value: 2021 },
			imageProperty: { kind: "image", value: null },
			badgeProperty: { kind: "null", value: null },
		},
		{
			identifier: "hc-456",
			titleProperty: {
				kind: "text",
				value: "Tomorrow, and Tomorrow, and Tomorrow",
			},
			subtitleProperty: { kind: "number", value: 2022 },
			imageProperty: { kind: "image", value: null },
			badgeProperty: { kind: "null", value: null },
		},
	],
	"s-gb-book": [
		{
			identifier: "gb-abc",
			titleProperty: { kind: "text", value: "Project Hail Mary" },
			subtitleProperty: { kind: "number", value: 2021 },
			imageProperty: { kind: "image", value: null },
			badgeProperty: { kind: "null", value: null },
		},
		{
			identifier: "gb-def",
			titleProperty: { kind: "text", value: "The Name of the Wind" },
			subtitleProperty: { kind: "number", value: 2007 },
			imageProperty: { kind: "image", value: null },
			badgeProperty: { kind: "null", value: null },
		},
	],
	// Anime providers
	"s-mal-anime": [
		{
			identifier: "mal-52991",
			titleProperty: { kind: "text", value: "Frieren: Beyond Journey's End" },
			subtitleProperty: { kind: "number", value: 2023 },
			imageProperty: {
				kind: "image",
				value: {
					kind: "remote",
					url: "https://cdn.myanimelist.net/images/anime/1015/138006.jpg",
				},
			},
			badgeProperty: { kind: "null", value: null },
		},
		{
			identifier: "mal-53446",
			titleProperty: { kind: "text", value: "Dungeon Meshi" },
			subtitleProperty: { kind: "number", value: 2024 },
			imageProperty: {
				kind: "image",
				value: {
					kind: "remote",
					url: "https://cdn.myanimelist.net/images/anime/1628/140081.jpg",
				},
			},
			badgeProperty: { kind: "null", value: null },
		},
		{
			identifier: "mal-52299",
			titleProperty: { kind: "text", value: "Solo Leveling" },
			subtitleProperty: { kind: "number", value: 2024 },
			imageProperty: {
				kind: "image",
				value: {
					kind: "remote",
					url: "https://cdn.myanimelist.net/images/anime/1258/135739.jpg",
				},
			},
			badgeProperty: { kind: "null", value: null },
		},
	],
	"s-al-anime": [
		{
			identifier: "al-154587",
			titleProperty: { kind: "text", value: "Frieren: Beyond Journey's End" },
			subtitleProperty: { kind: "number", value: 2023 },
			imageProperty: { kind: "image", value: null },
			badgeProperty: { kind: "null", value: null },
		},
		{
			identifier: "al-153518",
			titleProperty: { kind: "text", value: "Dungeon Meshi" },
			subtitleProperty: { kind: "number", value: 2024 },
			imageProperty: { kind: "image", value: null },
			badgeProperty: { kind: "null", value: null },
		},
	],
	// Manga providers
	"s-mal-manga": [
		{
			identifier: "mal-m2",
			titleProperty: { kind: "text", value: "Berserk" },
			subtitleProperty: { kind: "number", value: 1989 },
			imageProperty: {
				kind: "image",
				value: {
					kind: "remote",
					url: "https://cdn.myanimelist.net/images/manga/1/157897.jpg",
				},
			},
			badgeProperty: { kind: "null", value: null },
		},
		{
			identifier: "mal-m656",
			titleProperty: { kind: "text", value: "Vagabond" },
			subtitleProperty: { kind: "number", value: 1998 },
			imageProperty: {
				kind: "image",
				value: {
					kind: "remote",
					url: "https://cdn.myanimelist.net/images/manga/3/116498.jpg",
				},
			},
			badgeProperty: { kind: "null", value: null },
		},
	],
	"s-al-manga": [
		{
			identifier: "al-m2",
			titleProperty: { kind: "text", value: "Berserk" },
			subtitleProperty: { kind: "number", value: 1989 },
			imageProperty: { kind: "image", value: null },
			badgeProperty: { kind: "null", value: null },
		},
	],
	"s-md-manga": [
		{
			identifier: "md-m2",
			titleProperty: { kind: "text", value: "Berserk" },
			subtitleProperty: { kind: "number", value: 1989 },
			imageProperty: { kind: "image", value: null },
			badgeProperty: { kind: "null", value: null },
		},
		{
			identifier: "md-dandadan",
			titleProperty: { kind: "text", value: "Dandadan" },
			subtitleProperty: { kind: "number", value: 2021 },
			imageProperty: { kind: "image", value: null },
			badgeProperty: { kind: "null", value: null },
		},
	],
	// Video Game providers
	"s-igdb": [
		{
			identifier: "igdb-119133",
			titleProperty: { kind: "text", value: "Elden Ring" },
			subtitleProperty: { kind: "number", value: 2022 },
			imageProperty: {
				kind: "image",
				value: {
					kind: "remote",
					url: "https://images.igdb.com/igdb/image/upload/t_cover_big/co4jni.jpg",
				},
			},
			badgeProperty: { kind: "null", value: null },
		},
		{
			identifier: "igdb-25646",
			titleProperty: { kind: "text", value: "Hollow Knight" },
			subtitleProperty: { kind: "number", value: 2017 },
			imageProperty: {
				kind: "image",
				value: {
					kind: "remote",
					url: "https://images.igdb.com/igdb/image/upload/t_cover_big/co3p2d.jpg",
				},
			},
			badgeProperty: { kind: "null", value: null },
		},
		{
			identifier: "igdb-68240",
			titleProperty: { kind: "text", value: "Celeste" },
			subtitleProperty: { kind: "number", value: 2018 },
			imageProperty: {
				kind: "image",
				value: {
					kind: "remote",
					url: "https://images.igdb.com/igdb/image/upload/t_cover_big/co1tmu.jpg",
				},
			},
			badgeProperty: { kind: "null", value: null },
		},
	],
	"s-rawg": [
		{
			identifier: "rawg-326243",
			titleProperty: { kind: "text", value: "Elden Ring" },
			subtitleProperty: { kind: "number", value: 2022 },
			imageProperty: { kind: "image", value: null },
			badgeProperty: { kind: "null", value: null },
		},
		{
			identifier: "rawg-9767",
			titleProperty: { kind: "text", value: "Hollow Knight" },
			subtitleProperty: { kind: "number", value: 2017 },
			imageProperty: { kind: "image", value: null },
			badgeProperty: { kind: "null", value: null },
		},
	],
	// Music providers
	"s-mb": [
		{
			identifier: "mb-1",
			titleProperty: { kind: "text", value: "Kind of Blue" },
			subtitleProperty: { kind: "number", value: 1959 },
			imageProperty: { kind: "image", value: null },
			badgeProperty: { kind: "null", value: null },
		},
		{
			identifier: "mb-2",
			titleProperty: { kind: "text", value: "Random Access Memories" },
			subtitleProperty: { kind: "number", value: 2013 },
			imageProperty: { kind: "image", value: null },
			badgeProperty: { kind: "null", value: null },
		},
	],
	"s-lfm": [
		{
			identifier: "lfm-1",
			titleProperty: { kind: "text", value: "Kind of Blue — Miles Davis" },
			subtitleProperty: { kind: "number", value: 1959 },
			imageProperty: { kind: "image", value: null },
			badgeProperty: { kind: "null", value: null },
		},
	],
	// Podcast providers
	"s-pi": [
		{
			identifier: "pi-1",
			titleProperty: { kind: "text", value: "Lex Fridman Podcast" },
			subtitleProperty: { kind: "null", value: null },
			imageProperty: { kind: "image", value: null },
			badgeProperty: { kind: "null", value: null },
		},
		{
			identifier: "pi-2",
			titleProperty: { kind: "text", value: "Huberman Lab" },
			subtitleProperty: { kind: "null", value: null },
			imageProperty: { kind: "image", value: null },
			badgeProperty: { kind: "null", value: null },
		},
	],
	"s-ap": [
		{
			identifier: "ap-1",
			titleProperty: { kind: "text", value: "Lex Fridman Podcast" },
			subtitleProperty: { kind: "null", value: null },
			imageProperty: { kind: "image", value: null },
			badgeProperty: { kind: "null", value: null },
		},
	],
	// Audiobook providers
	"s-audible": [
		{
			identifier: "aud-1",
			titleProperty: { kind: "text", value: "Atomic Habits" },
			subtitleProperty: { kind: "number", value: 2018 },
			imageProperty: {
				kind: "image",
				value: {
					kind: "remote",
					url: "https://m.media-amazon.com/images/I/513Y5o-DYtL.jpg",
				},
			},
			badgeProperty: { kind: "null", value: null },
		},
		{
			identifier: "aud-2",
			titleProperty: { kind: "text", value: "The Pragmatic Programmer" },
			subtitleProperty: { kind: "number", value: 1999 },
			imageProperty: {
				kind: "image",
				value: {
					kind: "remote",
					url: "https://m.media-amazon.com/images/I/41BKx1AxQWL.jpg",
				},
			},
			badgeProperty: { kind: "null", value: null },
		},
	],
	"s-ol-audio": [
		{
			identifier: "ol-aud-1",
			titleProperty: { kind: "text", value: "Atomic Habits" },
			subtitleProperty: { kind: "number", value: 2018 },
			imageProperty: { kind: "image", value: null },
			badgeProperty: { kind: "null", value: null },
		},
	],
	// Comic providers
	"s-cv": [
		{
			identifier: "cv-1",
			titleProperty: { kind: "text", value: "Watchmen" },
			subtitleProperty: { kind: "number", value: 1986 },
			imageProperty: { kind: "image", value: null },
			badgeProperty: { kind: "null", value: null },
		},
		{
			identifier: "cv-2",
			titleProperty: { kind: "text", value: "The Sandman" },
			subtitleProperty: { kind: "number", value: 1989 },
			imageProperty: { kind: "image", value: null },
			badgeProperty: { kind: "null", value: null },
		},
	],
	"s-marvel": [
		{
			identifier: "marvel-1",
			titleProperty: { kind: "text", value: "The Amazing Spider-Man" },
			subtitleProperty: { kind: "number", value: 1963 },
			imageProperty: { kind: "image", value: null },
			badgeProperty: { kind: "null", value: null },
		},
	],
	// Visual Novel providers
	"s-vndb": [
		{
			identifier: "vndb-1",
			titleProperty: { kind: "text", value: "Steins;Gate" },
			subtitleProperty: { kind: "number", value: 2009 },
			imageProperty: { kind: "image", value: null },
			badgeProperty: { kind: "null", value: null },
		},
		{
			identifier: "vndb-2",
			titleProperty: { kind: "text", value: "Clannad" },
			subtitleProperty: { kind: "number", value: 2004 },
			imageProperty: { kind: "image", value: null },
			badgeProperty: { kind: "null", value: null },
		},
	],
};

// Mock collections for the "Add to Collection" action
const MOCK_COLLECTIONS = [
	"Watched in Theater",
	"Top 100",
	"Family Movies",
	"Rewatches",
	"Classics",
];

const LOG_DATE_OPTIONS = [
	{ value: "now", label: "Just now" },
	{ value: "unknown", label: "I don't remember" },
	{ value: "custom", label: "Pick a date" },
	{ value: "started", label: "Just started" },
] as const;

const RATE_DATE_OPTIONS = [
	{ value: "now", label: "Just now" },
	{ value: "unknown", label: "I don't remember" },
	{ value: "custom", label: "Pick a date" },
] as const;

type PanelType = "log" | "backlog" | "collection" | "rate";
type LogDateOption = "now" | "unknown" | "custom" | "started";
type RateDateOption = "now" | "unknown" | "custom";

interface ItemActionState {
	openPanel: PanelType | null;
	doneActions: PanelType[];
	logDate: LogDateOption;
	logCustomDate: string;
	selectedCollections: string[];
	newCollectionInput: string;
	rateStars: number;
	rateStarsHover: number;
	rateReview: string;
	rateDate: RateDateOption;
	rateCustomDate: string;
}

const DEFAULT_ITEM_STATE: ItemActionState = {
	openPanel: null,
	doneActions: [],
	logDate: "now",
	logCustomDate: "",
	selectedCollections: [],
	newCollectionInput: "",
	rateStars: 0,
	rateStarsHover: 0,
	rateReview: "",
	rateDate: "unknown",
	rateCustomDate: "",
};

// --- Components ---

function SectionHeader(props: {
	title: string;
	right?: React.ReactNode;
	textPrimary: string;
}) {
	return (
		<Group justify="space-between" mb="sm">
			<Text
				ff="var(--mantine-headings-font-family)"
				fw={700}
				fz="lg"
				c={props.textPrimary}
			>
				{props.title}
			</Text>
			{props.right}
		</Group>
	);
}

function ContinueCard(props: {
	item: InProgressItem;
	surface: string;
	surfaceHover: string;
	border: string;
	textPrimary: string;
	textMuted: string;
}) {
	const color = TYPE_COLORS[props.item.type];
	const Icon = TYPE_ICONS[props.item.type];
	const pct =
		props.item.total > 0
			? Math.round((props.item.current / props.item.total) * 100)
			: null;
	const progressLabel =
		props.item.total > 0
			? `${props.item.current} / ${props.item.total} ${props.item.unit}`
			: `${props.item.current} ${props.item.unit}`;

	return (
		<Paper
			radius="sm"
			style={{
				background: props.surface,
				border: `1px solid ${props.border}`,
				overflow: "hidden",
			}}
		>
			<Group gap={0} align="stretch" wrap="nowrap">
				<Box
					w={72}
					style={{
						flexShrink: 0,
						minHeight: 120,
						backgroundImage: `url(${props.item.coverUrl})`,
						backgroundSize: "cover",
						backgroundPosition: "center",
					}}
				/>
				<Stack gap={6} p="sm" style={{ flex: 1, minWidth: 0 }}>
					<Group gap={6} wrap="nowrap">
						<Icon size={12} color={color} />
						<Text
							fz={10}
							fw={600}
							c={color}
							ff="var(--mantine-headings-font-family)"
							tt="uppercase"
							style={{ letterSpacing: "0.6px" }}
						>
							{props.item.type}
						</Text>
						<Box style={{ flex: 1 }} />
						<Text fz={10} c={props.textMuted}>
							{props.item.lastActivity}
						</Text>
					</Group>

					<Text
						ff="var(--mantine-headings-font-family)"
						fw={600}
						fz="sm"
						c={props.textPrimary}
						lineClamp={1}
						lh={1.3}
					>
						{props.item.title}
					</Text>
					<Text fz="xs" c={props.textMuted} lineClamp={1}>
						{props.item.sub}
					</Text>

					<Box mt={2}>
						<Group gap={6} mb={4}>
							<Text
								fz={10}
								ff="var(--mantine-font-family-monospace)"
								c={props.textMuted}
							>
								{progressLabel}
							</Text>
							{pct !== null && (
								<Text
									fz={10}
									ff="var(--mantine-font-family-monospace)"
									fw={600}
									c={color}
								>
									{pct}%
								</Text>
							)}
						</Group>
						{pct !== null && (
							<Progress
								value={pct}
								size={4}
								radius="xl"
								color={color}
								bg={props.border}
							/>
						)}
					</Box>

					<Button
						size="compact-xs"
						variant="light"
						mt={4}
						leftSection={<Play size={10} />}
						style={{
							backgroundColor: `${color}18`,
							color,
							border: "none",
							alignSelf: "flex-start",
						}}
						onClick={() =>
							console.log(`[v6] ${props.item.actionLabel}:`, props.item.title)
						}
					>
						{props.item.actionLabel}
					</Button>
				</Stack>
			</Group>
		</Paper>
	);
}

function BacklogCard(props: {
	item: BacklogItem;
	surface: string;
	border: string;
	textPrimary: string;
	textMuted: string;
}) {
	const color = TYPE_COLORS[props.item.type];
	return (
		<UnstyledButton
			onClick={() => console.log("[v6] Start:", props.item.title)}
			style={{ flexShrink: 0 }}
		>
			<Paper
				w={140}
				radius="sm"
				style={{
					background: props.surface,
					border: `1px solid ${props.border}`,
					overflow: "hidden",
				}}
			>
				<Box
					h={180}
					style={{
						backgroundImage: `url(${props.item.coverUrl})`,
						backgroundSize: "cover",
						backgroundPosition: "center",
						position: "relative",
					}}
				>
					<Badge
						size="xs"
						variant="filled"
						style={{
							position: "absolute",
							top: 6,
							left: 6,
							backgroundColor: color,
							color: "white",
						}}
					>
						{props.item.type}
					</Badge>
				</Box>
				<Stack gap={2} p="xs">
					<Text
						ff="var(--mantine-headings-font-family)"
						fw={600}
						fz="xs"
						c={props.textPrimary}
						lineClamp={2}
						lh={1.3}
					>
						{props.item.title}
					</Text>
					<Text fz={10} c={props.textMuted} lineClamp={1}>
						{props.item.sub}
					</Text>
					<Text fz={10} c={props.textMuted}>
						Added {props.item.addedDate}
					</Text>
				</Stack>
			</Paper>
		</UnstyledButton>
	);
}

function RateCard(props: {
	item: UnratedItem;
	surface: string;
	border: string;
	textPrimary: string;
	textMuted: string;
}) {
	const [hovered, setHovered] = useState(0);
	const [selected, setSelected] = useState(0);
	const color = TYPE_COLORS[props.item.type];

	return (
		<Paper
			radius="sm"
			style={{
				background: props.surface,
				border: `1px solid ${props.border}`,
				overflow: "hidden",
			}}
		>
			<Group gap="sm" wrap="nowrap" p="sm">
				<Box
					w={48}
					h={64}
					style={{
						flexShrink: 0,
						borderRadius: 4,
						backgroundImage: `url(${props.item.coverUrl})`,
						backgroundSize: "cover",
						backgroundPosition: "center",
					}}
				/>
				<Stack gap={4} style={{ flex: 1, minWidth: 0 }}>
					<Group gap={6}>
						<Badge
							size="xs"
							variant="light"
							style={{ backgroundColor: `${color}18`, color }}
						>
							{props.item.type}
						</Badge>
						<Text fz={10} c={props.textMuted}>
							{props.item.completedDate}
						</Text>
					</Group>
					<Text
						ff="var(--mantine-headings-font-family)"
						fw={600}
						fz="sm"
						c={props.textPrimary}
						lineClamp={1}
					>
						{props.item.title}
					</Text>
					<Text fz="xs" c={props.textMuted}>
						{props.item.sub}
					</Text>
					<Group gap={2} mt={2}>
						{[1, 2, 3, 4, 5].map((star) => (
							<Tooltip key={star} label={`${star} star${star > 1 ? "s" : ""}`}>
								<ActionIcon
									size="xs"
									variant="transparent"
									onMouseEnter={() => setHovered(star)}
									onMouseLeave={() => setHovered(0)}
									onClick={() => {
										setSelected(star);
										console.log(
											`[v6] Rate "${props.item.title}": ${star} stars`,
										);
									}}
								>
									<Star
										size={14}
										color={GOLD}
										fill={star <= (hovered || selected) ? GOLD : "transparent"}
									/>
								</ActionIcon>
							</Tooltip>
						))}
						{selected > 0 && (
							<Text
								fz={10}
								fw={600}
								c={GOLD}
								ff="var(--mantine-font-family-monospace)"
								ml={4}
							>
								{selected}/5
							</Text>
						)}
					</Group>
				</Stack>
			</Group>
		</Paper>
	);
}

function WeekStrip(props: {
	days: WeekDay[];
	surface: string;
	border: string;
	textPrimary: string;
	textMuted: string;
}) {
	const maxCount = Math.max(...props.days.map((d) => d.count), 1);
	return (
		<Paper
			p="md"
			radius="sm"
			style={{
				background: props.surface,
				border: `1px solid ${props.border}`,
			}}
		>
			<Group justify="space-between" mb="sm">
				<Text
					ff="var(--mantine-headings-font-family)"
					fw={600}
					fz="sm"
					c={props.textPrimary}
				>
					This Week
				</Text>
				<Text fz="xs" c={props.textMuted}>
					{LIBRARY_STATS.thisWeekCompleted} completed &middot;{" "}
					{LIBRARY_STATS.thisWeekHours}h tracked
				</Text>
			</Group>
			<Group gap="xs" justify="space-between">
				{props.days.map((day) => {
					const h = day.count > 0 ? 8 + (day.count / maxCount) * 24 : 4;
					return (
						<Stack key={day.day} gap={4} align="center" style={{ flex: 1 }}>
							<Tooltip
								label={`${day.count} event${day.count !== 1 ? "s" : ""}`}
							>
								<Box
									w="100%"
									h={h}
									style={{
										borderRadius: 2,
										backgroundColor: day.count > 0 ? GOLD : `${props.border}`,
										opacity:
											day.count > 0 ? 0.4 + (day.count / maxCount) * 0.6 : 1,
										transition: "height 0.2s ease",
									}}
								/>
							</Tooltip>
							<Text fz={10} c={props.textMuted} ta="center">
								{day.day}
							</Text>
						</Stack>
					);
				})}
			</Group>
		</Paper>
	);
}

function EventRow(props: {
	event: ActivityEvent;
	isLast: boolean;
	border: string;
	textPrimary: string;
	textMuted: string;
}) {
	const color = TYPE_COLORS[props.event.type];
	return (
		<Group
			gap="sm"
			wrap="nowrap"
			align="flex-start"
			py={8}
			style={{
				borderBottom: props.isLast ? "none" : `1px solid ${props.border}`,
			}}
		>
			<Box
				w={32}
				h={42}
				style={{
					flexShrink: 0,
					borderRadius: 4,
					backgroundImage: `url(${props.event.coverUrl})`,
					backgroundSize: "cover",
					backgroundPosition: "center",
				}}
			/>
			<Stack gap={2} style={{ flex: 1, minWidth: 0 }}>
				<Text
					ff="var(--mantine-headings-font-family)"
					fw={600}
					fz="xs"
					c={props.textPrimary}
					lineClamp={1}
				>
					{props.event.title}
				</Text>
				<Group gap={4}>
					<Text fz={10} fw={500} c={color}>
						{props.event.action}
					</Text>
					<Text fz={10} c={props.textMuted}>
						&middot; {props.event.sub}
					</Text>
					{props.event.rating !== null && (
						<Text fz={10} ff="var(--mantine-font-family-monospace)" c={GOLD}>
							{"★".repeat(props.event.rating)}
						</Text>
					)}
				</Group>
			</Stack>
			<Text
				fz={10}
				c={props.textMuted}
				style={{ whiteSpace: "nowrap", flexShrink: 0 }}
			>
				{props.event.time}
			</Text>
		</Group>
	);
}

function TypeBar(props: {
	types: { type: MediaType; count: number }[];
	total: number;
	border: string;
	textMuted: string;
}) {
	return (
		<Stack gap={6}>
			<Box
				h={8}
				style={{
					borderRadius: 4,
					overflow: "hidden",
					display: "flex",
				}}
			>
				{props.types.map((t) => {
					const pct = (t.count / props.total) * 100;
					return (
						<Tooltip key={t.type} label={`${t.type}: ${t.count}`}>
							<Box
								h="100%"
								style={{
									width: `${pct}%`,
									backgroundColor: TYPE_COLORS[t.type],
									minWidth: 3,
								}}
							/>
						</Tooltip>
					);
				})}
			</Box>
			<Group gap="sm" wrap="wrap">
				{props.types.slice(0, 6).map((t) => (
					<Group key={t.type} gap={4}>
						<Box
							w={8}
							h={8}
							style={{
								borderRadius: 2,
								backgroundColor: TYPE_COLORS[t.type],
							}}
						/>
						<Text fz={10} c={props.textMuted}>
							{t.type} ({t.count})
						</Text>
					</Group>
				))}
				{props.types.length > 6 && (
					<Text fz={10} c={props.textMuted}>
						+{props.types.length - 6} more
					</Text>
				)}
			</Group>
		</Stack>
	);
}

function StatChip(props: {
	label: string;
	value: string | number;
	color?: string;
	surface: string;
	border: string;
	textPrimary: string;
	textMuted: string;
}) {
	return (
		<Paper
			px="md"
			py="xs"
			radius="sm"
			style={{
				background: props.surface,
				border: `1px solid ${props.border}`,
			}}
		>
			<Text
				ff="var(--mantine-font-family-monospace)"
				fw={700}
				fz="lg"
				c={props.color ?? props.textPrimary}
				lh={1.2}
			>
				{props.value}
			</Text>
			<Text fz={10} c={props.textMuted} fw={500}>
				{props.label}
			</Text>
		</Paper>
	);
}

// --- Add Media Modal ---

type AddModalStep = "type-picker" | "search";

function AddMediaModal(props: { opened: boolean; onClose: () => void }) {
	const t = useThemeTokens();
	const [step, setStep] = useState<AddModalStep>("type-picker");
	const [selectedSchema, setSelectedSchema] = useState<MockEntitySchema | null>(
		null,
	);
	const [selectedProviderIndex, setSelectedProviderIndex] = useState(0);
	const [query, setQuery] = useState("");
	const [results, setResults] = useState<MockSearchResult[] | null>(null);
	const [isSearching, setIsSearching] = useState(false);
	const [itemStates, setItemStates] = useState<Record<string, ItemActionState>>(
		{},
	);

	const getItem = (id: string): ItemActionState =>
		itemStates[id] ?? DEFAULT_ITEM_STATE;

	const patchItem = (id: string, patch: Partial<ItemActionState>) => {
		setItemStates((prev) => ({
			...prev,
			[id]: { ...(prev[id] ?? DEFAULT_ITEM_STATE), ...patch },
		}));
	};

	const reset = () => {
		setStep("type-picker");
		setSelectedSchema(null);
		setSelectedProviderIndex(0);
		setQuery("");
		setResults(null);
		setIsSearching(false);
		setItemStates({});
	};

	const handleClose = () => {
		reset();
		props.onClose();
	};

	const handleTypeSelect = (schema: MockEntitySchema) => {
		setSelectedSchema(schema);
		setSelectedProviderIndex(0);
		setStep("search");
		setQuery("");
		setResults(null);
		setItemStates({});
	};

	const handleBack = () => {
		setStep("type-picker");
		setSelectedSchema(null);
		setSelectedProviderIndex(0);
		setQuery("");
		setResults(null);
		setItemStates({});
	};

	const activeProvider =
		selectedSchema?.searchProviders[selectedProviderIndex] ?? null;

	const handleSearch = () => {
		if (!selectedSchema || !activeProvider || !query.trim()) {
			return;
		}
		setIsSearching(true);
		setResults(null);
		// Simulate async search — keyed by provider's searchScriptId
		setTimeout(() => {
			const all = MOCK_SEARCH_RESULTS[activeProvider.searchScriptId] ?? [];
			const q = query.toLowerCase();
			const filtered = all.filter((r) =>
				r.titleProperty.value.toLowerCase().includes(q),
			);
			// If query doesn't match, still show all results (simulating API)
			setResults(filtered.length > 0 ? filtered : all);
			setIsSearching(false);
		}, 400);
	};

	const handleProviderChange = (value: string) => {
		setSelectedProviderIndex(Number(value));
		setResults(null);
		setItemStates({});
	};

	const togglePanel = (id: string, panel: PanelType) => {
		const current = getItem(id);
		patchItem(id, { openPanel: current.openPanel === panel ? null : panel });
	};

	const handleBacklog = (id: string, title: string) => {
		const current = getItem(id);
		patchItem(id, {
			openPanel: null,
			doneActions: [
				...new Set([...current.doneActions, "backlog" as PanelType]),
			],
		});
		console.log("[v6] Add to backlog:", {
			identifier: id,
			title,
			entitySchemaId: selectedSchema?.id,
			provider: activeProvider?.name,
			detailsScriptId: activeProvider?.detailsScriptId,
		});
	};

	const handleLogSave = (id: string, title: string) => {
		const s = getItem(id);
		patchItem(id, {
			openPanel: null,
			doneActions: [...new Set([...s.doneActions, "log" as PanelType])],
		});
		console.log("[v6] Log:", {
			identifier: id,
			title,
			date: s.logDate,
			customDate: s.logDate === "custom" ? s.logCustomDate : undefined,
			entitySchemaId: selectedSchema?.id,
			provider: activeProvider?.name,
			detailsScriptId: activeProvider?.detailsScriptId,
		});
	};

	const handleCollectionSave = (id: string, title: string) => {
		const s = getItem(id);
		const collections = [
			...s.selectedCollections,
			...(s.newCollectionInput.trim() ? [s.newCollectionInput.trim()] : []),
		];
		patchItem(id, {
			openPanel: null,
			doneActions: [...new Set([...s.doneActions, "collection" as PanelType])],
		});
		console.log("[v6] Add to collections:", {
			identifier: id,
			title,
			collections,
			entitySchemaId: selectedSchema?.id,
		});
	};

	const handleRateSave = (id: string, title: string) => {
		const s = getItem(id);
		patchItem(id, {
			openPanel: null,
			doneActions: [...new Set([...s.doneActions, "rate" as PanelType])],
		});
		console.log("[v6] Rate & review:", {
			identifier: id,
			title,
			stars: s.rateStars,
			review: s.rateReview || null,
			date: s.rateDate,
			customDate: s.rateDate === "custom" ? s.rateCustomDate : undefined,
			entitySchemaId: selectedSchema?.id,
			provider: activeProvider?.name,
			detailsScriptId: activeProvider?.detailsScriptId,
		});
	};

	const ICON_MAP: Record<string, typeof BookOpen> = {
		BookOpen,
		Tv,
		Monitor,
		Gamepad2,
		Headphones,
	};

	return (
		<Modal
			centered
			size="lg"
			opened={props.opened}
			onClose={handleClose}
			title={
				step === "type-picker" ? (
					<Text ff="var(--mantine-headings-font-family)" fw={600} fz="md">
						Add to Media
					</Text>
				) : (
					<Group gap="xs">
						<ActionIcon
							variant="subtle"
							size="sm"
							onClick={handleBack}
							aria-label="Back to type picker"
						>
							<ChevronLeft size={16} />
						</ActionIcon>
						<Text ff="var(--mantine-headings-font-family)" fw={600} fz="md">
							Add {selectedSchema?.name}
						</Text>
					</Group>
				)
			}
			overlayProps={{ backgroundOpacity: 0.55, blur: 3 }}
		>
			{step === "type-picker" && (
				<Stack gap="md">
					<Text fz="sm" c={t.textMuted}>
						What type of media are you adding?
					</Text>
					<SimpleGrid cols={{ base: 3, sm: 4 }} spacing="sm">
						{MOCK_ENTITY_SCHEMAS.map((schema) => {
							const Icon = ICON_MAP[schema.icon] ?? BookOpen;
							return (
								<UnstyledButton
									key={schema.id}
									onClick={() => handleTypeSelect(schema)}
								>
									<Paper
										p="md"
										radius="sm"
										ta="center"
										style={{
											border: `1px solid ${t.border}`,
											background: t.surface,
											cursor: "pointer",
											transition: "border-color 0.15s ease",
										}}
									>
										<Stack gap={6} align="center">
											<Icon size={24} color={schema.accentColor} />
											<Text
												ff="var(--mantine-headings-font-family)"
												fw={600}
												fz="xs"
												c={t.textPrimary}
											>
												{schema.name}
											</Text>
											<Text fz={10} c={t.textMuted}>
												{schema.searchProviders.length === 1
													? schema.searchProviders[0]?.name
													: `${schema.searchProviders.length} sources`}
											</Text>
										</Stack>
									</Paper>
								</UnstyledButton>
							);
						})}
					</SimpleGrid>
				</Stack>
			)}

			{step === "search" && selectedSchema && (
				<Stack gap="md">
					{selectedSchema.searchProviders.length > 1 && (
						<SegmentedControl
							fullWidth
							value={String(selectedProviderIndex)}
							onChange={handleProviderChange}
							data={selectedSchema.searchProviders.map((p, i) => ({
								value: String(i),
								label: p.name,
							}))}
						/>
					)}
					<Group>
						<TextInput
							flex={1}
							value={query}
							disabled={isSearching}
							placeholder={`Search for a ${selectedSchema.name.toLowerCase()}...`}
							leftSection={<Search size={16} strokeWidth={1.5} />}
							onChange={(e) => setQuery(e.currentTarget.value)}
							onKeyDown={(e) => {
								if (e.key === "Enter") {
									handleSearch();
								}
							}}
						/>
						<Button
							onClick={handleSearch}
							loading={isSearching}
							disabled={!query.trim()}
							style={{
								backgroundColor: selectedSchema.accentColor,
								color: "white",
							}}
						>
							Search
						</Button>
					</Group>

					{isSearching && (
						<Stack align="center" py="xl">
							<Loader size="sm" color={selectedSchema.accentColor} />
							<Text fz="sm" c={t.textMuted}>
								Searching...
							</Text>
						</Stack>
					)}

					{results !== null && !isSearching && (
						<Stack gap="xs">
							{results.length === 0 ? (
								<Text c={t.textMuted} fz="sm" ta="center" py="md">
									No results found
								</Text>
							) : (
								<ScrollArea.Autosize mah={400}>
									<Stack gap={4}>
										{results.map((item) => {
											const istate = getItem(item.identifier);
											const accentColor = selectedSchema.accentColor;
											const imageUrl =
												item.imageProperty.kind === "image"
													? (item.imageProperty.value?.url ?? undefined)
													: undefined;
											const actionDone = (panel: PanelType) =>
												istate.doneActions.includes(panel);

											return (
												<Paper
													p="sm"
													withBorder
													radius="sm"
													key={item.identifier}
												>
													{/* Main row: cover + title + 4 action buttons */}
													<Group
														justify="space-between"
														align="center"
														wrap="nowrap"
													>
														<Group
															gap="md"
															wrap="nowrap"
															style={{ flex: 1, minWidth: 0 }}
														>
															{imageUrl ? (
																<Box
																	w={48}
																	h={68}
																	style={{
																		flexShrink: 0,
																		backgroundSize: "cover",
																		backgroundPosition: "center",
																		borderRadius: "var(--mantine-radius-sm)",
																		backgroundImage: `url(${imageUrl})`,
																	}}
																/>
															) : (
																<Box
																	w={48}
																	h={68}
																	bg={t.surfaceHover}
																	style={{
																		flexShrink: 0,
																		display: "grid",
																		placeItems: "center",
																		borderRadius: "var(--mantine-radius-sm)",
																	}}
																>
																	<ImageIcon
																		size={16}
																		color={t.textMuted}
																		strokeWidth={1.5}
																	/>
																</Box>
															)}
															<Stack gap={2} style={{ flex: 1, minWidth: 0 }}>
																<Text fw={500} fz="sm" lineClamp={1}>
																	{item.titleProperty.value}
																</Text>
																{item.subtitleProperty.kind === "number" && (
																	<Text fz="xs" c={t.textMuted}>
																		{item.subtitleProperty.value}
																	</Text>
																)}
															</Stack>
														</Group>
														{/* Four independent action buttons */}
														<Group gap={2} style={{ flexShrink: 0 }}>
															<Tooltip label="Log" withArrow position="top">
																<ActionIcon
																	size="sm"
																	aria-label="Log"
																	variant={
																		actionDone("log") ? "filled" : "subtle"
																	}
																	color={
																		actionDone("log") ? "green" : undefined
																	}
																	style={
																		istate.openPanel === "log" &&
																		!actionDone("log")
																			? {
																					backgroundColor: `${accentColor}20`,
																					color: accentColor,
																				}
																			: {}
																	}
																	onClick={() =>
																		togglePanel(item.identifier, "log")
																	}
																>
																	<History size={14} strokeWidth={1.5} />
																</ActionIcon>
															</Tooltip>
															<Tooltip label="Backlog" withArrow position="top">
																<ActionIcon
																	size="sm"
																	aria-label="Add to Backlog"
																	variant={
																		actionDone("backlog") ? "filled" : "subtle"
																	}
																	color={
																		actionDone("backlog") ? "blue" : undefined
																	}
																	onClick={() =>
																		handleBacklog(
																			item.identifier,
																			item.titleProperty.value,
																		)
																	}
																>
																	<Bookmark size={14} strokeWidth={1.5} />
																</ActionIcon>
															</Tooltip>
															<Tooltip
																label="Collection"
																withArrow
																position="top"
															>
																<ActionIcon
																	size="sm"
																	aria-label="Add to Collection"
																	variant={
																		actionDone("collection")
																			? "filled"
																			: "subtle"
																	}
																	color={
																		actionDone("collection")
																			? "orange"
																			: undefined
																	}
																	style={
																		istate.openPanel === "collection" &&
																		!actionDone("collection")
																			? {
																					backgroundColor: `${accentColor}20`,
																					color: accentColor,
																				}
																			: {}
																	}
																	onClick={() =>
																		togglePanel(item.identifier, "collection")
																	}
																>
																	<FolderPlus size={14} strokeWidth={1.5} />
																</ActionIcon>
															</Tooltip>
															<Tooltip
																label="Rate & Review"
																withArrow
																position="top"
															>
																<ActionIcon
																	size="sm"
																	aria-label="Rate & Review"
																	variant={
																		actionDone("rate") ? "filled" : "subtle"
																	}
																	color={
																		actionDone("rate") ? "yellow" : undefined
																	}
																	style={
																		istate.openPanel === "rate" &&
																		!actionDone("rate")
																			? {
																					backgroundColor: `${accentColor}20`,
																					color: accentColor,
																				}
																			: {}
																	}
																	onClick={() =>
																		togglePanel(item.identifier, "rate")
																	}
																>
																	<Star size={14} strokeWidth={1.5} />
																</ActionIcon>
															</Tooltip>
														</Group>
													</Group>

													{/* Completed action badges */}
													{istate.doneActions.length > 0 &&
														istate.openPanel === null && (
															<Group gap={4} mt={8}>
																{istate.doneActions.map((action) => (
																	<Badge
																		key={action}
																		size="xs"
																		variant="light"
																		style={{
																			backgroundColor: `${accentColor}15`,
																			color: accentColor,
																		}}
																	>
																		{action === "log"
																			? istate.logDate === "started"
																				? "Started"
																				: "Logged"
																			: action === "backlog"
																				? "In Backlog"
																				: action === "collection"
																					? "In Collection"
																					: `Rated ${istate.rateStars}★`}
																	</Badge>
																))}
															</Group>
														)}

													{/* Log panel */}
													{istate.openPanel === "log" && (
														<Box
															mt="sm"
															pt="sm"
															style={{
																borderTop: `1px solid ${t.border}`,
															}}
														>
															<Text fz="xs" fw={500} c={t.textMuted} mb={6}>
																When?
															</Text>
															<Group gap={4} mb="sm" wrap="wrap">
																{LOG_DATE_OPTIONS.map((opt) => (
																	<Button
																		key={opt.value}
																		size="compact-xs"
																		variant={
																			istate.logDate === opt.value
																				? "filled"
																				: "subtle"
																		}
																		style={
																			istate.logDate === opt.value
																				? {
																						backgroundColor: accentColor,
																						color: "white",
																					}
																				: {}
																		}
																		onClick={() =>
																			patchItem(item.identifier, {
																				logDate: opt.value,
																			})
																		}
																	>
																		{opt.label}
																	</Button>
																))}
															</Group>
															{istate.logDate === "custom" && (
																<TextInput
																	type="date"
																	size="xs"
																	mb="sm"
																	value={istate.logCustomDate}
																	onChange={(e) =>
																		patchItem(item.identifier, {
																			logCustomDate: e.currentTarget.value,
																		})
																	}
																/>
															)}

															<Group gap="xs">
																<Button
																	size="compact-xs"
																	style={{
																		backgroundColor: accentColor,
																		color: "white",
																	}}
																	onClick={() =>
																		handleLogSave(
																			item.identifier,
																			item.titleProperty.value,
																		)
																	}
																>
																	Save
																</Button>
																<Button
																	size="compact-xs"
																	variant="subtle"
																	onClick={() =>
																		patchItem(item.identifier, {
																			openPanel: null,
																		})
																	}
																>
																	Cancel
																</Button>
															</Group>
														</Box>
													)}

													{/* Collection panel */}
													{istate.openPanel === "collection" && (
														<Box
															mt="sm"
															pt="sm"
															style={{
																borderTop: `1px solid ${t.border}`,
															}}
														>
															<Text fz="xs" fw={500} c={t.textMuted} mb={8}>
																Add to collection
															</Text>
															<Group gap={4} mb="sm" wrap="wrap">
																{MOCK_COLLECTIONS.map((col) => {
																	const isSelected =
																		istate.selectedCollections.includes(col);
																	return (
																		<Button
																			key={col}
																			size="compact-xs"
																			variant={isSelected ? "filled" : "light"}
																			style={
																				isSelected
																					? {
																							backgroundColor: accentColor,
																							color: "white",
																						}
																					: {
																							backgroundColor: `${accentColor}12`,
																							color: accentColor,
																							border: "none",
																						}
																			}
																			onClick={() =>
																				patchItem(item.identifier, {
																					selectedCollections: isSelected
																						? istate.selectedCollections.filter(
																								(c) => c !== col,
																							)
																						: [
																								...istate.selectedCollections,
																								col,
																							],
																				})
																			}
																		>
																			{col}
																		</Button>
																	);
																})}
															</Group>
															<TextInput
																size="xs"
																mb="sm"
																placeholder="New collection name..."
																value={istate.newCollectionInput}
																leftSection={<Plus size={12} />}
																onChange={(e) =>
																	patchItem(item.identifier, {
																		newCollectionInput: e.currentTarget.value,
																	})
																}
															/>
															<Group gap="xs">
																<Button
																	size="compact-xs"
																	disabled={
																		istate.selectedCollections.length === 0 &&
																		!istate.newCollectionInput.trim()
																	}
																	style={{
																		backgroundColor: accentColor,
																		color: "white",
																	}}
																	onClick={() =>
																		handleCollectionSave(
																			item.identifier,
																			item.titleProperty.value,
																		)
																	}
																>
																	Save
																</Button>
																<Button
																	size="compact-xs"
																	variant="subtle"
																	onClick={() =>
																		patchItem(item.identifier, {
																			openPanel: null,
																		})
																	}
																>
																	Cancel
																</Button>
															</Group>
														</Box>
													)}

													{/* Rate & Review panel */}
													{istate.openPanel === "rate" && (
														<Box
															mt="sm"
															pt="sm"
															style={{
																borderTop: `1px solid ${t.border}`,
															}}
														>
															<Box mb="sm">
																<Text fz="xs" fw={500} c={t.textMuted} mb={6}>
																	Rating
																</Text>
																<Group gap={2}>
																	{[1, 2, 3, 4, 5].map((star) => (
																		<ActionIcon
																			key={star}
																			size="sm"
																			variant="transparent"
																			onMouseEnter={() =>
																				patchItem(item.identifier, {
																					rateStarsHover: star,
																				})
																			}
																			onMouseLeave={() =>
																				patchItem(item.identifier, {
																					rateStarsHover: 0,
																				})
																			}
																			onClick={() =>
																				patchItem(item.identifier, {
																					rateStars:
																						istate.rateStars === star
																							? 0
																							: star,
																				})
																			}
																		>
																			<Star
																				size={20}
																				color={GOLD}
																				fill={
																					star <=
																					(istate.rateStarsHover ||
																						istate.rateStars)
																						? GOLD
																						: "transparent"
																				}
																			/>
																		</ActionIcon>
																	))}
																	{istate.rateStars > 0 && (
																		<Text
																			fz="sm"
																			fw={600}
																			c={GOLD}
																			ff="var(--mantine-font-family-monospace)"
																			ml={4}
																		>
																			{istate.rateStars}/5
																		</Text>
																	)}
																</Group>
															</Box>
															<Textarea
																size="xs"
																mb="sm"
																autosize
																minRows={2}
																maxRows={4}
																placeholder="Write a review (optional)..."
																value={istate.rateReview}
																onChange={(e) =>
																	patchItem(item.identifier, {
																		rateReview: e.currentTarget.value,
																	})
																}
															/>
															<Text fz="xs" fw={500} c={t.textMuted} mb={6}>
																When?
															</Text>
															<Group gap={4} mb="sm" wrap="wrap">
																{RATE_DATE_OPTIONS.map((opt) => (
																	<Button
																		key={opt.value}
																		size="compact-xs"
																		variant={
																			istate.rateDate === opt.value
																				? "filled"
																				: "subtle"
																		}
																		style={
																			istate.rateDate === opt.value
																				? {
																						backgroundColor: accentColor,
																						color: "white",
																					}
																				: {}
																		}
																		onClick={() =>
																			patchItem(item.identifier, {
																				rateDate: opt.value,
																			})
																		}
																	>
																		{opt.label}
																	</Button>
																))}
															</Group>
															{istate.rateDate === "custom" && (
																<TextInput
																	type="date"
																	size="xs"
																	mb="sm"
																	value={istate.rateCustomDate}
																	onChange={(e) =>
																		patchItem(item.identifier, {
																			rateCustomDate: e.currentTarget.value,
																		})
																	}
																/>
															)}
															<Group gap="xs">
																<Button
																	size="compact-xs"
																	disabled={!istate.rateStars}
																	style={{
																		backgroundColor: accentColor,
																		color: "white",
																	}}
																	onClick={() =>
																		handleRateSave(
																			item.identifier,
																			item.titleProperty.value,
																		)
																	}
																>
																	Save
																</Button>
																<Button
																	size="compact-xs"
																	variant="subtle"
																	onClick={() =>
																		patchItem(item.identifier, {
																			openPanel: null,
																		})
																	}
																>
																	Cancel
																</Button>
															</Group>
														</Box>
													)}
												</Paper>
											);
										})}
									</Stack>
								</ScrollArea.Autosize>
							)}
						</Stack>
					)}
				</Stack>
			)}
		</Modal>
	);
}

// --- Main ---

function RouteComponent() {
	const t = useThemeTokens();
	const [addModalOpened, addModalHandlers] = useDisclosure(false);
	const bgPage = t.isDark
		? "var(--mantine-color-dark-8)"
		: "var(--mantine-color-stone-0)";

	const dateGroups = RECENT_EVENTS.reduce<Record<string, ActivityEvent[]>>(
		(acc, event) => {
			if (!acc[event.date]) {
				acc[event.date] = [];
			}
			acc[event.date]?.push(event);
			return acc;
		},
		{},
	);

	return (
		<Box bg={bgPage} mih="100vh">
			<Container size="lg" py="xl">
				<Stack gap="xl">
					{/* Header — minimal, the content speaks for itself */}
					<Group justify="space-between" align="center">
						<Text
							ff="var(--mantine-headings-font-family)"
							fw={700}
							fz={24}
							c={t.textPrimary}
						>
							Media
						</Text>
						<Button
							size="compact-sm"
							leftSection={<Plus size={14} />}
							style={{ backgroundColor: GOLD, color: "white" }}
							onClick={addModalHandlers.open}
						>
							Add
						</Button>
					</Group>

					{/* Section 1: Continue — the most useful section */}
					<Box>
						<SectionHeader
							title="Continue"
							textPrimary={t.textPrimary}
							right={
								<Group gap={4}>
									<Clock size={12} color={t.textMuted} />
									<Text fz="xs" c={t.textMuted}>
										{IN_PROGRESS.length} in progress
									</Text>
								</Group>
							}
						/>
						<SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="sm">
							{IN_PROGRESS.slice(0, 6).map((item) => (
								<ContinueCard
									key={item.id}
									item={item}
									surface={t.surface}
									surfaceHover={t.surfaceHover}
									border={t.border}
									textPrimary={t.textPrimary}
									textMuted={t.textMuted}
								/>
							))}
						</SimpleGrid>
						{IN_PROGRESS.length > 6 && (
							<UnstyledButton
								mt="sm"
								onClick={() => console.log("[v6] View all in-progress")}
							>
								<Group gap={4}>
									<Text fz="xs" fw={500} c={GOLD}>
										View all {IN_PROGRESS.length} in progress
									</Text>
									<ChevronRight size={12} color={GOLD} />
								</Group>
							</UnstyledButton>
						)}
					</Box>

					{/* Section 2: Up Next — your backlog */}
					<Box>
						<SectionHeader
							title="Up Next"
							textPrimary={t.textPrimary}
							right={
								<Text fz="xs" c={t.textMuted}>
									{BACKLOG.length} queued
								</Text>
							}
						/>
						<ScrollArea scrollbarSize={4} type="hover">
							<Group gap="sm" wrap="nowrap" pb={4}>
								{BACKLOG.map((item) => (
									<BacklogCard
										key={item.id}
										item={item}
										surface={t.surface}
										border={t.border}
										textPrimary={t.textPrimary}
										textMuted={t.textMuted}
									/>
								))}
							</Group>
						</ScrollArea>
					</Box>

					{/* Section 3: Rate These — only if there are unrated completions */}
					{UNRATED.length > 0 && (
						<Box>
							<SectionHeader
								title="Rate These"
								textPrimary={t.textPrimary}
								right={
									<Text fz="xs" c={t.textMuted}>
										{UNRATED.length} unrated
									</Text>
								}
							/>
							<SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="sm">
								{UNRATED.map((item) => (
									<RateCard
										key={item.id}
										item={item}
										surface={t.surface}
										border={t.border}
										textPrimary={t.textPrimary}
										textMuted={t.textMuted}
									/>
								))}
							</SimpleGrid>
						</Box>
					)}

					{/* Section 4: This Week + Recent Activity */}
					<Box>
						<SectionHeader
							title="Activity"
							textPrimary={t.textPrimary}
							right={
								<UnstyledButton
									onClick={() => console.log("[v6] View full activity log")}
								>
									<Group gap={4}>
										<Text fz="xs" fw={500} c={GOLD}>
											View all
										</Text>
										<ChevronRight size={12} color={GOLD} />
									</Group>
								</UnstyledButton>
							}
						/>
						<Stack gap="sm">
							<WeekStrip
								days={WEEK_ACTIVITY}
								surface={t.surface}
								border={t.border}
								textPrimary={t.textPrimary}
								textMuted={t.textMuted}
							/>
							{Object.entries(dateGroups).map(([date, events]) => (
								<Box key={date}>
									<Text
										fz={10}
										fw={700}
										c={t.textMuted}
										mb={6}
										ff="var(--mantine-headings-font-family)"
										tt="uppercase"
										style={{ letterSpacing: "1px" }}
									>
										{date}
									</Text>
									<Paper
										px="sm"
										radius="sm"
										style={{
											background: t.surface,
											border: `1px solid ${t.border}`,
										}}
									>
										{events.map((event, i) => (
											<EventRow
												key={event.id}
												event={event}
												isLast={i === events.length - 1}
												border={t.border}
												textPrimary={t.textPrimary}
												textMuted={t.textMuted}
											/>
										))}
									</Paper>
								</Box>
							))}
						</Stack>
					</Box>

					{/* Section 5: Library at a Glance — compact, de-emphasized */}
					<Box>
						<SectionHeader
							title="Library"
							textPrimary={t.textPrimary}
							right={
								<Text fz="xs" c={t.textMuted}>
									{LIBRARY_STATS.total} total entries
								</Text>
							}
						/>
						<Stack gap="sm">
							<SimpleGrid cols={{ base: 2, xs: 3, sm: 5 }} spacing="sm">
								<StatChip
									label="Total"
									value={LIBRARY_STATS.total}
									surface={t.surface}
									border={t.border}
									textPrimary={t.textPrimary}
									textMuted={t.textMuted}
								/>
								<StatChip
									label="Active"
									value={LIBRARY_STATS.active}
									color="#5B7FFF"
									surface={t.surface}
									border={t.border}
									textPrimary={t.textPrimary}
									textMuted={t.textMuted}
								/>
								<StatChip
									label="Completed"
									value={LIBRARY_STATS.completed}
									color="#5B8A5F"
									surface={t.surface}
									border={t.border}
									textPrimary={t.textPrimary}
									textMuted={t.textMuted}
								/>
								<StatChip
									label="Avg Rating"
									value={LIBRARY_STATS.avgRating.toFixed(1)}
									color={GOLD}
									surface={t.surface}
									border={t.border}
									textPrimary={t.textPrimary}
									textMuted={t.textMuted}
								/>
								<StatChip
									label="On Hold"
									value={LIBRARY_STATS.onHold}
									color="#E09840"
									surface={t.surface}
									border={t.border}
									textPrimary={t.textPrimary}
									textMuted={t.textMuted}
								/>
							</SimpleGrid>
							<Paper
								p="md"
								radius="sm"
								style={{
									background: t.surface,
									border: `1px solid ${t.border}`,
								}}
							>
								<Text
									fz="xs"
									fw={600}
									c={t.textMuted}
									mb="xs"
									ff="var(--mantine-headings-font-family)"
								>
									By Type
								</Text>
								<TypeBar
									types={TYPE_COUNTS}
									total={LIBRARY_STATS.total}
									border={t.border}
									textMuted={t.textMuted}
								/>
							</Paper>
						</Stack>
					</Box>
				</Stack>
			</Container>
			<AddMediaModal opened={addModalOpened} onClose={addModalHandlers.close} />
		</Box>
	);
}
