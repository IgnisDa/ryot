import {
	ActionIcon,
	Badge,
	Box,
	Button,
	Center,
	Group,
	Loader,
	Paper,
	Progress,
	ScrollArea,
	SimpleGrid,
	Stack,
	Text,
	ThemeIcon,
	Tooltip,
	UnstyledButton,
} from "@mantine/core";
import { modals } from "@mantine/modals";
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
import {
	SearchEntityModalContent,
	SearchEntityModalTitle,
} from "#/features/entities/search-modal";
import { useEntitySchemasQuery } from "#/features/entity-schemas/hooks";
import type { AppEntitySchema } from "#/features/entity-schemas/model";
import { TrackerIcon } from "#/features/trackers/icons";
import type { AppTracker } from "#/features/trackers/model";
import { useThemeTokens } from "#/hooks/theme";

const GOLD = "#C9943A";
const STONE = "#8C7560";

const SECTION_ACCENTS = {
	activity: "#6F8B75",
	continue: GOLD,
	library: STONE,
	queue: "#8E6A4D",
	review: "#D38D5A",
};

function withAlpha(hex: string, alpha: number) {
	const raw = hex.replace("#", "");
	const normalized =
		raw.length === 3
			? raw
					.split("")
					.map((char) => `${char}${char}`)
					.join("")
			: raw;
	const r = Number.parseInt(normalized.slice(0, 2), 16);
	const g = Number.parseInt(normalized.slice(2, 4), 16);
	const b = Number.parseInt(normalized.slice(4, 6), 16);
	return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function getQueueNote(item: BacklogItem, rank: number) {
	if (rank === 0) {
		return "Pick tonight";
	}
	if (item.addedDate.includes("d")) {
		return "Freshly queued";
	}
	if (["Podcast", "Music"].includes(item.type)) {
		return "Low-friction pick";
	}
	if (["Show", "Anime"].includes(item.type)) {
		return "Easy to resume";
	}
	if (["Book", "Manga"].includes(item.type)) {
		return "Settle in with this";
	}
	return "Waiting in the wings";
}

function getSectionBackground(props: {
	accent: string;
	isDark: boolean;
	surface: string;
}) {
	if (props.isDark) {
		return `linear-gradient(180deg, ${withAlpha(props.accent, 0.18)} 0%, ${props.surface} 22%, ${props.surface} 100%)`;
	}
	return `linear-gradient(180deg, ${withAlpha(props.accent, 0.08)} 0%, ${withAlpha(props.accent, 0.03)} 18%, ${props.surface} 40%, ${props.surface} 100%)`;
}

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

function SectionHeader(props: {
	accentColor: string;
	eyebrow?: string;
	title: string;
	right?: React.ReactNode;
	textPrimary: string;
	textMuted: string;
}) {
	return (
		<Group justify="space-between" align="flex-end" mb="md" gap="sm">
			<Stack gap={4}>
				{props.eyebrow ? (
					<Group gap={8}>
						<Box
							w={18}
							h={2}
							style={{
								borderRadius: 999,
								backgroundColor: props.accentColor,
							}}
						/>
						<Text
							fz={10}
							fw={700}
							c={props.accentColor}
							ff="var(--mantine-headings-font-family)"
							tt="uppercase"
							style={{ letterSpacing: "1px" }}
						>
							{props.eyebrow}
						</Text>
					</Group>
				) : null}
				<Text
					ff="var(--mantine-headings-font-family)"
					fw={700}
					fz="xl"
					c={props.textPrimary}
					lh={1.1}
				>
					{props.title}
				</Text>
			</Stack>
			{props.right ? <Box>{props.right}</Box> : null}
		</Group>
	);
}

function SectionFrame(props: {
	accentColor: string;
	children: React.ReactNode;
	border: string;
	isDark: boolean;
	surface: string;
}) {
	return (
		<Paper
			p="md"
			radius="sm"
			style={{
				background: getSectionBackground({
					accent: props.accentColor,
					isDark: props.isDark,
					surface: props.surface,
				}),
				border: `1px solid ${props.border}`,
				boxShadow: props.isDark
					? `0 12px 32px ${withAlpha("#000000", 0.22)}`
					: `0 10px 30px ${withAlpha(props.accentColor, 0.08)}`,
				overflow: "hidden",
				position: "relative",
			}}
		>
			<Box
				style={{
					background: `linear-gradient(90deg, ${props.accentColor} 0%, ${withAlpha(props.accentColor, 0)} 100%)`,
					height: 3,
					left: 0,
					top: 0,
					position: "absolute",
					width: "100%",
				}}
			/>
			{props.children}
		</Paper>
	);
}

function Artwork(props: {
	height: number;
	note?: string;
	radius?: number;
	title: string;
	type: MediaType;
	url?: string;
	width?: number;
}) {
	const [hasError, setHasError] = useState(!props.url);
	const color = TYPE_COLORS[props.type];
	const Icon = TYPE_ICONS[props.type];

	return (
		<Box
			w={props.width}
			h={props.height}
			style={{
				background: `linear-gradient(160deg, ${withAlpha(color, 0.2)} 0%, ${withAlpha(STONE, 0.08)} 100%)`,
				borderRadius: props.radius ?? 8,
				overflow: "hidden",
				position: "relative",
			}}
		>
			{props.url && !hasError ? (
				<Box
					component="img"
					src={props.url}
					alt={props.title}
					w="100%"
					h="100%"
					onError={() => setHasError(true)}
					style={{ objectFit: "cover" }}
				/>
			) : (
				<Stack
					gap={8}
					align="center"
					justify="center"
					h="100%"
					p="sm"
					style={{
						background: `linear-gradient(180deg, ${withAlpha(color, 0.28)} 0%, ${withAlpha(STONE, 0.08)} 100%)`,
					}}
				>
					<ThemeIcon
						size={32}
						radius="xl"
						variant="light"
						style={{
							backgroundColor: withAlpha(color, 0.16),
							color,
						}}
					>
						<Icon size={16} />
					</ThemeIcon>
					<Text
						fz={10}
						fw={600}
						c={withAlpha("#2D241D", 0.84)}
						ff="var(--mantine-headings-font-family)"
						ta="center"
						lineClamp={3}
					>
						{props.title}
					</Text>
				</Stack>
			)}

			<Box
				style={{
					background:
						"linear-gradient(180deg, rgba(0, 0, 0, 0) 45%, rgba(0, 0, 0, 0.6) 100%)",
					inset: 0,
					position: "absolute",
				}}
			/>
			{props.note ? (
				<Badge
					size="xs"
					variant="filled"
					style={{
						backgroundColor: withAlpha("#201812", 0.72),
						bottom: 8,
						color: "white",
						left: 8,
						position: "absolute",
					}}
				>
					{props.note}
				</Badge>
			) : null}
		</Box>
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
				background: `linear-gradient(180deg, ${withAlpha(color, 0.08)} 0%, ${props.surface} 34%, ${props.surface} 100%)`,
				border: `1px solid ${props.border}`,
				boxShadow: `0 10px 24px ${withAlpha(color, 0.08)}`,
				overflow: "hidden",
			}}
			styles={{
				root: {
					"&:hover": {
						background: `linear-gradient(180deg, ${withAlpha(color, 0.1)} 0%, ${props.surfaceHover} 30%, ${props.surfaceHover} 100%)`,
						transform: "translateY(-2px)",
					},
					transition: "all 0.18s ease",
				},
			}}
		>
			<Group gap={0} align="stretch" wrap="nowrap">
				<Artwork
					height={132}
					note={pct !== null ? `${pct}% done` : props.item.unit}
					radius={0}
					title={props.item.title}
					type={props.item.type}
					url={props.item.coverUrl}
					width={84}
				/>
				<Stack gap={8} p="sm" style={{ flex: 1, minWidth: 0 }}>
					<Group gap={6} wrap="nowrap">
						<Badge
							size="xs"
							variant="light"
							style={{
								backgroundColor: withAlpha(color, 0.12),
								color,
							}}
						>
							{props.item.type}
						</Badge>
						<Text
							fz={10}
							c={props.textMuted}
							ff="var(--mantine-headings-font-family)"
							tt="uppercase"
							style={{ letterSpacing: "0.8px" }}
						>
							Resume
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
							{pct !== null ? (
								<Text
									fz={10}
									ff="var(--mantine-font-family-monospace)"
									fw={600}
									c={color}
								>
									{pct}%
								</Text>
							) : null}
						</Group>
						{pct !== null ? (
							<Progress
								value={pct}
								size={5}
								radius="xl"
								color={color}
								bg={props.border}
							/>
						) : null}
					</Box>

					<Button
						size="compact-xs"
						variant="light"
						mt={4}
						leftSection={<Play size={10} />}
						style={{
							alignSelf: "flex-start",
							backgroundColor: withAlpha(color, 0.12),
							border: "none",
							color,
						}}
						onClick={() =>
							console.log(
								`[builtin-tracker] ${props.item.actionLabel}:`,
								props.item.title,
							)
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
	surfaceHover: string;
	border: string;
	textPrimary: string;
	textMuted: string;
	rank: number;
}) {
	const color = TYPE_COLORS[props.item.type];
	const note = getQueueNote(props.item, props.rank);

	return (
		<UnstyledButton
			onClick={() => console.log("[builtin-tracker] Start:", props.item.title)}
			style={{ flexShrink: 0 }}
		>
			<Paper
				w={164}
				radius="sm"
				style={{
					background: `linear-gradient(180deg, ${withAlpha(color, 0.08)} 0%, ${props.surface} 26%, ${props.surface} 100%)`,
					border: `1px solid ${props.border}`,
					boxShadow: `0 10px 26px ${withAlpha(color, 0.08)}`,
					overflow: "hidden",
				}}
				styles={{
					root: {
						"&:hover": {
							background: `linear-gradient(180deg, ${withAlpha(color, 0.1)} 0%, ${props.surfaceHover} 24%, ${props.surfaceHover} 100%)`,
							transform: "translateY(-2px)",
						},
						transition: "all 0.18s ease",
					},
				}}
			>
				<Box p={8} pb={0} style={{ position: "relative" }}>
					<Artwork
						height={220}
						note={note}
						title={props.item.title}
						type={props.item.type}
						url={props.item.coverUrl}
					/>
					<Badge
						size="xs"
						variant="light"
						style={{
							backgroundColor: withAlpha(color, 0.12),
							color,
							left: 14,
							position: "absolute",
							top: 14,
						}}
					>
						{props.item.type}
					</Badge>
				</Box>
				<Stack gap={4} p="sm" pt="xs">
					<Text
						fz={10}
						fw={700}
						c={color}
						ff="var(--mantine-headings-font-family)"
						tt="uppercase"
						style={{ letterSpacing: "0.9px" }}
					>
						{note}
					</Text>
					<Text
						ff="var(--mantine-headings-font-family)"
						fw={600}
						fz="sm"
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
	surfaceHover: string;
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
				background: `linear-gradient(180deg, ${withAlpha(GOLD, 0.09)} 0%, ${props.surface} 34%, ${props.surface} 100%)`,
				border: `1px solid ${props.border}`,
				boxShadow: `0 10px 26px ${withAlpha(GOLD, 0.08)}`,
				overflow: "hidden",
			}}
			styles={{
				root: {
					"&:hover": {
						background: `linear-gradient(180deg, ${withAlpha(GOLD, 0.11)} 0%, ${props.surfaceHover} 34%, ${props.surfaceHover} 100%)`,
						transform: "translateY(-2px)",
					},
					transition: "all 0.18s ease",
				},
			}}
		>
			<Box h={3} bg={GOLD} />
			<Group gap="sm" wrap="nowrap" p="sm">
				<Artwork
					height={86}
					radius={8}
					title={props.item.title}
					type={props.item.type}
					url={props.item.coverUrl}
					width={64}
				/>
				<Stack gap={4} style={{ flex: 1, minWidth: 0 }}>
					<Group gap={6}>
						<Badge
							size="xs"
							variant="light"
							style={{ backgroundColor: withAlpha(color, 0.12), color }}
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
					<Group
						gap={4}
						mt={2}
						px={6}
						py={5}
						style={{
							alignSelf: "flex-start",
							backgroundColor: withAlpha(GOLD, 0.08),
							borderRadius: 999,
						}}
					>
						{[1, 2, 3, 4, 5].map((star) => (
							<Tooltip key={star} label={`${star} star${star > 1 ? "s" : ""}`}>
								<ActionIcon
									size="sm"
									variant="transparent"
									onMouseEnter={() => setHovered(star)}
									onMouseLeave={() => setHovered(0)}
									onClick={() => {
										setSelected(star);
										console.log(
											`[builtin-tracker] Rate "${props.item.title}": ${star} stars`,
										);
									}}
								>
									<Star
										size={18}
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
								ml={2}
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
	accentColor: string;
	border: string;
	textPrimary: string;
	textMuted: string;
}) {
	const maxCount = Math.max(...props.days.map((d) => d.count), 1);
	const activeDays = props.days.filter((day) => day.count > 0).length;

	return (
		<Stack gap="md">
			<Group justify="space-between" align="flex-start" gap="sm">
				<Stack gap={4}>
					<Text
						fz={10}
						fw={700}
						c={props.accentColor}
						ff="var(--mantine-headings-font-family)"
						tt="uppercase"
						style={{ letterSpacing: "1px" }}
					>
						Weekly rhythm
					</Text>
					<Text
						ff="var(--mantine-headings-font-family)"
						fw={600}
						fz="sm"
						c={props.textPrimary}
					>
						You showed up {activeDays} of 7 days.
					</Text>
				</Stack>
				<Text fz="xs" c={props.textMuted}>
					{LIBRARY_STATS.thisWeekCompleted} completed &middot;{" "}
					{LIBRARY_STATS.thisWeekHours}h tracked
				</Text>
			</Group>
			<Group gap="xs" justify="space-between">
				{props.days.map((day) => {
					const h = day.count > 0 ? 10 + (day.count / maxCount) * 28 : 6;
					return (
						<Stack key={day.day} gap={4} align="center" style={{ flex: 1 }}>
							<Tooltip
								label={`${day.count} event${day.count !== 1 ? "s" : ""}`}
							>
								<Box
									w="100%"
									h={h}
									style={{
										borderRadius: 999,
										backgroundColor:
											day.count > 0 ? props.accentColor : `${props.border}`,
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
		</Stack>
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
			py={10}
			style={{
				borderBottom: props.isLast ? "none" : `1px solid ${props.border}`,
				borderLeft: `3px solid ${color}`,
				paddingLeft: 12,
			}}
		>
			<Artwork
				height={48}
				radius={6}
				title={props.event.title}
				type={props.event.type}
				url={props.event.coverUrl}
				width={36}
			/>
			<Stack gap={2} style={{ flex: 1, minWidth: 0 }}>
				<Text
					ff="var(--mantine-headings-font-family)"
					fw={600}
					fz="sm"
					c={props.textPrimary}
					lineClamp={1}
				>
					{props.event.title}
				</Text>
				<Group gap={6} wrap="wrap">
					<Badge
						size="xs"
						variant="light"
						style={{ backgroundColor: withAlpha(color, 0.12), color }}
					>
						{props.event.type}
					</Badge>
					<Text fz={10} fw={600} c={color}>
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
			py="sm"
			radius="sm"
			style={{
				background: `linear-gradient(180deg, ${withAlpha(props.color ?? STONE, 0.08)} 0%, ${props.surface} 100%)`,
				border: `1px solid ${props.border}`,
				borderTop: `3px solid ${props.color ?? STONE}`,
			}}
		>
			<Text
				fz={10}
				c={props.textMuted}
				fw={700}
				ff="var(--mantine-headings-font-family)"
				tt="uppercase"
				style={{ letterSpacing: "0.9px" }}
			>
				{props.label}
			</Text>
			<Text
				ff="var(--mantine-font-family-monospace)"
				fw={700}
				fz="xl"
				c={props.color ?? props.textPrimary}
				lh={1.2}
				mt={6}
			>
				{props.value}
			</Text>
			<Text fz={10} c={props.textMuted} fw={500} mt={2}>
				In your library
			</Text>
		</Paper>
	);
}

interface BuiltinMediaTrackerOverviewProps {
	tracker: AppTracker;
}

export function BuiltinMediaTrackerOverview(
	props: BuiltinMediaTrackerOverviewProps,
) {
	const t = useThemeTokens();
	const entitySchemasQuery = useEntitySchemasQuery(props.tracker.id, true);

	const searchableSchemas = entitySchemasQuery.entitySchemas.filter(
		(s) => s.searchProviders.length > 0,
	);
	const typePickerModalId = `builtin-media-type-picker-${props.tracker.id}`;

	const openSearchModal = (schema: AppEntitySchema) => {
		const searchModalId = `builtin-media-search-${props.tracker.id}-${schema.id}`;

		modals.open({
			size: "lg",
			centered: true,
			modalId: searchModalId,
			overlayProps: { backgroundOpacity: 0.55, blur: 3 },
			children: <SearchEntityModalContent entitySchema={schema} />,
			title: (
				<SearchEntityModalTitle
					entitySchemaName={schema.name}
					onBack={() => modals.close(searchModalId)}
				/>
			),
		});
	};

	const openTypePickerModal = () => {
		modals.open({
			size: "lg",
			centered: true,
			modalId: typePickerModalId,
			overlayProps: { backgroundOpacity: 0.55, blur: 3 },
			title: (
				<Text ff="var(--mantine-headings-font-family)" fw={600} fz="md">
					Add to Media
				</Text>
			),
			children: (
				<SimpleGrid cols={{ base: 3, sm: 4 }} spacing="sm">
					{searchableSchemas.map((schema) => {
						return (
							<UnstyledButton
								key={schema.id}
								onClick={() => openSearchModal(schema)}
							>
								<Paper
									p="md"
									ta="center"
									radius="sm"
									style={{
										cursor: "pointer",
										background: t.surface,
										border: `1px solid ${t.border}`,
										transition: "border-color 0.15s ease",
									}}
								>
									<Stack gap={6} align="center">
										<TrackerIcon
											size={24}
											icon={schema.icon}
											color={schema.accentColor}
										/>
										<Text
											fz="xs"
											fw={600}
											c={t.textPrimary}
											ff="var(--mantine-headings-font-family)"
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
			),
		});
	};

	if (entitySchemasQuery.isLoading) {
		return (
			<Center h={400}>
				<Loader />
			</Center>
		);
	}

	if (entitySchemasQuery.isError) {
		return (
			<Paper p="lg" withBorder>
				<Text c="red">Failed to load entity schemas</Text>
			</Paper>
		);
	}

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
	const weekTotalEvents = WEEK_ACTIVITY.reduce(
		(total, day) => total + day.count,
		0,
	);

	return (
		<Stack gap="xl">
			<Group justify="space-between" align="flex-end" gap="sm">
				<Stack gap={6} maw={640}>
					<Text
						lh={1}
						fz={30}
						fw={700}
						c={t.textPrimary}
						ff="var(--mantine-headings-font-family)"
					>
						Media
					</Text>
					<Group gap="xs" wrap="wrap">
						<Badge
							variant="light"
							style={{
								color: SECTION_ACCENTS.continue,
								backgroundColor: withAlpha(SECTION_ACCENTS.continue, 0.12),
							}}
						>
							{IN_PROGRESS.length} in progress
						</Badge>
						<Badge
							variant="light"
							style={{
								color: SECTION_ACCENTS.queue,
								backgroundColor: withAlpha(SECTION_ACCENTS.queue, 0.12),
							}}
						>
							{BACKLOG.length} queued next
						</Badge>
						<Badge
							variant="light"
							style={{
								color: SECTION_ACCENTS.review,
								backgroundColor: withAlpha(SECTION_ACCENTS.review, 0.12),
							}}
						>
							{UNRATED.length} still unrated
						</Badge>
					</Group>
				</Stack>
				<Button
					size="sm"
					leftSection={<Plus size={14} />}
					onClick={openTypePickerModal}
					style={{ backgroundColor: GOLD, color: "white" }}
				>
					Add media
				</Button>
			</Group>

			<SectionFrame
				border={t.border}
				isDark={t.isDark}
				surface={t.surface}
				accentColor={SECTION_ACCENTS.continue}
			>
				<SectionHeader
					title="Continue"
					eyebrow="In motion"
					textMuted={t.textMuted}
					textPrimary={t.textPrimary}
					accentColor={SECTION_ACCENTS.continue}
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
							item={item}
							key={item.id}
							border={t.border}
							surface={t.surface}
							textMuted={t.textMuted}
							textPrimary={t.textPrimary}
							surfaceHover={t.surfaceHover}
						/>
					))}
				</SimpleGrid>
				{IN_PROGRESS.length > 6 ? (
					<UnstyledButton
						mt="sm"
						onClick={() =>
							console.log("[builtin-tracker] View all in-progress")
						}
					>
						<Group gap={4}>
							<Text fz="xs" fw={500} c={GOLD}>
								View all {IN_PROGRESS.length} in progress
							</Text>
							<ChevronRight size={12} color={GOLD} />
						</Group>
					</UnstyledButton>
				) : null}
			</SectionFrame>

			<SectionFrame
				border={t.border}
				isDark={t.isDark}
				surface={t.surface}
				accentColor={SECTION_ACCENTS.queue}
			>
				<SectionHeader
					title="Up Next"
					textMuted={t.textMuted}
					textPrimary={t.textPrimary}
					eyebrow="Queued with intent"
					accentColor={SECTION_ACCENTS.queue}
					right={
						<Text fz="xs" c={t.textMuted}>
							{BACKLOG.length} queued
						</Text>
					}
				/>
				<ScrollArea scrollbarSize={4} type="hover">
					<Group gap="sm" wrap="nowrap" pb={4}>
						{BACKLOG.map((item, index) => (
							<BacklogCard
								item={item}
								rank={index}
								key={item.id}
								border={t.border}
								surface={t.surface}
								textMuted={t.textMuted}
								textPrimary={t.textPrimary}
								surfaceHover={t.surfaceHover}
							/>
						))}
					</Group>
				</ScrollArea>
			</SectionFrame>

			{UNRATED.length > 0 && (
				<SectionFrame
					border={t.border}
					isDark={t.isDark}
					surface={t.surface}
					accentColor={SECTION_ACCENTS.review}
				>
					<SectionHeader
						title="Rate These"
						eyebrow="Leave a trace"
						textMuted={t.textMuted}
						textPrimary={t.textPrimary}
						accentColor={SECTION_ACCENTS.review}
						right={
							<Text fz="xs" c={t.textMuted}>
								{UNRATED.length} unrated
							</Text>
						}
					/>
					<SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="sm">
						{UNRATED.map((item) => (
							<RateCard
								item={item}
								key={item.id}
								border={t.border}
								surface={t.surface}
								textMuted={t.textMuted}
								textPrimary={t.textPrimary}
								surfaceHover={t.surfaceHover}
							/>
						))}
					</SimpleGrid>
				</SectionFrame>
			)}

			<SectionFrame
				border={t.border}
				isDark={t.isDark}
				surface={t.surface}
				accentColor={SECTION_ACCENTS.activity}
			>
				<SectionHeader
					title="Activity"
					eyebrow="Recent rhythm"
					textMuted={t.textMuted}
					textPrimary={t.textPrimary}
					accentColor={SECTION_ACCENTS.activity}
					right={
						<UnstyledButton
							onClick={() =>
								console.log("[builtin-tracker] View full activity log")
							}
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
				<Paper
					p="md"
					radius="sm"
					style={{
						border: `1px solid ${t.border}`,
						background: `linear-gradient(180deg, ${withAlpha(SECTION_ACCENTS.activity, 0.08)} 0%, ${t.surface} 18%, ${t.surface} 100%)`,
					}}
				>
					<WeekStrip
						border={t.border}
						days={WEEK_ACTIVITY}
						textMuted={t.textMuted}
						textPrimary={t.textPrimary}
						accentColor={SECTION_ACCENTS.activity}
					/>
					<Group gap="xs" mt="md" mb="sm">
						<Badge
							variant="light"
							style={{
								color: SECTION_ACCENTS.activity,
								backgroundColor: withAlpha(SECTION_ACCENTS.activity, 0.12),
							}}
						>
							{weekTotalEvents} events this week
						</Badge>
					</Group>
					<Box pt="md" style={{ borderTop: `1px solid ${t.border}` }}>
						{Object.entries(dateGroups).map(([date, events]) => (
							<Box key={date}>
								<Text
									mb={6}
									fz={10}
									fw={700}
									tt="uppercase"
									c={t.textMuted}
									style={{ letterSpacing: "1px" }}
									ff="var(--mantine-headings-font-family)"
								>
									{date}
								</Text>
								<Box px="xs">
									{events.map((event, i) => (
										<EventRow
											event={event}
											key={event.id}
											border={t.border}
											textMuted={t.textMuted}
											textPrimary={t.textPrimary}
											isLast={i === events.length - 1}
										/>
									))}
								</Box>
							</Box>
						))}
					</Box>
				</Paper>
			</SectionFrame>

			<SectionFrame
				border={t.border}
				isDark={t.isDark}
				surface={t.surface}
				accentColor={SECTION_ACCENTS.library}
			>
				<SectionHeader
					title="Library"
					eyebrow="At a glance"
					textMuted={t.textMuted}
					textPrimary={t.textPrimary}
					accentColor={SECTION_ACCENTS.library}
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
							border={t.border}
							surface={t.surface}
							textMuted={t.textMuted}
							value={LIBRARY_STATS.total}
							textPrimary={t.textPrimary}
						/>
						<StatChip
							label="Active"
							color="#5B7FFF"
							border={t.border}
							surface={t.surface}
							textMuted={t.textMuted}
							textPrimary={t.textPrimary}
							value={LIBRARY_STATS.active}
						/>
						<StatChip
							color="#5B8A5F"
							border={t.border}
							label="Completed"
							surface={t.surface}
							textMuted={t.textMuted}
							textPrimary={t.textPrimary}
							value={LIBRARY_STATS.completed}
						/>
						<StatChip
							color={GOLD}
							label="Avg Rating"
							border={t.border}
							surface={t.surface}
							textMuted={t.textMuted}
							textPrimary={t.textPrimary}
							value={LIBRARY_STATS.avgRating.toFixed(1)}
						/>
						<StatChip
							color="#E09840"
							label="On Hold"
							border={t.border}
							surface={t.surface}
							textMuted={t.textMuted}
							textPrimary={t.textPrimary}
							value={LIBRARY_STATS.onHold}
						/>
					</SimpleGrid>
					<Paper
						p="md"
						radius="sm"
						style={{
							border: `1px solid ${t.border}`,
							background: `linear-gradient(180deg, ${withAlpha(SECTION_ACCENTS.library, 0.06)} 0%, ${t.surface} 100%)`,
						}}
					>
						<Text
							mb="xs"
							fz="xs"
							fw={600}
							c={t.textMuted}
							ff="var(--mantine-headings-font-family)"
						>
							By Type
						</Text>
						<TypeBar
							border={t.border}
							types={TYPE_COUNTS}
							textMuted={t.textMuted}
							total={LIBRARY_STATS.total}
						/>
					</Paper>
				</Stack>
			</SectionFrame>
		</Stack>
	);
}
