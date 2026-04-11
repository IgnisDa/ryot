// V6: Action-oriented overview — "what should I do next?"
// Leads with Continue (in-progress with progress bars), then Up Next (backlog),
// Rate These (unrated completions), This Week (activity), Library at a Glance.
// Every section is actionable. Stats are de-emphasized at the bottom.

import {
	ActionIcon,
	Badge,
	Box,
	Button,
	Container,
	Group,
	Paper,
	Progress,
	ScrollArea,
	SimpleGrid,
	Stack,
	Text,
	Tooltip,
	UnstyledButton,
} from "@mantine/core";
import { createFileRoute } from "@tanstack/react-router";
import {
	BookOpen,
	ChevronRight,
	Clock,
	Gamepad2,
	Headphones,
	Monitor,
	Play,
	Plus,
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

// --- Main ---

function RouteComponent() {
	const t = useThemeTokens();
	const bgPage = t.isDark
		? "var(--mantine-color-dark-8)"
		: "var(--mantine-color-stone-0)";

	const dateGroups = RECENT_EVENTS.reduce<Record<string, ActivityEvent[]>>(
		(acc, event) => {
			if (!acc[event.date]) {
				acc[event.date] = [];
			}
			acc[event.date]!.push(event);
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
							onClick={() => console.log("[v6] Add media")}
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
		</Box>
	);
}
