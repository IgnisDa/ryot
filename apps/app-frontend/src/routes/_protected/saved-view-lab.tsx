import {
	ActionIcon,
	Badge,
	Box,
	Button,
	Card,
	Container,
	Divider,
	Drawer,
	Group,
	Menu,
	Pagination,
	Paper,
	SegmentedControl,
	Select,
	SimpleGrid,
	Stack,
	Table,
	Text,
	TextInput,
	Tooltip,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { createFileRoute } from "@tanstack/react-router";
import {
	ArrowDownAZ,
	ArrowUpAZ,
	Edit3,
	Image as ImageIcon,
	MoreVertical,
	Plus,
	Save,
	SlidersHorizontal,
	X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useColorScheme } from "#/hooks/theme";

export const Route = createFileRoute("/_protected/saved-view-lab")({
	component: RouteComponent,
});

type ViewLayout = "grid" | "list" | "table";
type SortDirection = "asc" | "desc";

interface MockEntity {
	id: string;
	name: string;
	image?: string;
	rating?: number;
	year?: number;
	genre?: string;
	distillery?: string;
	age?: number;
	region?: string;
	tastingNotes?: string;
	type?: string;
	lastEvent?: string;
	eventCount?: number;
}

interface SavedViewScenario {
	id: string;
	name: string;
	icon: string;
	accentColor: string;
	isBuiltin: boolean;
	description: string;
	totalResults: number;
	queryDescription: string;
	availableFilters: Array<{
		key: string;
		label: string;
		type: "select" | "number" | "text";
		options?: string[];
	}>;
	availableSorts: Array<{ key: string; label: string }>;
	mockEntities: MockEntity[];
	cardConfig: {
		imageProperty?: string;
		titleProperty: string;
		subtitleProperties: string[];
		badgeProperty?: string;
	};
}

const MOCK_SCENARIOS: SavedViewScenario[] = [
	{
		id: "movies",
		name: "Movies",
		icon: "film",
		accentColor: "#5B7FFF",
		isBuiltin: true,
		description: "Built-in media view with curated poster grid layout",
		totalResults: 142,
		queryDescription: "All movies in your library",
		availableFilters: [
			{
				key: "genre",
				label: "Genre",
				type: "select",
				options: ["Action", "Drama", "Sci-Fi", "Comedy", "Thriller"],
			},
			{
				key: "year",
				label: "Release Year",
				type: "number",
			},
			{
				key: "rating",
				label: "Rating",
				type: "select",
				options: ["5★", "4★+", "3★+", "Any"],
			},
		],
		availableSorts: [
			{ key: "name", label: "Title" },
			{ key: "year", label: "Release Year" },
			{ key: "rating", label: "Rating" },
			{ key: "lastEvent", label: "Last Watched" },
		],
		mockEntities: [
			{
				id: "m1",
				name: "Interstellar",
				image:
					"https://image.tmdb.org/t/p/w500/gEU2QniE6E77NI6lCU6MxlNBvIx.jpg",
				rating: 5,
				year: 2014,
				genre: "Sci-Fi",
				type: "movie",
				lastEvent: "Watched 3 days ago",
				eventCount: 3,
			},
			{
				id: "m2",
				name: "The Dark Knight",
				image:
					"https://image.tmdb.org/t/p/w500/qJ2tW6WMUDux911r6m7haRef0WH.jpg",
				rating: 5,
				year: 2008,
				genre: "Action",
				type: "movie",
				lastEvent: "Watched 1 week ago",
				eventCount: 5,
			},
			{
				id: "m3",
				name: "Inception",
				image:
					"https://image.tmdb.org/t/p/w500/9gk7adHYeDvHkCSEqAvQNLV5Uge.jpg",
				rating: 5,
				year: 2010,
				genre: "Sci-Fi",
				type: "movie",
				lastEvent: "Watched 2 weeks ago",
				eventCount: 4,
			},
			{
				id: "m4",
				name: "Pulp Fiction",
				image:
					"https://image.tmdb.org/t/p/w500/d5iIlFn5s0ImszYzBPb8JPIfbXD.jpg",
				rating: 4,
				year: 1994,
				genre: "Thriller",
				type: "movie",
				lastEvent: "Watched 3 weeks ago",
				eventCount: 2,
			},
			{
				id: "m5",
				name: "The Shawshank Redemption",
				image:
					"https://image.tmdb.org/t/p/w500/q6y0Go1tsGEsmtFryDOJo3dEmqu.jpg",
				rating: 5,
				year: 1994,
				genre: "Drama",
				type: "movie",
				lastEvent: "Watched 1 month ago",
				eventCount: 6,
			},
			{
				id: "m6",
				name: "Forrest Gump",
				image:
					"https://image.tmdb.org/t/p/w500/arw2vcBveWOVZr6pxd9XTd1TdQa.jpg",
				rating: 4,
				year: 1994,
				genre: "Drama",
				type: "movie",
				lastEvent: "Watched 2 months ago",
				eventCount: 3,
			},
			{
				id: "m7",
				name: "Mad Max: Fury Road",
				image:
					"https://image.tmdb.org/t/p/w500/hA2ple9q4qnwxp3hKVNhroipsir.jpg",
				rating: 5,
				year: 2015,
				genre: "Action",
				type: "movie",
				lastEvent: "Watched 4 days ago",
				eventCount: 2,
			},
			{
				id: "m8",
				name: "Arrival",
				image:
					"https://image.tmdb.org/t/p/w500/x2FJsf1ElAgr63Y3PNPtJrcmpoe.jpg",
				rating: 4,
				year: 2016,
				genre: "Sci-Fi",
				type: "movie",
				lastEvent: "Watched 6 days ago",
				eventCount: 2,
			},
			{
				id: "m9",
				name: "Parasite",
				image:
					"https://image.tmdb.org/t/p/w500/7IiTTgloJzvGI1TAYymCfbfl3vT.jpg",
				rating: 5,
				year: 2019,
				genre: "Thriller",
				type: "movie",
				lastEvent: "Watched 9 days ago",
				eventCount: 3,
			},
			{
				id: "m10",
				name: "The Grand Budapest Hotel",
				image:
					"https://image.tmdb.org/t/p/w500/eWdyYQreja6JGCzqHWXpWHDrrPo.jpg",
				rating: 4,
				year: 2014,
				genre: "Comedy",
				type: "movie",
				lastEvent: "Watched 12 days ago",
				eventCount: 1,
			},
			{
				id: "m11",
				name: "Blade Runner 2049",
				image:
					"https://image.tmdb.org/t/p/w500/gajva2L0rPYkEWjzgFlBXCAVBE5.jpg",
				rating: 5,
				year: 2017,
				genre: "Sci-Fi",
				type: "movie",
				lastEvent: "Watched 2 weeks ago",
				eventCount: 4,
			},
			{
				id: "m12",
				name: "Whiplash",
				image:
					"https://image.tmdb.org/t/p/w500/7fn624j5lj3xTme2SgiLCeuedmO.jpg",
				rating: 4,
				year: 2014,
				genre: "Drama",
				type: "movie",
				lastEvent: "Watched 3 weeks ago",
				eventCount: 2,
			},
		],
		cardConfig: {
			imageProperty: "image",
			titleProperty: "name",
			subtitleProperties: ["year", "genre"],
			badgeProperty: "rating",
		},
	},
	{
		id: "whiskey",
		name: "Whiskey Shelf",
		icon: "wine",
		accentColor: "#D4A574",
		isBuiltin: false,
		description: "Custom tracker with generated card layout",
		totalResults: 28,
		queryDescription: "All whiskeys with tasting notes",
		availableFilters: [
			{
				key: "region",
				label: "Region",
				type: "select",
				options: ["Scotland", "Ireland", "Japan", "USA"],
			},
			{
				key: "age",
				label: "Age (years)",
				type: "number",
			},
			{
				key: "rating",
				label: "Rating",
				type: "select",
				options: ["5★", "4★+", "3★+", "Any"],
			},
		],
		availableSorts: [
			{ key: "name", label: "Name" },
			{ key: "age", label: "Age" },
			{ key: "rating", label: "Rating" },
			{ key: "lastEvent", label: "Last Tasted" },
		],
		mockEntities: [
			{
				id: "w1",
				name: "Lagavulin 16",
				image:
					"https://images.unsplash.com/photo-1569529465841-dfecdab7503b?w=400&h=600&fit=crop",
				distillery: "Lagavulin",
				age: 16,
				region: "Scotland",
				rating: 5,
				tastingNotes: "Intense peat smoke, maritime character",
				type: "whiskey",
				lastEvent: "Tasted 1 week ago",
				eventCount: 5,
			},
			{
				id: "w2",
				name: "Yamazaki 12",
				image:
					"https://images.unsplash.com/photo-1527281400-e5a664d3e8f9?w=400&h=600&fit=crop",
				distillery: "Yamazaki",
				age: 12,
				region: "Japan",
				rating: 4,
				tastingNotes: "Honeyed fruit, Japanese oak",
				type: "whiskey",
				lastEvent: "Tasted 2 weeks ago",
				eventCount: 3,
			},
			{
				id: "w3",
				name: "Ardbeg 10",
				image:
					"https://images.unsplash.com/photo-1566754436386-470e99acbb48?w=400&h=600&fit=crop",
				distillery: "Ardbeg",
				age: 10,
				region: "Scotland",
				rating: 5,
				tastingNotes: "Powerful peat, citrus notes",
				type: "whiskey",
				lastEvent: "Tasted 3 weeks ago",
				eventCount: 4,
			},
			{
				id: "w4",
				name: "Redbreast 12",
				image:
					"https://images.unsplash.com/photo-1574872803653-c2926a3f5f70?w=400&h=600&fit=crop",
				distillery: "Redbreast",
				age: 12,
				region: "Ireland",
				rating: 4,
				tastingNotes: "Sherry cask influence, dried fruits",
				type: "whiskey",
				lastEvent: "Tasted 1 month ago",
				eventCount: 2,
			},
			{
				id: "w5",
				name: "Buffalo Trace",
				image:
					"https://images.unsplash.com/photo-1514362545857-3bc16c4c7d1b?w=400&h=600&fit=crop",
				distillery: "Buffalo Trace",
				age: 8,
				region: "USA",
				rating: 4,
				tastingNotes: "Vanilla, caramel, soft spice",
				type: "whiskey",
				lastEvent: "Tasted 5 days ago",
				eventCount: 4,
			},
			{
				id: "w6",
				name: "Nikka From The Barrel",
				image:
					"https://images.unsplash.com/photo-1569529465841-dfecdab7503b?w=400&h=600&fit=crop",
				distillery: "Nikka",
				age: 0,
				region: "Japan",
				rating: 5,
				tastingNotes: "Rich spice, orange peel, oak",
				type: "whiskey",
				lastEvent: "Tasted 8 days ago",
				eventCount: 2,
			},
			{
				id: "w7",
				name: "Bunnahabhain 12",
				image:
					"https://images.unsplash.com/photo-1527281400-e5a664d3e8f9?w=400&h=600&fit=crop",
				distillery: "Bunnahabhain",
				age: 12,
				region: "Scotland",
				rating: 4,
				tastingNotes: "Nutty sweetness, coastal salinity",
				type: "whiskey",
				lastEvent: "Tasted 11 days ago",
				eventCount: 3,
			},
			{
				id: "w8",
				name: "Green Spot",
				image:
					"https://images.unsplash.com/photo-1574872803653-c2926a3f5f70?w=400&h=600&fit=crop",
				distillery: "Mitchell & Son",
				age: 10,
				region: "Ireland",
				rating: 4,
				tastingNotes: "Green apple, toasted barley, honey",
				type: "whiskey",
				lastEvent: "Tasted 2 weeks ago",
				eventCount: 2,
			},
			{
				id: "w9",
				name: "Maker's Mark Cask Strength",
				image:
					"https://images.unsplash.com/photo-1566754436386-470e99acbb48?w=400&h=600&fit=crop",
				distillery: "Maker's Mark",
				age: 7,
				region: "USA",
				rating: 5,
				tastingNotes: "Dark sugar, oak, baking spice",
				type: "whiskey",
				lastEvent: "Tasted 3 weeks ago",
				eventCount: 5,
			},
		],
		cardConfig: {
			imageProperty: "image",
			titleProperty: "name",
			subtitleProperties: ["distillery", "age", "region"],
			badgeProperty: "rating",
		},
	},
	{
		id: "weekend-picks",
		name: "Weekend Picks",
		icon: "sparkles",
		accentColor: "#A78BFA",
		isBuiltin: false,
		description: "Cross-schema saved view spanning multiple trackers",
		totalResults: 18,
		queryDescription:
			"Movies and books rated 4+ stars, added in the last month",
		availableFilters: [
			{
				key: "type",
				label: "Type",
				type: "select",
				options: ["All", "Movies", "Books"],
			},
			{
				key: "rating",
				label: "Rating",
				type: "select",
				options: ["5★", "4★+", "3★+"],
			},
		],
		availableSorts: [
			{ key: "name", label: "Name" },
			{ key: "rating", label: "Rating" },
			{ key: "lastEvent", label: "Last Activity" },
		],
		mockEntities: [
			{
				id: "wp1",
				name: "Dune",
				image:
					"https://image.tmdb.org/t/p/w500/d5NXSklXo0qyIYkgV94XAgMIckC.jpg",
				rating: 5,
				type: "movie",
				year: 2021,
				genre: "Sci-Fi",
				lastEvent: "Watched 2 days ago",
				eventCount: 2,
			},
			{
				id: "wp2",
				name: "Project Hail Mary",
				image:
					"https://images.unsplash.com/photo-1544947950-fa07a98d237f?w=400&h=600&fit=crop",
				rating: 5,
				type: "book",
				genre: "Sci-Fi",
				lastEvent: "Finished 5 days ago",
				eventCount: 1,
			},
			{
				id: "wp3",
				name: "The Blade Itself",
				image:
					"https://images.unsplash.com/photo-1512820790803-83ca734da794?w=400&h=600&fit=crop",
				rating: 4,
				type: "book",
				genre: "Fantasy",
				lastEvent: "Reading now",
				eventCount: 3,
			},
			{
				id: "wp4",
				name: "Everything Everywhere All at Once",
				image:
					"https://image.tmdb.org/t/p/w500/w3LxiVYdWWRvEVdn5RYq6jIqkb1.jpg",
				rating: 5,
				type: "movie",
				year: 2022,
				genre: "Sci-Fi",
				lastEvent: "Watched 1 week ago",
				eventCount: 1,
			},
			{
				id: "wp5",
				name: "Station Eleven",
				image:
					"https://images.unsplash.com/photo-1512820790803-83ca734da794?w=400&h=600&fit=crop",
				rating: 4,
				type: "book",
				genre: "Sci-Fi",
				lastEvent: "Finished 9 days ago",
				eventCount: 1,
			},
			{
				id: "wp6",
				name: "Past Lives",
				image:
					"https://image.tmdb.org/t/p/w500/k3waqVXSnvCZWfJYNtdamTgTtTA.jpg",
				rating: 5,
				type: "movie",
				year: 2023,
				genre: "Drama",
				lastEvent: "Watched 10 days ago",
				eventCount: 1,
			},
			{
				id: "wp7",
				name: "Sea of Tranquility",
				image:
					"https://images.unsplash.com/photo-1544947950-fa07a98d237f?w=400&h=600&fit=crop",
				rating: 4,
				type: "book",
				genre: "Sci-Fi",
				lastEvent: "Reading now",
				eventCount: 2,
			},
			{
				id: "wp8",
				name: "Spider-Man: Into the Spider-Verse",
				image:
					"https://image.tmdb.org/t/p/w500/iiZZdoQBEYBv6id8su7ImL0oCbD.jpg",
				rating: 5,
				type: "movie",
				year: 2018,
				genre: "Action",
				lastEvent: "Watched 12 days ago",
				eventCount: 2,
			},
			{
				id: "wp9",
				name: "The Left Hand of Darkness",
				image:
					"https://images.unsplash.com/photo-1495640388908-05fa85288e61?w=400&h=600&fit=crop",
				rating: 5,
				type: "book",
				genre: "Sci-Fi",
				lastEvent: "Finished 2 weeks ago",
				eventCount: 1,
			},
		],
		cardConfig: {
			imageProperty: "image",
			titleProperty: "name",
			subtitleProperties: ["type", "genre"],
			badgeProperty: "rating",
		},
	},
];

function applyFiltersAndSort(
	entities: MockEntity[],
	filters: Record<string, string>,
	sortKey: string,
	sortDirection: SortDirection,
): MockEntity[] {
	let filtered = [...entities];

	Object.entries(filters).forEach(([key, value]) => {
		if (!value || value === "All" || value === "Any") return;

		filtered = filtered.filter((entity) => {
			const entityValue = entity[key as keyof MockEntity];
			if (entityValue === undefined) return false;

			if (typeof entityValue === "number") {
				if (value.includes("+")) {
					const minRating = Number.parseInt(value.charAt(0), 10);
					return (entity.rating ?? 0) >= minRating;
				}
				return entityValue.toString() === value;
			}

			return entityValue.toString().toLowerCase().includes(value.toLowerCase());
		});
	});

	filtered.sort((a, b) => {
		const aValue = a[sortKey as keyof MockEntity] ?? "";
		const bValue = b[sortKey as keyof MockEntity] ?? "";

		let comparison = 0;
		if (typeof aValue === "number" && typeof bValue === "number") {
			comparison = aValue - bValue;
		} else {
			comparison = String(aValue).localeCompare(String(bValue));
		}

		return sortDirection === "asc" ? comparison : -comparison;
	});

	return filtered;
}

function EntityGridCard(props: {
	entity: MockEntity;
	scenario: SavedViewScenario;
	isDark: boolean;
}) {
	const surface = props.isDark ? "var(--mantine-color-dark-8)" : "white";
	const surfaceHover = props.isDark
		? "var(--mantine-color-dark-7)"
		: "var(--mantine-color-stone-1)";
	const border = props.isDark
		? "var(--mantine-color-dark-6)"
		: "var(--mantine-color-stone-3)";
	const borderAccent = "var(--mantine-color-accent-5)";
	const textPrimary = props.isDark
		? "var(--mantine-color-dark-0)"
		: "var(--mantine-color-dark-9)";
	const textSecondary = props.isDark
		? "var(--mantine-color-dark-3)"
		: "var(--mantine-color-dark-5)";
	const textMuted = props.isDark
		? "var(--mantine-color-dark-4)"
		: "var(--mantine-color-stone-5)";

	const accentColor = props.scenario.accentColor;
	const accentMuted = `color-mix(in srgb, ${accentColor} 15%, transparent)`;

	const imageProperty = props.scenario.cardConfig.imageProperty;
	const image = imageProperty
		? props.entity[imageProperty as keyof MockEntity]
		: undefined;

	const subtitle = props.scenario.cardConfig.subtitleProperties
		.map((prop) => props.entity[prop as keyof MockEntity])
		.filter(Boolean)
		.join(" · ");

	const badgeProperty = props.scenario.cardConfig.badgeProperty;
	const badgeValue = badgeProperty
		? props.entity[badgeProperty as keyof MockEntity]
		: undefined;

	return (
		<Card
			p={0}
			bg={surface}
			radius="sm"
			style={{
				border: `1px solid ${border}`,
				cursor: "pointer",
				overflow: "hidden",
				transition: "all 0.25s ease",
			}}
			styles={{
				root: {
					"&:hover": {
						transform: "translateY(-4px)",
						boxShadow: `0 12px 32px rgba(0, 0, 0, ${props.isDark ? "0.35" : "0.1"})`,
						borderColor: borderAccent,
					},
				},
			}}
		>
			{image ? (
				<Box
					h={220}
					style={{
						backgroundImage: `url(${image})`,
						backgroundSize: "cover",
						backgroundPosition: "center",
						position: "relative",
					}}
				>
					<Box
						style={{
							position: "absolute",
							inset: 0,
							background: `linear-gradient(180deg, transparent 50%, ${props.isDark ? "rgba(26, 24, 22, 0.7)" : "rgba(0, 0, 0, 0.35)"} 100%)`,
						}}
					/>
					{badgeValue && (
						<Box
							style={{
								position: "absolute",
								top: 12,
								right: 12,
							}}
						>
							<Badge
								size="lg"
								variant="filled"
								styles={{
									root: {
										backgroundColor: accentColor,
										color: "white",
										fontFamily: "var(--mantine-headings-font-family)",
										fontWeight: 700,
										border: "none",
										boxShadow: "0 2px 8px rgba(0, 0, 0, 0.3)",
									},
								}}
							>
								{typeof badgeValue === "number" ? `${badgeValue}★` : badgeValue}
							</Badge>
						</Box>
					)}
				</Box>
			) : (
				<Box
					h={220}
					bg={surfaceHover}
					style={{
						display: "grid",
						placeItems: "center",
						position: "relative",
					}}
				>
					<ImageIcon size={48} color={textMuted} strokeWidth={1.5} />
					{badgeValue && (
						<Box
							style={{
								position: "absolute",
								top: 12,
								right: 12,
							}}
						>
							<Badge
								size="lg"
								variant="filled"
								styles={{
									root: {
										backgroundColor: accentColor,
										color: "white",
										fontFamily: "var(--mantine-headings-font-family)",
										fontWeight: 700,
										border: "none",
									},
								}}
							>
								{typeof badgeValue === "number" ? `${badgeValue}★` : badgeValue}
							</Badge>
						</Box>
					)}
				</Box>
			)}
			<Box p="lg">
				<Text
					fw={600}
					size="md"
					mb={6}
					lineClamp={2}
					style={{
						fontFamily: "var(--mantine-headings-font-family)",
						color: textPrimary,
					}}
				>
					{props.entity.name}
				</Text>
				{subtitle && (
					<Text size="xs" c={textSecondary} mb={8} lineClamp={1}>
						{subtitle}
					</Text>
				)}
				{props.entity.type && (
					<Badge
						size="sm"
						variant="light"
						mb={8}
						styles={{
							root: {
								backgroundColor: accentMuted,
								color: accentColor,
								border: `1px solid ${accentColor}33`,
								fontWeight: 600,
								fontFamily: "var(--mantine-headings-font-family)",
								textTransform: "capitalize",
							},
						}}
					>
						{props.entity.type}
					</Badge>
				)}
				{props.entity.lastEvent && (
					<Text size="xs" c={textMuted} mt={4}>
						{props.entity.lastEvent}
					</Text>
				)}
			</Box>
		</Card>
	);
}

function EntityThumbnail(props: {
	image?: string;
	height: number;
	width: number;
	isDark: boolean;
	radius?: string;
	iconSize?: number;
}) {
	const surfaceHover = props.isDark
		? "var(--mantine-color-dark-7)"
		: "var(--mantine-color-stone-1)";
	const textMuted = props.isDark
		? "var(--mantine-color-dark-4)"
		: "var(--mantine-color-stone-5)";

	if (props.image)
		return (
			<Box
				h={props.height}
				w={props.width}
				style={{
					flexShrink: 0,
					borderRadius: props.radius ?? "var(--mantine-radius-sm)",
					backgroundImage: `url(${props.image})`,
					backgroundSize: "cover",
					backgroundPosition: "center",
				}}
			/>
		);

	return (
		<Box
			h={props.height}
			w={props.width}
			bg={surfaceHover}
			style={{
				flexShrink: 0,
				display: "grid",
				placeItems: "center",
				borderRadius: props.radius ?? "var(--mantine-radius-sm)",
			}}
		>
			<ImageIcon
				size={props.iconSize ?? 24}
				color={textMuted}
				strokeWidth={1.5}
			/>
		</Box>
	);
}

function EntityListRow(props: {
	entity: MockEntity;
	scenario: SavedViewScenario;
	isDark: boolean;
}) {
	const surface = props.isDark ? "var(--mantine-color-dark-8)" : "white";
	const border = props.isDark
		? "var(--mantine-color-dark-6)"
		: "var(--mantine-color-stone-3)";
	const textPrimary = props.isDark
		? "var(--mantine-color-dark-0)"
		: "var(--mantine-color-dark-9)";
	const textSecondary = props.isDark
		? "var(--mantine-color-dark-3)"
		: "var(--mantine-color-dark-5)";
	const textMuted = props.isDark
		? "var(--mantine-color-dark-4)"
		: "var(--mantine-color-stone-5)";

	const accentColor = props.scenario.accentColor;
	const accentMuted = `color-mix(in srgb, ${accentColor} 15%, transparent)`;
	const imageProperty = props.scenario.cardConfig.imageProperty;
	const image = imageProperty
		? props.entity[imageProperty as keyof MockEntity]
		: undefined;

	const subtitle = props.scenario.cardConfig.subtitleProperties
		.map((prop) => props.entity[prop as keyof MockEntity])
		.filter(Boolean)
		.join(" · ");

	const badgeProperty = props.scenario.cardConfig.badgeProperty;
	const badgeValue = badgeProperty
		? props.entity[badgeProperty as keyof MockEntity]
		: undefined;

	return (
		<Paper
			p="md"
			withBorder
			radius="sm"
			bg={surface}
			style={{
				cursor: "pointer",
				transition: "all 0.2s ease",
				borderLeft: `3px solid ${border}`,
			}}
			styles={{
				root: {
					"&:hover": {
						borderLeftColor: accentColor,
						backgroundColor: accentMuted,
						transform: "translateX(4px)",
					},
				},
			}}
		>
			<Group justify="space-between" align="flex-start" wrap="nowrap">
				<Group gap="md" wrap="nowrap" style={{ flex: 1, minWidth: 0 }}>
					<EntityThumbnail
						image={typeof image === "string" ? image : undefined}
						height={84}
						width={60}
						isDark={props.isDark}
						iconSize={20}
					/>
					<Stack gap={4} style={{ flex: 1, minWidth: 0 }}>
						<Text
							fw={600}
							size="md"
							style={{
								fontFamily: "var(--mantine-headings-font-family)",
								color: textPrimary,
							}}
						>
							{props.entity.name}
						</Text>
						{subtitle && (
							<Text size="sm" c={textSecondary}>
								{subtitle}
							</Text>
						)}
						<Group gap="xs">
							{props.entity.type && (
								<Badge
									size="sm"
									variant="light"
									styles={{
										root: {
											backgroundColor: accentMuted,
											color: accentColor,
											border: `1px solid ${accentColor}33`,
											fontWeight: 600,
											fontFamily: "var(--mantine-headings-font-family)",
											textTransform: "capitalize",
										},
									}}
								>
									{props.entity.type}
								</Badge>
							)}
							{props.entity.lastEvent && (
								<Text size="xs" c={textMuted}>
									{props.entity.lastEvent}
								</Text>
							)}
						</Group>
					</Stack>
				</Group>
				{badgeValue && (
					<Badge
						size="lg"
						variant="filled"
						styles={{
							root: {
								backgroundColor: accentColor,
								color: "white",
								fontFamily: "var(--mantine-headings-font-family)",
								fontWeight: 700,
							},
						}}
					>
						{typeof badgeValue === "number" ? `${badgeValue}★` : badgeValue}
					</Badge>
				)}
			</Group>
		</Paper>
	);
}

function EntityTableView(props: {
	entities: MockEntity[];
	scenario: SavedViewScenario;
	isDark: boolean;
}) {
	const surface = props.isDark ? "var(--mantine-color-dark-8)" : "white";
	const textPrimary = props.isDark
		? "var(--mantine-color-dark-0)"
		: "var(--mantine-color-dark-9)";
	const textSecondary = props.isDark
		? "var(--mantine-color-dark-3)"
		: "var(--mantine-color-dark-5)";

	const accentColor = props.scenario.accentColor;

	return (
		<Paper withBorder radius="sm" bg={surface}>
			<Table
				striped
				highlightOnHover
				styles={{
					th: {
						fontFamily: "var(--mantine-headings-font-family)",
						fontWeight: 600,
						fontSize: "12px",
						textTransform: "uppercase",
						letterSpacing: "0.5px",
						color: accentColor,
					},
				}}
			>
				<Table.Thead>
					<Table.Tr>
						<Table.Th>Name</Table.Th>
						{props.scenario.cardConfig.subtitleProperties.map((prop) => (
							<Table.Th key={prop} style={{ textTransform: "capitalize" }}>
								{prop}
							</Table.Th>
						))}
						{props.scenario.cardConfig.badgeProperty && (
							<Table.Th style={{ textTransform: "capitalize" }}>
								{props.scenario.cardConfig.badgeProperty}
							</Table.Th>
						)}
						<Table.Th>Last Activity</Table.Th>
					</Table.Tr>
				</Table.Thead>
				<Table.Tbody>
					{props.entities.map((entity) =>
						(() => {
							const imageProperty = props.scenario.cardConfig.imageProperty;
							const image = imageProperty
								? entity[imageProperty as keyof MockEntity]
								: undefined;

							return (
								<Table.Tr
									key={entity.id}
									style={{
										cursor: "pointer",
										borderLeft: "3px solid transparent",
										transition: "all 0.15s ease",
									}}
									styles={{
										tr: {
											"&:hover": {
												borderLeftColor: accentColor,
											},
										},
									}}
								>
									<Table.Td>
										<Group gap="sm" wrap="nowrap">
											<EntityThumbnail
												image={typeof image === "string" ? image : undefined}
												height={54}
												width={40}
												isDark={props.isDark}
												radius="var(--mantine-radius-xs)"
												iconSize={16}
											/>
											<Text
												fw={600}
												style={{
													fontFamily: "var(--mantine-headings-font-family)",
													color: textPrimary,
												}}
											>
												{entity.name}
											</Text>
										</Group>
									</Table.Td>
									{props.scenario.cardConfig.subtitleProperties.map((prop) => (
										<Table.Td key={prop}>
											<Text size="sm" c={textSecondary}>
												{entity[prop as keyof MockEntity]?.toString() ?? "—"}
											</Text>
										</Table.Td>
									))}
									{props.scenario.cardConfig.badgeProperty && (
										<Table.Td>
											<Badge
												variant="filled"
												styles={{
													root: {
														backgroundColor: accentColor,
														color: "white",
														fontFamily: "var(--mantine-headings-font-family)",
														fontWeight: 700,
													},
												}}
											>
												{typeof entity[
													props.scenario.cardConfig
														.badgeProperty as keyof MockEntity
												] === "number"
													? `${entity[props.scenario.cardConfig.badgeProperty as keyof MockEntity]}★`
													: entity[
															props.scenario.cardConfig
																.badgeProperty as keyof MockEntity
														]}
											</Badge>
										</Table.Td>
									)}
									<Table.Td>
										<Text size="xs" c={textSecondary}>
											{entity.lastEvent ?? "—"}
										</Text>
									</Table.Td>
								</Table.Tr>
							);
						})(),
					)}
				</Table.Tbody>
			</Table>
		</Paper>
	);
}

function QueryBuilderDrawer(props: {
	opened: boolean;
	onClose: () => void;
	scenario: SavedViewScenario;
	layout: ViewLayout;
	sortKey: string;
	sortDirection: SortDirection;
	isDark: boolean;
	onLayoutChange: (value: ViewLayout) => void;
	onSortKeyChange: (value: string) => void;
	onSortDirectionChange: (value: SortDirection) => void;
}) {
	const surface = props.isDark ? "var(--mantine-color-dark-8)" : "white";
	const surfaceElevated = props.isDark
		? "var(--mantine-color-dark-7)"
		: "var(--mantine-color-stone-1)";
	const textPrimary = props.isDark
		? "var(--mantine-color-dark-0)"
		: "var(--mantine-color-dark-9)";
	const textMuted = props.isDark
		? "var(--mantine-color-dark-4)"
		: "var(--mantine-color-stone-5)";

	const accentColor = props.scenario.accentColor;
	const accentMuted = `color-mix(in srgb, ${accentColor} 15%, transparent)`;

	return (
		<Drawer
			opened={props.opened}
			onClose={props.onClose}
			position="right"
			size="xl"
			title={
				<Group gap="sm">
					<Box
						w={32}
						h={32}
						style={{
							display: "grid",
							placeItems: "center",
							borderRadius: "var(--mantine-radius-sm)",
							backgroundColor: accentMuted,
							color: accentColor,
						}}
					>
						<SlidersHorizontal size={18} />
					</Box>
					<Text
						fw={600}
						style={{ fontFamily: "var(--mantine-headings-font-family)" }}
					>
						{props.scenario.isBuiltin ? "Customize View" : "Edit View"}
					</Text>
				</Group>
			}
			styles={{
				body: { backgroundColor: surface },
				header: { backgroundColor: surface },
				content: { backgroundColor: surface },
			}}
		>
			<Stack gap="xl">
				{props.scenario.isBuiltin && (
					<Paper p="md" radius="sm" bg={accentMuted} withBorder>
						<Stack gap="xs">
							<Text
								size="sm"
								fw={600}
								style={{
									color: accentColor,
									fontFamily: "var(--mantine-headings-font-family)",
								}}
							>
								Built-in view
							</Text>
							<Text size="sm" c={textMuted}>
								This is a built-in view. Use this drawer to inspect how the view
								is configured. To make your own version, clone it from the view
								menu.
							</Text>
						</Stack>
					</Paper>
				)}

				<Box>
					<Text
						fw={600}
						size="xs"
						mb="md"
						tt="uppercase"
						c={textMuted}
						style={{ letterSpacing: "0.8px" }}
					>
						1. Scope Selection
					</Text>
					<Paper p="md" withBorder radius="sm" bg={surfaceElevated} mb="sm">
						<Stack gap="sm">
							<Text size="sm" fw={500} c={textPrimary}>
								View name
							</Text>
							<TextInput
								defaultValue={props.scenario.name}
								placeholder="Enter view name"
							/>
						</Stack>
					</Paper>
					<Paper p="md" withBorder radius="sm" bg={surfaceElevated}>
						<Stack gap="sm">
							<Text size="sm" fw={500} c={textPrimary}>
								What to show
							</Text>
							<Select
								data={["Single schema", "Multiple schemas", "Entire tracker"]}
								defaultValue="Single schema"
								disabled
							/>
							<Text size="xs" c={textMuted}>
								Currently showing: <strong>{props.scenario.name}</strong>{" "}
								entities
							</Text>
						</Stack>
					</Paper>
				</Box>

				<Box>
					<Text
						fw={600}
						size="xs"
						mb="md"
						tt="uppercase"
						c={textMuted}
						style={{ letterSpacing: "0.8px" }}
					>
						2. Attribute Filters
					</Text>
					<Stack gap="sm">
						{props.scenario.availableFilters.map((filter) => (
							<Paper
								key={filter.key}
								p="md"
								withBorder
								radius="sm"
								bg={surfaceElevated}
							>
								<Stack gap="xs">
									<Group justify="space-between">
										<Text size="sm" fw={500} c={textPrimary}>
											{filter.label}
										</Text>
										<ActionIcon size="xs" variant="subtle" color="red">
											<X size={12} />
										</ActionIcon>
									</Group>
									{filter.type === "select" && filter.options ? (
										<Select data={filter.options} placeholder="Select value" />
									) : (
										<TextInput placeholder="Enter value" />
									)}
								</Stack>
							</Paper>
						))}
						<Button
							leftSection={<Plus size={14} />}
							variant="light"
							size="sm"
							style={{ backgroundColor: accentMuted, color: accentColor }}
						>
							Add filter
						</Button>
					</Stack>
				</Box>

				<Box>
					<Text
						fw={600}
						size="xs"
						mb="md"
						tt="uppercase"
						c={textMuted}
						style={{ letterSpacing: "0.8px" }}
					>
						3. Event Logic
					</Text>
					<Paper p="md" withBorder radius="sm" bg={surfaceElevated}>
						<Stack gap="sm">
							<Text size="sm" fw={500} c={textPrimary}>
								Filter by activity
							</Text>
							<Select
								data={[
									"Any activity",
									"Has events",
									"No events",
									"Custom event query",
								]}
								defaultValue="Any activity"
							/>
							<Text size="xs" c={textMuted}>
								Filter entities based on their event history
							</Text>
						</Stack>
					</Paper>
				</Box>

				<Box>
					<Text
						fw={600}
						size="xs"
						mb="md"
						tt="uppercase"
						c={textMuted}
						style={{ letterSpacing: "0.8px" }}
					>
						4. Display Configuration
					</Text>
					<Stack gap="sm">
						<Paper p="md" withBorder radius="sm" bg={surfaceElevated}>
							<Stack gap="xs">
								<Text size="sm" fw={500} c={textPrimary}>
									Default sort
								</Text>
								<Select
									data={props.scenario.availableSorts.map((sort) => ({
										label: sort.label,
										value: sort.key,
									}))}
									value={props.sortKey}
									onChange={(value) => {
										if (value) props.onSortKeyChange(value);
									}}
								/>
								<SegmentedControl
									value={props.sortDirection}
									onChange={(value) =>
										props.onSortDirectionChange(value as SortDirection)
									}
									data={[
										{
											label: (
												<Group gap={6} wrap="nowrap">
													<ArrowUpAZ size={14} />
													<Text size="xs">Ascending</Text>
												</Group>
											),
											value: "asc",
										},
										{
											label: (
												<Group gap={6} wrap="nowrap">
													<ArrowDownAZ size={14} />
													<Text size="xs">Descending</Text>
												</Group>
											),
											value: "desc",
										},
									]}
								/>
							</Stack>
						</Paper>
						<Paper p="md" withBorder radius="sm" bg={surfaceElevated}>
							<Stack gap="xs">
								<Text size="sm" fw={500} c={textPrimary}>
									Default layout
								</Text>
								<SegmentedControl
									value={props.layout}
									onChange={(value) =>
										props.onLayoutChange(value as ViewLayout)
									}
									data={[
										{ label: "Grid", value: "grid" },
										{ label: "List", value: "list" },
										{ label: "Table", value: "table" },
									]}
								/>
							</Stack>
						</Paper>
						<Paper p="md" withBorder radius="sm" bg={surfaceElevated}>
							<Stack gap="xs">
								<Text size="sm" fw={500} c={textPrimary}>
									Promoted filters
								</Text>
								<Text size="xs" c={textMuted}>
									Select which filters appear in the view's control bar
								</Text>
							</Stack>
						</Paper>
					</Stack>
				</Box>

				<Divider />

				<Group justify="space-between">
					<Button variant="subtle" onClick={props.onClose}>
						Cancel
					</Button>
					{props.scenario.isBuiltin ? null : (
						<Button
							leftSection={<Save size={14} />}
							style={{ backgroundColor: accentColor }}
						>
							Save changes
						</Button>
					)}
				</Group>
			</Stack>
		</Drawer>
	);
}

function SavedViewRenderer(props: {
	scenario: SavedViewScenario;
	isDark: boolean;
}) {
	const [layout, setLayout] = useState<ViewLayout>("grid");
	const [page, setPage] = useState(1);
	const [sortKey, setSortKey] = useState("name");
	const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
	const [
		queryBuilderOpened,
		{ open: openQueryBuilder, close: closeQueryBuilder },
	] = useDisclosure(false);

	const surface = props.isDark ? "var(--mantine-color-dark-8)" : "white";
	const textPrimary = props.isDark
		? "var(--mantine-color-dark-0)"
		: "var(--mantine-color-dark-9)";
	const textSecondary = props.isDark
		? "var(--mantine-color-dark-2)"
		: "var(--mantine-color-dark-6)";
	const textMuted = props.isDark
		? "var(--mantine-color-dark-4)"
		: "var(--mantine-color-stone-5)";

	const accentColor = props.scenario.accentColor;
	const accentMuted = `color-mix(in srgb, ${accentColor} 15%, transparent)`;

	const filteredEntities = applyFiltersAndSort(
		props.scenario.mockEntities,
		{},
		sortKey,
		sortDirection,
	);
	const pageSize = 6;
	const totalPages = Math.max(1, Math.ceil(filteredEntities.length / pageSize));
	const currentPage = Math.min(page, totalPages);
	const paginatedEntities = filteredEntities.slice(
		(currentPage - 1) * pageSize,
		currentPage * pageSize,
	);
	const rangeStart = filteredEntities.length
		? (currentPage - 1) * pageSize + 1
		: 0;
	const rangeEnd = Math.min(currentPage * pageSize, filteredEntities.length);

	useEffect(() => {
		setPage(1);
	}, [props.scenario.id, layout, sortKey, sortDirection]);

	return (
		<Stack gap="xl">
			<Paper
				p="lg"
				withBorder
				radius="sm"
				bg={surface}
				style={{ borderTop: `3px solid ${accentColor}` }}
			>
				<Stack gap="sm">
					<Group justify="space-between" align="flex-start">
						<Stack gap={6} style={{ flex: 1 }}>
							<Group gap="sm" align="center">
								<Text
									size="1.5rem"
									fw={700}
									style={{
										fontFamily: "var(--mantine-headings-font-family)",
										color: textPrimary,
										lineHeight: 1.1,
									}}
								>
									{props.scenario.name}
								</Text>
								{props.scenario.isBuiltin && (
									<Badge
										size="sm"
										variant="light"
										styles={{
											root: {
												backgroundColor: accentMuted,
												color: accentColor,
												border: `1px solid ${accentColor}`,
												fontWeight: 600,
												fontFamily: "var(--mantine-headings-font-family)",
											},
										}}
									>
										Built-in
									</Badge>
								)}
							</Group>
							<Text size="sm" c={textSecondary}>
								{props.scenario.queryDescription}
							</Text>
							<Group gap="xs">
								<Badge
									variant="filled"
									styles={{
										root: {
											backgroundColor: accentColor,
											color: "white",
											fontFamily: "var(--mantine-headings-font-family)",
											fontWeight: 600,
										},
									}}
								>
									{filteredEntities.length} results
								</Badge>
								{filteredEntities.length > 0 && (
									<Text size="xs" c={textMuted}>
										Showing {rangeStart}-{rangeEnd}
									</Text>
								)}
							</Group>
						</Stack>
						<Group gap="xs">
							<Tooltip label="Edit view definition">
								<ActionIcon
									size="lg"
									variant="light"
									onClick={openQueryBuilder}
									style={{ backgroundColor: accentMuted, color: accentColor }}
								>
									<Edit3 size={18} />
								</ActionIcon>
							</Tooltip>
							<Menu position="bottom-end">
								<Menu.Target>
									<ActionIcon
										size="lg"
										variant="light"
										style={{ backgroundColor: accentMuted, color: accentColor }}
									>
										<MoreVertical size={18} />
									</ActionIcon>
								</Menu.Target>
								<Menu.Dropdown>
									{props.scenario.isBuiltin ? (
										<Menu.Item leftSection={<Plus size={14} />}>
											Clone view
										</Menu.Item>
									) : (
										<>
											<Menu.Item leftSection={<Plus size={14} />}>
												Clone view
											</Menu.Item>
											<Menu.Divider />
											<Menu.Item color="red" leftSection={<X size={14} />}>
												Delete view
											</Menu.Item>
										</>
									)}
								</Menu.Dropdown>
							</Menu>
						</Group>
					</Group>
				</Stack>
			</Paper>

			{filteredEntities.length === 0 ? (
				<Paper
					p="xl"
					withBorder
					radius="sm"
					bg={surface}
					style={{ textAlign: "center" }}
				>
					<Stack gap="md" align="center">
						<Box
							w={64}
							h={64}
							style={{
								display: "grid",
								placeItems: "center",
								borderRadius: "50%",
								backgroundColor: accentMuted,
								color: accentColor,
							}}
						>
							<X size={28} />
						</Box>
						<Stack gap="xs" align="center">
							<Text
								fw={600}
								size="lg"
								style={{ fontFamily: "var(--mantine-headings-font-family)" }}
							>
								No results found
							</Text>
							<Text size="sm" c={textMuted} style={{ maxWidth: 400 }}>
								There are no entities matching this view's criteria yet.
							</Text>
						</Stack>
					</Stack>
				</Paper>
			) : layout === "grid" ? (
				<SimpleGrid cols={{ base: 1, sm: 2, md: 3, lg: 4 }} spacing="md">
					{paginatedEntities.map((entity) => (
						<EntityGridCard
							key={entity.id}
							entity={entity}
							scenario={props.scenario}
							isDark={props.isDark}
						/>
					))}
				</SimpleGrid>
			) : layout === "list" ? (
				<Stack gap="sm">
					{paginatedEntities.map((entity) => (
						<EntityListRow
							key={entity.id}
							entity={entity}
							scenario={props.scenario}
							isDark={props.isDark}
						/>
					))}
				</Stack>
			) : (
				<EntityTableView
					entities={paginatedEntities}
					scenario={props.scenario}
					isDark={props.isDark}
				/>
			)}

			{filteredEntities.length > 0 && totalPages > 1 && (
				<Paper p="md" withBorder radius="sm" bg={surface}>
					<Group justify="space-between" align="center">
						<Text size="sm" c={textMuted}>
							Page {currentPage} of {totalPages}
						</Text>
						<Pagination
							value={currentPage}
							onChange={setPage}
							total={totalPages}
							siblings={1}
							boundaries={1}
							color="accent"
							size="sm"
						/>
					</Group>
				</Paper>
			)}

			<QueryBuilderDrawer
				opened={queryBuilderOpened}
				onClose={closeQueryBuilder}
				scenario={props.scenario}
				layout={layout}
				sortKey={sortKey}
				sortDirection={sortDirection}
				isDark={props.isDark}
				onLayoutChange={(value) => setLayout(value)}
				onSortKeyChange={(value) => setSortKey(value)}
				onSortDirectionChange={(value) => setSortDirection(value)}
			/>
		</Stack>
	);
}

function RouteComponent() {
	const colorScheme = useColorScheme();
	const isDark = colorScheme === "dark";
	const [activeScenario, setActiveScenario] = useState("movies");
	const scenario =
		MOCK_SCENARIOS.find((item) => item.id === activeScenario) ??
		MOCK_SCENARIOS[0];

	if (!scenario) throw new Error("Scenario not found");

	const textPrimary = isDark
		? "var(--mantine-color-dark-0)"
		: "var(--mantine-color-dark-9)";
	const textSecondary = isDark
		? "var(--mantine-color-dark-2)"
		: "var(--mantine-color-dark-6)";
	const borderAccent = "var(--mantine-color-accent-5)";

	return (
		<Container size="xl" py="xl">
			<Stack gap="xl">
				<Paper
					p="lg"
					withBorder
					radius="sm"
					style={{ borderTop: `2px solid ${borderAccent}` }}
				>
					<Group justify="space-between" align="flex-end" gap="lg">
						<Stack gap={4}>
							<Text
								size="1.5rem"
								fw={700}
								style={{
									fontFamily: "var(--mantine-headings-font-family)",
									color: textPrimary,
									lineHeight: 1.1,
								}}
							>
								Saved View Preview
							</Text>
							<Text size="sm" c={textSecondary}>
								A compact mock of the renderer, view controls, and save actions.
							</Text>
						</Stack>
						<Select
							label="Scenario"
							value={scenario.id}
							onChange={(value) => setActiveScenario(value ?? "movies")}
							data={MOCK_SCENARIOS.map((item) => ({
								value: item.id,
								label: item.name,
							}))}
							w={{ base: "100%", sm: 240 }}
						/>
					</Group>
				</Paper>

				<SavedViewRenderer scenario={scenario} isDark={isDark} />
			</Stack>
		</Container>
	);
}
