// Journal-first design: a dense, chronological activity log is the main column.
// Stats, quick-add, and on-hold items live in a compact sticky sidebar.
// Covers all 11 media types.

import {
	Box,
	Button,
	Container,
	Grid,
	Group,
	Menu,
	Paper,
	Stack,
	Text,
} from "@mantine/core";
import { createFileRoute } from "@tanstack/react-router";
import { ChevronDown, Plus } from "lucide-react";
import { useColorScheme } from "#/hooks/theme";

export const Route = createFileRoute("/_protected/labs/media-overview/v3")({
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

interface LibraryItem {
	id: string;
	title: string;
	sub: string;
	type: MediaType;
	status: string;
	coverUrl: string;
	rating: number | null;
}

const ALL_ITEMS: LibraryItem[] = [
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

interface JournalEntry {
	id: string;
	date: string;
	time: string;
	type: MediaType;
	title: string;
	sub: string;
	action: string;
	actionColor: string;
	coverUrl: string;
	rating: number | null;
}

const JOURNAL: JournalEntry[] = [
	{
		id: "j1",
		date: "Today",
		time: "7h ago",
		type: "Book",
		title: "Where Have All the Leaders Gone?",
		sub: "Lee Iacocca",
		action: "Completed",
		actionColor: "#5B8A5F",
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
		actionColor: GOLD,
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
		actionColor: "#9B59B6",
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
		actionColor: "#5B8A5F",
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
		actionColor: "#E67E22",
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
		actionColor: "#5B7FFF",
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
		actionColor: "#E09840",
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
		actionColor: "#5B8A5F",
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
		actionColor: "#1ABC9C",
		coverUrl:
			"https://images.unsplash.com/photo-1478737270239-2f02b77fc618?w=300&fit=crop",
		rating: null,
	},
	{
		id: "j10",
		date: "3 days ago",
		time: "3d ago",
		type: "Anime",
		title: "Solo Leveling",
		sub: "4 of 12 episodes",
		action: "Watched episode 4",
		actionColor: "#5B7FFF",
		coverUrl: "https://cdn.myanimelist.net/images/anime/1258/135739.jpg",
		rating: null,
	},
	{
		id: "j11",
		date: "1 week ago",
		time: "1w ago",
		type: "Movie",
		title: "Dune: Part Two",
		sub: "Denis Villeneuve",
		action: "Watched",
		actionColor: "#5B8A5F",
		coverUrl: "https://image.tmdb.org/t/p/w500/1pdfLvkbY9ohJlCjQH2CZjjYVvJ.jpg",
		rating: 5,
	},
	{
		id: "j12",
		date: "1 week ago",
		time: "1w ago",
		type: "ComicBook",
		title: "The Sandman",
		sub: "Neil Gaiman",
		action: "Started reading",
		actionColor: "#E74C3C",
		coverUrl:
			"https://upload.wikimedia.org/wikipedia/en/f/f5/SandmanIssue1.jpg",
		rating: null,
	},
	{
		id: "j13",
		date: "1 week ago",
		time: "1w ago",
		type: "Manga",
		title: "Vagabond",
		sub: "90 chapters read",
		action: "Started reading",
		actionColor: GOLD,
		coverUrl: "https://cdn.myanimelist.net/images/manga/3/116498.jpg",
		rating: null,
	},
	{
		id: "j14",
		date: "2 weeks ago",
		time: "2w ago",
		type: "VisualNovel",
		title: "Steins;Gate",
		sub: "5pb. / Nitroplus",
		action: "Completed",
		actionColor: "#5B8A5F",
		coverUrl: "https://cdn.myanimelist.net/images/anime/5/73199.jpg",
		rating: 5,
	},
	{
		id: "j15",
		date: "2 weeks ago",
		time: "2w ago",
		type: "AudioBook",
		title: "Atomic Habits",
		sub: "James Clear",
		action: "Finished",
		actionColor: "#5B8A5F",
		coverUrl: "https://m.media-amazon.com/images/I/513Y5o-DYtL.jpg",
		rating: 4,
	},
];

const ACTIVE_STATUSES = new Set([
	"reading",
	"watching",
	"listening",
	"playing",
]);

function EntryRow(props: {
	entry: JournalEntry;
	isDark: boolean;
	isLast: boolean;
}) {
	const textPrimary = props.isDark
		? "var(--mantine-color-dark-0)"
		: "var(--mantine-color-dark-9)";
	const textMuted = props.isDark
		? "var(--mantine-color-dark-3)"
		: "var(--mantine-color-stone-5)";
	const divider = props.isDark
		? "var(--mantine-color-dark-6)"
		: "var(--mantine-color-stone-2)";
	const typePill = props.isDark
		? "var(--mantine-color-dark-5)"
		: "var(--mantine-color-stone-2)";
	const typeColor = TYPE_COLORS[props.entry.type] ?? GOLD;

	return (
		<Group
			gap="sm"
			wrap="nowrap"
			align="flex-start"
			py="sm"
			style={{ borderBottom: props.isLast ? "none" : `1px solid ${divider}` }}
		>
			<Box
				w={42}
				h={56}
				style={{
					flexShrink: 0,
					borderRadius: 4,
					backgroundImage: `url(${props.entry.coverUrl})`,
					backgroundSize: "cover",
					backgroundPosition: "center top",
				}}
			/>
			<Stack gap={3} style={{ flex: 1, minWidth: 0 }}>
				<Group gap={6} wrap="nowrap">
					<Box
						px={6}
						py={1}
						style={{ borderRadius: 3, background: typePill, flexShrink: 0 }}
					>
						<Text
							fz={10}
							fw={600}
							c={typeColor}
							ff="var(--mantine-headings-font-family)"
							style={{ textTransform: "uppercase", letterSpacing: "0.6px" }}
						>
							{props.entry.type}
						</Text>
					</Box>
					<Text fz={11} c={textMuted} style={{ whiteSpace: "nowrap" }}>
						{props.entry.time}
					</Text>
				</Group>
				<Text
					ff="var(--mantine-headings-font-family)"
					fw={600}
					fz="sm"
					c={textPrimary}
					lineClamp={1}
					lh={1.3}
				>
					{props.entry.title}
				</Text>
				<Text fz="xs" c={textMuted} lineClamp={1}>
					{props.entry.sub}
				</Text>
				<Group gap={6} align="center">
					<Text fz="xs" fw={500} c={props.entry.actionColor}>
						{props.entry.action}
					</Text>
					{props.entry.rating !== null && (
						<Text fz="xs" ff="var(--mantine-font-family-monospace)" c={GOLD}>
							{"★".repeat(props.entry.rating)}
						</Text>
					)}
				</Group>
			</Stack>
		</Group>
	);
}

function SidebarCard(props: {
	title: string;
	isDark: boolean;
	children: React.ReactNode;
}) {
	const surface = props.isDark ? "var(--mantine-color-dark-7)" : "white";
	const border = props.isDark
		? "var(--mantine-color-dark-5)"
		: "var(--mantine-color-stone-3)";
	const textPrimary = props.isDark
		? "var(--mantine-color-dark-0)"
		: "var(--mantine-color-dark-9)";
	return (
		<Paper
			p="md"
			radius="sm"
			style={{ background: surface, border: `1px solid ${border}` }}
		>
			<Text
				ff="var(--mantine-headings-font-family)"
				fw={600}
				fz="sm"
				c={textPrimary}
				mb="sm"
			>
				{props.title}
			</Text>
			{props.children}
		</Paper>
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
	const divider = isDark
		? "var(--mantine-color-dark-6)"
		: "var(--mantine-color-stone-2)";

	const onHold = ALL_ITEMS.filter((i) => i.status === "on_hold");
	const inProgress = ALL_ITEMS.filter((i) => ACTIVE_STATUSES.has(i.status));
	const completed = ALL_ITEMS.filter((i) => i.status === "completed");

	const grouped = JOURNAL.reduce<Record<string, JournalEntry[]>>(
		(acc, entry) => {
			if (!acc[entry.date]) {
				acc[entry.date] = [];
			}
			// biome-ignore lint/style/noNonNullAssertion: just assigned above
			acc[entry.date]!.push(entry);
			return acc;
		},
		{},
	);
	const dateGroups = Object.entries(grouped);

	return (
		<Box bg={bgPage} mih="100vh">
			<Container size="lg" py="xl">
				<Grid>
					<Grid.Col span={{ base: 12, md: 8 }}>
						<Stack gap="xl">
							<Group justify="space-between" align="flex-end">
								<Box>
									<Text
										ff="var(--mantine-headings-font-family)"
										fw={700}
										fz={26}
										c={textPrimary}
										lh={1.1}
									>
										Media Journal
									</Text>
									<Text fz="sm" c={textMuted} mt={4}>
										{ALL_ITEMS.length} entries across all types
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
											Add
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

							{dateGroups.map(([date, entries]) => (
								<Box key={date}>
									<Text
										fz={10}
										fw={700}
										c={textMuted}
										mb="xs"
										ff="var(--mantine-headings-font-family)"
										style={{
											textTransform: "uppercase",
											letterSpacing: "1.2px",
										}}
									>
										{date}
									</Text>
									<Paper
										p="md"
										radius="sm"
										style={{
											background: surface,
											border: `1px solid ${border}`,
										}}
									>
										{entries.map((entry, i) => (
											<EntryRow
												key={entry.id}
												entry={entry}
												isDark={isDark}
												isLast={i === entries.length - 1}
											/>
										))}
									</Paper>
								</Box>
							))}
						</Stack>
					</Grid.Col>

					<Grid.Col span={{ base: 12, md: 4 }}>
						<Stack gap="md" style={{ position: "sticky", top: 24 }}>
							<SidebarCard title="Library" isDark={isDark}>
								<Stack gap={6}>
									{[
										{ label: "Total entries", value: ALL_ITEMS.length },
										{ label: "In progress", value: inProgress.length },
										{ label: "Completed", value: completed.length },
										{ label: "On hold", value: onHold.length },
									].map((stat) => (
										<Group key={stat.label} justify="space-between">
											<Text fz="sm" c={textMuted}>
												{stat.label}
											</Text>
											<Text
												fz="sm"
												ff="var(--mantine-font-family-monospace)"
												fw={600}
												c={GOLD}
											>
												{stat.value}
											</Text>
										</Group>
									))}
								</Stack>
							</SidebarCard>

							{inProgress.length > 0 && (
								<SidebarCard title="In Progress" isDark={isDark}>
									<Stack gap="sm">
										{inProgress.slice(0, 4).map((item, i) => (
											<Group key={item.id} gap="sm" wrap="nowrap">
												<Text
													fz={11}
													fw={700}
													ff="var(--mantine-font-family-monospace)"
													c={textMuted}
													style={{ flexShrink: 0, width: 14 }}
												>
													{i + 1}
												</Text>
												<Box
													w={28}
													h={38}
													style={{
														flexShrink: 0,
														borderRadius: 3,
														backgroundImage: `url(${item.coverUrl})`,
														backgroundSize: "cover",
														backgroundPosition: "center",
													}}
												/>
												<Stack gap={1} style={{ flex: 1, minWidth: 0 }}>
													<Text
														fz="xs"
														fw={600}
														c={textPrimary}
														lineClamp={1}
														ff="var(--mantine-headings-font-family)"
													>
														{item.title}
													</Text>
													<Text
														fz={10}
														c={TYPE_COLORS[item.type] ?? GOLD}
														fw={500}
													>
														{item.type}
													</Text>
												</Stack>
											</Group>
										))}
										{inProgress.length > 4 && (
											<Text
												fz="xs"
												c={textMuted}
												style={{
													paddingTop: 8,
													borderTop: `1px solid ${divider}`,
												}}
											>
												+{inProgress.length - 4} more
											</Text>
										)}
									</Stack>
								</SidebarCard>
							)}

							{onHold.length > 0 && (
								<SidebarCard title="On Hold" isDark={isDark}>
									<Stack gap="sm">
										{onHold.map((item) => (
											<Group key={item.id} gap="sm" wrap="nowrap">
												<Box
													w={32}
													h={44}
													style={{
														flexShrink: 0,
														borderRadius: 3,
														backgroundImage: `url(${item.coverUrl})`,
														backgroundSize: "cover",
														backgroundPosition: "center",
													}}
												/>
												<Stack gap={2} style={{ flex: 1, minWidth: 0 }}>
													<Text
														fz="xs"
														fw={600}
														c={textPrimary}
														lineClamp={2}
														ff="var(--mantine-headings-font-family)"
														lh={1.3}
													>
														{item.title}
													</Text>
													<Text
														fz={10}
														c={TYPE_COLORS[item.type] ?? GOLD}
														fw={500}
													>
														{item.type}
													</Text>
												</Stack>
											</Group>
										))}
									</Stack>
								</SidebarCard>
							)}
						</Stack>
					</Grid.Col>
				</Grid>
			</Container>
		</Box>
	);
}
