// V5: Dashboard-first with journal-grouped activity.
// Combines V1's widget-surface structure with V3's date-grouped activity feed.
// Soul doc component patterns: 3px top-border stat cards, left-border accent bars
// on activity entries, tracker-colored badges, compact density.

import {
	Box,
	Button,
	Container,
	Group,
	Menu,
	Paper,
	SimpleGrid,
	Stack,
	Text,
} from "@mantine/core";
import { createFileRoute } from "@tanstack/react-router";
import { ChevronDown, Plus } from "lucide-react";
import { useThemeTokens } from "#/hooks/theme";

export const Route = createFileRoute("/_protected/labs/media-overview/v5")({
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

interface MediaItem {
	id: string;
	sub: string;
	type: MediaType;
	title: string;
	status: string;
	coverUrl: string;
	rating: number | null;
}

interface JournalEntry {
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

const MEDIA_TYPES: MediaType[] = [
	"Book",
	"Show",
	"Movie",
	"Anime",
	"Manga",
	"Music",
	"Podcast",
	"AudioBook",
	"VideoGame",
	"ComicBook",
	"VisualNovel",
];

const TYPE_COLORS: Record<string, string> = {
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

const ACTIVE_STATUSES = new Set([
	"reading",
	"watching",
	"listening",
	"playing",
]);

const ALL_MEDIA: MediaItem[] = [
	{
		id: "b1",
		type: "Book",
		title: "Where Have All the Leaders Gone?",
		sub: "Lee Iacocca",
		status: "completed",
		rating: 4,
		coverUrl: "https://covers.openlibrary.org/b/id/8739161-L.jpg",
	},
	{
		id: "b2",
		type: "Book",
		title: "The Wind Is Never Gone",
		sub: "Sally Mandel",
		status: "reading",
		rating: null,
		coverUrl: "https://covers.openlibrary.org/b/id/240726-L.jpg",
	},
	{
		id: "b3",
		type: "Book",
		title: "What to Do When I'm Gone",
		sub: "Suzy Hopkins",
		status: "reading",
		rating: null,
		coverUrl: "https://covers.openlibrary.org/b/id/10527831-L.jpg",
	},
	{
		id: "b4",
		type: "Book",
		title: "The Name of the Wind",
		sub: "Patrick Rothfuss",
		status: "on_hold",
		rating: 5,
		coverUrl: "https://covers.openlibrary.org/b/id/9256378-L.jpg",
	},
	{
		id: "s1",
		type: "Show",
		title: "Breaking Bad",
		sub: "Vince Gilligan",
		status: "watching",
		rating: null,
		coverUrl: "https://image.tmdb.org/t/p/w500/ggFHVNu6YYI5L9pCfOacjizRGt.jpg",
	},
	{
		id: "s2",
		type: "Show",
		title: "The Wire",
		sub: "David Simon",
		status: "completed",
		rating: 5,
		coverUrl: "https://image.tmdb.org/t/p/w500/4lkAHCDkH7KEELKBEMdFf7EGXcb.jpg",
	},
	{
		id: "s3",
		type: "Show",
		title: "Severance",
		sub: "Dan Erickson",
		status: "on_hold",
		rating: null,
		coverUrl: "https://image.tmdb.org/t/p/w500/oNF5oacaZFXMjGC8fWOTvmDCxLr.jpg",
	},
	{
		id: "mv1",
		type: "Movie",
		title: "Dune: Part Two",
		sub: "Denis Villeneuve",
		status: "completed",
		rating: 5,
		coverUrl: "https://image.tmdb.org/t/p/w500/1pdfLvkbY9ohJlCjQH2CZjjYVvJ.jpg",
	},
	{
		id: "mv2",
		type: "Movie",
		title: "Oppenheimer",
		sub: "Christopher Nolan",
		status: "completed",
		rating: 4,
		coverUrl: "https://image.tmdb.org/t/p/w500/8Gxv8gSFCU0XGDykEGv7zR1n2ua.jpg",
	},
	{
		id: "mv3",
		type: "Movie",
		title: "Poor Things",
		sub: "Yorgos Lanthimos",
		status: "completed",
		rating: 5,
		coverUrl: "https://image.tmdb.org/t/p/w500/kCGlIMHnOm8JPXIwwzwrznhIiIT.jpg",
	},
	{
		id: "a1",
		type: "Anime",
		title: "Frieren: Beyond Journey's End",
		sub: "Madhouse",
		status: "completed",
		rating: 5,
		coverUrl: "https://cdn.myanimelist.net/images/anime/1015/138006.jpg",
	},
	{
		id: "a2",
		type: "Anime",
		title: "Dungeon Meshi",
		sub: "Studio Trigger",
		status: "watching",
		rating: null,
		coverUrl: "https://cdn.myanimelist.net/images/anime/1628/140081.jpg",
	},
	{
		id: "a3",
		type: "Anime",
		title: "Solo Leveling",
		sub: "A-1 Pictures",
		status: "watching",
		rating: null,
		coverUrl: "https://cdn.myanimelist.net/images/anime/1258/135739.jpg",
	},
	{
		id: "m1",
		type: "Manga",
		title: "Berserk",
		sub: "Kentaro Miura",
		status: "on_hold",
		rating: 5,
		coverUrl: "https://cdn.myanimelist.net/images/manga/1/157897.jpg",
	},
	{
		id: "m2",
		type: "Manga",
		title: "Vagabond",
		sub: "Takehiko Inoue",
		status: "reading",
		rating: null,
		coverUrl: "https://cdn.myanimelist.net/images/manga/3/116498.jpg",
	},
	{
		id: "mu1",
		type: "Music",
		title: "Kind of Blue",
		sub: "Miles Davis",
		status: "completed",
		rating: 5,
		coverUrl:
			"https://upload.wikimedia.org/wikipedia/commons/thumb/4/4b/KindofBlue.jpg/300px-KindofBlue.jpg",
	},
	{
		id: "mu2",
		type: "Music",
		title: "Random Access Memories",
		sub: "Daft Punk",
		status: "completed",
		rating: 5,
		coverUrl:
			"https://upload.wikimedia.org/wikipedia/en/a/a7/Random_Access_Memories.jpg",
	},
	{
		id: "mu3",
		type: "Music",
		title: "In Rainbows",
		sub: "Radiohead",
		status: "listening",
		rating: null,
		coverUrl:
			"https://upload.wikimedia.org/wikipedia/en/3/3e/In_Rainbows_Official_Cover.jpg",
	},
	{
		id: "p1",
		type: "Podcast",
		title: "Lex Fridman Podcast",
		sub: "Lex Fridman",
		status: "listening",
		rating: null,
		coverUrl:
			"https://images.unsplash.com/photo-1478737270239-2f02b77fc618?w=300&fit=crop",
	},
	{
		id: "p2",
		type: "Podcast",
		title: "The Knowledge Project",
		sub: "Shane Parrish",
		status: "on_hold",
		rating: null,
		coverUrl:
			"https://images.unsplash.com/photo-1478737270239-2f02b77fc618?w=300&fit=crop",
	},
	{
		id: "ab1",
		type: "AudioBook",
		title: "Atomic Habits",
		sub: "James Clear",
		status: "completed",
		rating: 4,
		coverUrl: "https://m.media-amazon.com/images/I/513Y5o-DYtL.jpg",
	},
	{
		id: "ab2",
		type: "AudioBook",
		title: "The Pragmatic Programmer",
		sub: "David Thomas",
		status: "listening",
		rating: null,
		coverUrl: "https://m.media-amazon.com/images/I/41BKx1AxQWL.jpg",
	},
	{
		id: "vg1",
		type: "VideoGame",
		title: "Elden Ring",
		sub: "FromSoftware",
		status: "completed",
		rating: 5,
		coverUrl:
			"https://images.igdb.com/igdb/image/upload/t_cover_big/co4jni.jpg",
	},
	{
		id: "vg2",
		type: "VideoGame",
		title: "Hollow Knight",
		sub: "Team Cherry",
		status: "completed",
		rating: 5,
		coverUrl:
			"https://images.igdb.com/igdb/image/upload/t_cover_big/co3p2d.jpg",
	},
	{
		id: "vg3",
		type: "VideoGame",
		title: "Celeste",
		sub: "Maddy Thorson",
		status: "on_hold",
		rating: 4,
		coverUrl:
			"https://images.igdb.com/igdb/image/upload/t_cover_big/co1tmu.jpg",
	},
	{
		id: "cb1",
		type: "ComicBook",
		title: "Watchmen",
		sub: "Alan Moore",
		status: "completed",
		rating: 5,
		coverUrl:
			"https://upload.wikimedia.org/wikipedia/en/a/a2/Watchmen%2C_issue_1.jpg",
	},
	{
		id: "cb2",
		type: "ComicBook",
		title: "The Sandman",
		sub: "Neil Gaiman",
		status: "reading",
		rating: null,
		coverUrl:
			"https://upload.wikimedia.org/wikipedia/en/f/f5/SandmanIssue1.jpg",
	},
	{
		id: "vn1",
		type: "VisualNovel",
		title: "Steins;Gate",
		sub: "5pb. / Nitroplus",
		status: "completed",
		rating: 5,
		coverUrl: "https://cdn.myanimelist.net/images/anime/5/73199.jpg",
	},
	{
		id: "vn2",
		type: "VisualNovel",
		title: "Clannad",
		sub: "Key / Visual Arts",
		status: "reading",
		rating: null,
		coverUrl: "https://cdn.myanimelist.net/images/anime/1811/97462.jpg",
	},
];

const JOURNAL: JournalEntry[] = [
	{
		id: "j1",
		date: "Today",
		time: "7h ago",
		type: "Book",
		title: "Where Have All the Leaders Gone?",
		sub: "Lee Iacocca",
		action: "Completed",
		coverUrl: "https://covers.openlibrary.org/b/id/8739161-L.jpg",
		rating: 4,
	},
	{
		id: "j2",
		date: "Today",
		time: "7h ago",
		type: "Book",
		title: "The Wind Is Never Gone",
		sub: "Sally Mandel",
		action: "Started reading",
		coverUrl: "https://covers.openlibrary.org/b/id/240726-L.jpg",
		rating: null,
	},
	{
		id: "j3",
		date: "Today",
		time: "11h ago",
		type: "Music",
		title: "In Rainbows",
		sub: "Radiohead",
		action: "Started listening",
		coverUrl:
			"https://upload.wikimedia.org/wikipedia/en/3/3e/In_Rainbows_Official_Cover.jpg",
		rating: null,
	},
	{
		id: "j4",
		date: "Yesterday",
		time: "Yesterday",
		type: "Anime",
		title: "Frieren: Beyond Journey's End",
		sub: "28 of 28 episodes",
		action: "Finished",
		coverUrl: "https://cdn.myanimelist.net/images/anime/1015/138006.jpg",
		rating: 5,
	},
	{
		id: "j5",
		date: "Yesterday",
		time: "Yesterday",
		type: "AudioBook",
		title: "The Pragmatic Programmer",
		sub: "David Thomas",
		action: "Started listening",
		coverUrl: "https://m.media-amazon.com/images/I/41BKx1AxQWL.jpg",
		rating: null,
	},
	{
		id: "j6",
		date: "Yesterday",
		time: "Yesterday",
		type: "Anime",
		title: "Dungeon Meshi",
		sub: "12 of 24 episodes",
		action: "Watched episode 12",
		coverUrl: "https://cdn.myanimelist.net/images/anime/1628/140081.jpg",
		rating: null,
	},
	{
		id: "j7",
		date: "2 days ago",
		time: "2d ago",
		type: "Book",
		title: "The Name of the Wind",
		sub: "Patrick Rothfuss",
		action: "Put on hold",
		coverUrl: "https://covers.openlibrary.org/b/id/9256378-L.jpg",
		rating: null,
	},
	{
		id: "j8",
		date: "2 days ago",
		time: "2d ago",
		type: "VideoGame",
		title: "Elden Ring",
		sub: "FromSoftware",
		action: "Completed",
		coverUrl:
			"https://images.igdb.com/igdb/image/upload/t_cover_big/co4jni.jpg",
		rating: 5,
	},
	{
		id: "j9",
		date: "3 days ago",
		time: "3d ago",
		type: "Podcast",
		title: "Lex Fridman Podcast",
		sub: "Lex Fridman",
		action: "Listened to episode",
		coverUrl:
			"https://images.unsplash.com/photo-1478737270239-2f02b77fc618?w=300&fit=crop",
		rating: null,
	},
	{
		id: "j10",
		date: "1 week ago",
		time: "1w ago",
		type: "Movie",
		title: "Dune: Part Two",
		sub: "Denis Villeneuve",
		action: "Watched",
		coverUrl: "https://image.tmdb.org/t/p/w500/1pdfLvkbY9ohJlCjQH2CZjjYVvJ.jpg",
		rating: 5,
	},
	{
		id: "j11",
		date: "1 week ago",
		time: "1w ago",
		type: "ComicBook",
		title: "The Sandman",
		sub: "Neil Gaiman",
		action: "Started reading",
		coverUrl:
			"https://upload.wikimedia.org/wikipedia/en/f/f5/SandmanIssue1.jpg",
		rating: null,
	},
];

// --- Components ---

function StatCard(props: {
	label: string;
	value: number;
	color: string;
	surface: string;
	border: string;
	textMuted: string;
}) {
	return (
		<Paper
			p="md"
			radius="sm"
			style={{
				background: props.surface,
				border: `1px solid ${props.border}`,
				borderTop: `3px solid ${props.color}`,
			}}
		>
			<Text
				ff="var(--mantine-font-family-monospace)"
				fz={28}
				fw={700}
				c={props.color}
				lh={1}
			>
				{props.value}
			</Text>
			<Text
				ff="var(--mantine-headings-font-family)"
				fw={600}
				fz="sm"
				c={props.textMuted}
				mt={4}
			>
				{props.label}
			</Text>
		</Paper>
	);
}

function InProgressCard(props: {
	item: MediaItem;
	surface: string;
	border: string;
	textPrimary: string;
	textMuted: string;
}) {
	const typeColor = TYPE_COLORS[props.item.type] ?? GOLD;
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
					w={64}
					style={{
						flexShrink: 0,
						minHeight: 88,
						backgroundImage: `url(${props.item.coverUrl})`,
						backgroundSize: "cover",
						backgroundPosition: "center",
					}}
				/>
				<Stack gap={4} p="sm" style={{ flex: 1, minWidth: 0 }}>
					<Text
						fz={10}
						fw={600}
						c={typeColor}
						ff="var(--mantine-headings-font-family)"
						tt="uppercase"
						style={{ letterSpacing: "0.8px" }}
					>
						{props.item.type}
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
					<Text fz="xs" c={props.textMuted} lineClamp={1}>
						{props.item.sub}
					</Text>
				</Stack>
			</Group>
		</Paper>
	);
}

function ActivityEntry(props: {
	entry: JournalEntry;
	isLast: boolean;
	border: string;
	textPrimary: string;
	textMuted: string;
}) {
	const typeColor = TYPE_COLORS[props.entry.type] ?? GOLD;
	return (
		<Group
			gap="sm"
			wrap="nowrap"
			align="flex-start"
			py="xs"
			style={{
				borderBottom: props.isLast ? "none" : `1px solid ${props.border}`,
				borderLeft: `3px solid ${typeColor}`,
				paddingLeft: 12,
			}}
		>
			<Box
				w={36}
				h={48}
				style={{
					flexShrink: 0,
					borderRadius: 4,
					backgroundImage: `url(${props.entry.coverUrl})`,
					backgroundSize: "cover",
					backgroundPosition: "center",
				}}
			/>
			<Stack gap={2} style={{ flex: 1, minWidth: 0 }}>
				<Text
					ff="var(--mantine-headings-font-family)"
					fw={600}
					fz="sm"
					c={props.textPrimary}
					lineClamp={1}
				>
					{props.entry.title}
				</Text>
				<Group gap={6}>
					<Text fz="xs" fw={500} c={typeColor}>
						{props.entry.type}
					</Text>
					<Text fz="xs" c={props.textMuted}>
						·
					</Text>
					<Text fz="xs" c={props.textMuted}>
						{props.entry.action}
					</Text>
					{props.entry.rating !== null && (
						<Text fz="xs" ff="var(--mantine-font-family-monospace)" c={GOLD}>
							{"★".repeat(props.entry.rating)}
						</Text>
					)}
				</Group>
			</Stack>
			<Text
				fz="xs"
				c={props.textMuted}
				style={{ whiteSpace: "nowrap", flexShrink: 0 }}
			>
				{props.entry.time}
			</Text>
		</Group>
	);
}

function MiniBar(props: { value: number; color: string; track: string }) {
	return (
		<Box
			h={4}
			style={{ background: props.track, borderRadius: 2, overflow: "hidden" }}
		>
			<Box
				h="100%"
				w={`${props.value}%`}
				style={{ backgroundColor: props.color, borderRadius: 2 }}
			/>
		</Box>
	);
}

function RouteComponent() {
	const t = useThemeTokens();
	const bgPage = t.isDark
		? "var(--mantine-color-dark-8)"
		: "var(--mantine-color-stone-0)";
	const trackBar = t.isDark
		? "var(--mantine-color-dark-5)"
		: "var(--mantine-color-stone-2)";

	const inProgress = ALL_MEDIA.filter((i) => ACTIVE_STATUSES.has(i.status));
	const completed = ALL_MEDIA.filter((i) => i.status === "completed");
	const onHold = ALL_MEDIA.filter(
		(i) => i.status === "on_hold" || i.status === "dropped",
	);
	const typesTracked = new Set(ALL_MEDIA.map((i) => i.type)).size;

	const typeGroups: Record<string, MediaItem[]> = {};
	for (const item of ALL_MEDIA) {
		if (!typeGroups[item.type]) {
			typeGroups[item.type] = [];
		}
		typeGroups[item.type]!.push(item);
	}
	const categories = Object.entries(typeGroups)
		.map(([type, items]) => ({ type, items, color: TYPE_COLORS[type] ?? GOLD }))
		.sort((a, b) => b.items.length - a.items.length);

	const journalGrouped = JOURNAL.reduce<Record<string, JournalEntry[]>>(
		(acc, entry) => {
			if (!acc[entry.date]) {
				acc[entry.date] = [];
			}
			acc[entry.date]!.push(entry);
			return acc;
		},
		{},
	);
	const dateGroups = Object.entries(journalGrouped);

	return (
		<Box bg={bgPage} mih="100vh">
			<Container size="lg" py="xl">
				<Stack gap="xl">
					{/* Header */}
					<Group justify="space-between" align="flex-end">
						<Box>
							<Text
								ff="var(--mantine-headings-font-family)"
								fw={700}
								fz={28}
								c={t.textPrimary}
								lh={1.1}
							>
								My Media
							</Text>
							<Text fz="sm" c={t.textMuted} mt={4}>
								{ALL_MEDIA.length} entries across {typesTracked} media types
							</Text>
						</Box>
						<Menu position="bottom-end" width={180}>
							<Menu.Target>
								<Button
									size="sm"
									leftSection={<Plus size={14} />}
									rightSection={<ChevronDown size={12} />}
									style={{ backgroundColor: GOLD, color: "white" }}
								>
									Add Media
								</Button>
							</Menu.Target>
							<Menu.Dropdown>
								{MEDIA_TYPES.map((type) => (
									<Menu.Item key={type}>
										<Text fz="sm" c={TYPE_COLORS[type]}>
											{type}
										</Text>
									</Menu.Item>
								))}
							</Menu.Dropdown>
						</Menu>
					</Group>

					{/* Stat cards with 3px top border */}
					<SimpleGrid cols={{ base: 2, sm: 4 }} spacing="sm">
						<StatCard
							label="Total Entries"
							value={ALL_MEDIA.length}
							color={GOLD}
							surface={t.surface}
							border={t.border}
							textMuted={t.textMuted}
						/>
						<StatCard
							label="In Progress"
							value={inProgress.length}
							color="#5B7FFF"
							surface={t.surface}
							border={t.border}
							textMuted={t.textMuted}
						/>
						<StatCard
							label="Completed"
							value={completed.length}
							color="#5B8A5F"
							surface={t.surface}
							border={t.border}
							textMuted={t.textMuted}
						/>
						<StatCard
							label="On Hold"
							value={onHold.length}
							color="#E09840"
							surface={t.surface}
							border={t.border}
							textMuted={t.textMuted}
						/>
					</SimpleGrid>

					{/* In Progress */}
					<Box>
						<Group justify="space-between" mb="sm">
							<Text
								ff="var(--mantine-headings-font-family)"
								fw={600}
								fz="md"
								c={t.textPrimary}
							>
								In Progress
							</Text>
							<Text fz="xs" c={t.textMuted}>
								{inProgress.length} active
							</Text>
						</Group>
						<SimpleGrid cols={{ base: 1, sm: 2, md: 3 }} spacing="sm">
							{inProgress.map((item) => (
								<InProgressCard
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

					{/* Recent Activity — date-grouped with left-border accents */}
					<Box>
						<Text
							ff="var(--mantine-headings-font-family)"
							fw={600}
							fz="md"
							c={t.textPrimary}
							mb="sm"
						>
							Recent Activity
						</Text>
						<Stack gap="md">
							{dateGroups.map(([date, entries]) => (
								<Box key={date}>
									<Text
										fz={10}
										fw={700}
										c={t.textMuted}
										mb="xs"
										ff="var(--mantine-headings-font-family)"
										tt="uppercase"
										style={{ letterSpacing: "1.2px" }}
									>
										{date}
									</Text>
									<Paper
										p="sm"
										radius="sm"
										style={{
											background: t.surface,
											border: `1px solid ${t.border}`,
										}}
									>
										{entries.map((entry, i) => (
											<ActivityEntry
												key={entry.id}
												entry={entry}
												isLast={i === entries.length - 1}
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

					{/* Library Breakdown */}
					<Box>
						<Text
							ff="var(--mantine-headings-font-family)"
							fw={600}
							fz="md"
							c={t.textPrimary}
							mb="sm"
						>
							Library Breakdown
						</Text>
						<SimpleGrid cols={{ base: 2, sm: 3, md: 4 }} spacing="sm">
							{categories.map((cat) => {
								const total = cat.items.length;
								const done = cat.items.filter(
									(i) => i.status === "completed",
								).length;
								const active = cat.items.filter((i) =>
									ACTIVE_STATUSES.has(i.status),
								).length;
								const pct = total > 0 ? Math.round((done / total) * 100) : 0;
								return (
									<Paper
										key={cat.type}
										p="md"
										radius="sm"
										style={{
											background: t.surface,
											border: `1px solid ${t.border}`,
										}}
									>
										<Group justify="space-between" mb={6}>
											<Text
												ff="var(--mantine-headings-font-family)"
												fw={600}
												fz="xs"
												c={cat.color}
											>
												{cat.type}
											</Text>
											<Text
												ff="var(--mantine-font-family-monospace)"
												fw={700}
												fz="sm"
												c={cat.color}
											>
												{total}
											</Text>
										</Group>
										<MiniBar value={pct} color={cat.color} track={trackBar} />
										<Group gap="sm" mt={5}>
											<Text fz="xs" c={t.textMuted}>
												{active} active
											</Text>
											<Text fz="xs" c={t.textMuted}>
												{done} done
											</Text>
										</Group>
									</Paper>
								);
							})}
						</SimpleGrid>
					</Box>
				</Stack>
			</Container>
		</Box>
	);
}
