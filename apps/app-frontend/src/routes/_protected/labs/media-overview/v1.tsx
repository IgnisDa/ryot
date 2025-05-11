// Dashboard-first: numbers and progress first, then active items, then activity feed.
// Scales to any number of media types via a dynamic category breakdown grid.

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
import { useColorScheme } from "#/hooks/theme";

export const Route = createFileRoute("/_protected/labs/media-overview/v1")({
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
	title: string;
	type: MediaType;
	status: string;
	coverUrl: string;
	rating: number | null;
	sub: string;
}

const ACTIVE_STATUSES = new Set([
	"reading",
	"watching",
	"listening",
	"playing",
]);
const isActive = (s: string) => ACTIVE_STATUSES.has(s);
const isDone = (s: string) => s === "completed";
const isPaused = (s: string) => s === "on_hold" || s === "dropped";

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

const RECENT_ACTIVITY = [
	{
		id: "r1",
		title: "Where Have All the Leaders Gone?",
		coverUrl: "https://covers.openlibrary.org/b/id/8739161-L.jpg",
		type: "Book",
		action: "Completed",
		time: "7h ago",
		rating: 4,
	},
	{
		id: "r2",
		title: "Frieren: Beyond Journey's End",
		coverUrl: "https://cdn.myanimelist.net/images/anime/1015/138006.jpg",
		type: "Anime",
		action: "Finished",
		time: "Yesterday",
		rating: 5,
	},
	{
		id: "r3",
		title: "Dune: Part Two",
		coverUrl: "https://image.tmdb.org/t/p/w500/1pdfLvkbY9ohJlCjQH2CZjjYVvJ.jpg",
		type: "Movie",
		action: "Watched",
		time: "3d ago",
		rating: 5,
	},
	{
		id: "r4",
		title: "Elden Ring",
		coverUrl:
			"https://images.igdb.com/igdb/image/upload/t_cover_big/co4jni.jpg",
		type: "VideoGame",
		action: "Completed",
		time: "1w ago",
		rating: 5,
	},
	{
		id: "r5",
		title: "Atomic Habits",
		coverUrl: "https://m.media-amazon.com/images/I/513Y5o-DYtL.jpg",
		type: "AudioBook",
		action: "Finished",
		time: "1w ago",
		rating: 4,
	},
	{
		id: "r6",
		title: "Kind of Blue",
		coverUrl:
			"https://upload.wikimedia.org/wikipedia/commons/thumb/4/4b/KindofBlue.jpg/300px-KindofBlue.jpg",
		type: "Music",
		action: "Logged listen",
		time: "2w ago",
		rating: 5,
	},
];

function StatTile(props: {
	value: number | string;
	label: string;
	sub?: string;
	isDark: boolean;
}) {
	const surface = props.isDark ? "var(--mantine-color-dark-7)" : "white";
	const border = props.isDark
		? "var(--mantine-color-dark-5)"
		: "var(--mantine-color-stone-3)";
	const textMuted = props.isDark
		? "var(--mantine-color-dark-3)"
		: "var(--mantine-color-stone-5)";
	return (
		<Paper
			p="md"
			radius="sm"
			style={{ background: surface, border: `1px solid ${border}` }}
		>
			<Text
				ff="var(--mantine-font-family-monospace)"
				fz={32}
				fw={700}
				c={GOLD}
				lh={1}
			>
				{props.value}
			</Text>
			<Text ff="var(--mantine-headings-font-family)" fw={600} fz="sm" mt={4}>
				{props.label}
			</Text>
			{props.sub && (
				<Text fz="xs" c={textMuted} mt={2}>
					{props.sub}
				</Text>
			)}
		</Paper>
	);
}

function MiniBar(props: { value: number; isDark: boolean; color?: string }) {
	const track = props.isDark
		? "var(--mantine-color-dark-5)"
		: "var(--mantine-color-stone-2)";
	return (
		<Box
			h={4}
			style={{ background: track, borderRadius: 2, overflow: "hidden" }}
		>
			<Box
				h="100%"
				w={`${props.value}%`}
				style={{ backgroundColor: props.color ?? GOLD, borderRadius: 2 }}
			/>
		</Box>
	);
}

function InProgressCard(props: { item: MediaItem; isDark: boolean }) {
	const surface = props.isDark ? "var(--mantine-color-dark-7)" : "white";
	const border = props.isDark
		? "var(--mantine-color-dark-5)"
		: "var(--mantine-color-stone-3)";
	const textPrimary = props.isDark
		? "var(--mantine-color-dark-0)"
		: "var(--mantine-color-dark-9)";
	const textMuted = props.isDark
		? "var(--mantine-color-dark-3)"
		: "var(--mantine-color-stone-5)";
	const typeColor = TYPE_COLORS[props.item.type] ?? GOLD;
	return (
		<Paper
			radius="sm"
			style={{
				background: surface,
				border: `1px solid ${border}`,
				overflow: "hidden",
			}}
		>
			<Group gap={0} align="stretch" wrap="nowrap">
				<Box
					w={68}
					style={{
						flexShrink: 0,
						backgroundImage: `url(${props.item.coverUrl})`,
						backgroundSize: "cover",
						backgroundPosition: "center",
						minHeight: 96,
					}}
				/>
				<Stack gap={6} p="sm" style={{ flex: 1, minWidth: 0 }}>
					<Text
						fz={10}
						fw={600}
						c={typeColor}
						ff="var(--mantine-headings-font-family)"
						style={{ textTransform: "uppercase", letterSpacing: "0.8px" }}
					>
						{props.item.type}
					</Text>
					<Text
						ff="var(--mantine-headings-font-family)"
						fw={600}
						fz="sm"
						c={textPrimary}
						lineClamp={2}
						lh={1.3}
					>
						{props.item.title}
					</Text>
					<Text fz="xs" c={textMuted} lineClamp={1}>
						{props.item.sub}
					</Text>
				</Stack>
			</Group>
		</Paper>
	);
}

function ActivityRow(props: {
	title: string;
	coverUrl: string;
	type: string;
	action: string;
	time: string;
	rating: number | null;
	isDark: boolean;
	isLast: boolean;
}) {
	const textPrimary = props.isDark
		? "var(--mantine-color-dark-0)"
		: "var(--mantine-color-dark-9)";
	const textMuted = props.isDark
		? "var(--mantine-color-dark-3)"
		: "var(--mantine-color-stone-5)";
	const border = props.isDark
		? "var(--mantine-color-dark-5)"
		: "var(--mantine-color-stone-2)";
	const typeColor = TYPE_COLORS[props.type] ?? GOLD;
	return (
		<Group
			gap="sm"
			wrap="nowrap"
			py="xs"
			style={{ borderBottom: props.isLast ? "none" : `1px solid ${border}` }}
		>
			<Box
				w={36}
				h={48}
				style={{
					flexShrink: 0,
					borderRadius: 4,
					backgroundImage: `url(${props.coverUrl})`,
					backgroundSize: "cover",
					backgroundPosition: "center",
				}}
			/>
			<Stack gap={2} style={{ flex: 1, minWidth: 0 }}>
				<Text
					ff="var(--mantine-headings-font-family)"
					fw={600}
					fz="sm"
					c={textPrimary}
					lineClamp={1}
				>
					{props.title}
				</Text>
				<Group gap={6}>
					<Text fz="xs" c={typeColor} fw={500}>
						{props.type}
					</Text>
					<Text fz="xs" c={textMuted}>
						·
					</Text>
					<Text fz="xs" c={textMuted}>
						{props.action}
					</Text>
					{props.rating !== null && (
						<Text fz="xs" ff="var(--mantine-font-family-monospace)" c={GOLD}>
							{"★".repeat(props.rating)}
						</Text>
					)}
				</Group>
			</Stack>
			<Text
				fz="xs"
				c={textMuted}
				style={{ whiteSpace: "nowrap", flexShrink: 0 }}
			>
				{props.time}
			</Text>
		</Group>
	);
}

function RouteComponent() {
	const isDark = useColorScheme() === "dark";
	const bgPage = isDark
		? "var(--mantine-color-dark-8)"
		: "var(--mantine-color-stone-0)";
	const surface = isDark ? "var(--mantine-color-dark-7)" : "white";
	const border = isDark
		? "var(--mantine-color-dark-5)"
		: "var(--mantine-color-stone-3)";
	const textPrimary = isDark
		? "var(--mantine-color-dark-0)"
		: "var(--mantine-color-dark-9)";
	const textMuted = isDark
		? "var(--mantine-color-dark-3)"
		: "var(--mantine-color-stone-5)";

	const inProgress = ALL_MEDIA.filter((i) => isActive(i.status));
	const completed = ALL_MEDIA.filter((i) => isDone(i.status));
	const onHold = ALL_MEDIA.filter((i) => isPaused(i.status));
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

	return (
		<Box bg={bgPage} mih="100vh">
			<Container size="lg" py="xl">
				<Stack gap="xl">
					<Group justify="space-between" align="flex-end">
						<Box>
							<Text
								ff="var(--mantine-headings-font-family)"
								fw={700}
								fz={28}
								c={textPrimary}
								lh={1.1}
							>
								My Media
							</Text>
							<Text fz="sm" c={textMuted} mt={4}>
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
										<Text fz="sm">{type}</Text>
									</Menu.Item>
								))}
							</Menu.Dropdown>
						</Menu>
					</Group>

					<SimpleGrid cols={{ base: 2, sm: 4 }} spacing="sm">
						<StatTile
							value={ALL_MEDIA.length}
							label="Total Entries"
							sub={`${typesTracked} types`}
							isDark={isDark}
						/>
						<StatTile
							value={inProgress.length}
							label="In Progress"
							sub="currently active"
							isDark={isDark}
						/>
						<StatTile
							value={completed.length}
							label="Completed"
							isDark={isDark}
						/>
						<StatTile value={onHold.length} label="On Hold" isDark={isDark} />
					</SimpleGrid>

					<Box>
						<Group justify="space-between" mb="sm">
							<Text
								ff="var(--mantine-headings-font-family)"
								fw={600}
								fz="md"
								c={textPrimary}
							>
								In Progress
							</Text>
							<Text fz="xs" c={textMuted}>
								{inProgress.length} active
							</Text>
						</Group>
						<SimpleGrid cols={{ base: 1, sm: 2, md: 3 }} spacing="sm">
							{inProgress.map((item) => (
								<InProgressCard key={item.id} item={item} isDark={isDark} />
							))}
						</SimpleGrid>
					</Box>

					<Box>
						<Text
							ff="var(--mantine-headings-font-family)"
							fw={600}
							fz="md"
							c={textPrimary}
							mb="sm"
						>
							Recent Activity
						</Text>
						<Paper
							p="md"
							radius="sm"
							style={{ background: surface, border: `1px solid ${border}` }}
						>
							{RECENT_ACTIVITY.map((item, i) => (
								<ActivityRow
									key={item.id}
									title={item.title}
									coverUrl={item.coverUrl}
									type={item.type}
									action={item.action}
									time={item.time}
									rating={item.rating}
									isDark={isDark}
									isLast={i === RECENT_ACTIVITY.length - 1}
								/>
							))}
						</Paper>
					</Box>

					<Box>
						<Text
							ff="var(--mantine-headings-font-family)"
							fw={600}
							fz="md"
							c={textPrimary}
							mb="sm"
						>
							Library Breakdown
						</Text>
						<SimpleGrid cols={{ base: 2, sm: 3, md: 4 }} spacing="sm">
							{categories.map((cat) => {
								const total = cat.items.length;
								const done = cat.items.filter((i) => isDone(i.status)).length;
								const active = cat.items.filter((i) =>
									isActive(i.status),
								).length;
								const pct = total > 0 ? Math.round((done / total) * 100) : 0;
								return (
									<Paper
										key={cat.type}
										p="md"
										radius="sm"
										style={{
											background: surface,
											border: `1px solid ${border}`,
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
										<MiniBar value={pct} isDark={isDark} color={cat.color} />
										<Group gap="sm" mt={5}>
											<Text fz="xs" c={textMuted}>
												{active} active
											</Text>
											<Text fz="xs" c={textMuted}>
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
