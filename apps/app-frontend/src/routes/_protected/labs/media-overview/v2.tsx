// Content-first gallery: cover art is the primary UI. A warm hero spotlight leads
// with what you're currently consuming; a dense cover grid fills the rest.

import {
	Box,
	Button,
	Container,
	Group,
	Menu,
	SimpleGrid,
	Stack,
	Tabs,
	Text,
} from "@mantine/core";
import { createFileRoute } from "@tanstack/react-router";
import { ChevronDown, Plus } from "lucide-react";
import { useState } from "react";
import { useColorScheme } from "#/hooks/theme";

export const Route = createFileRoute("/_protected/labs/media-overview/v2")({
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

const STATUS_DOT: Record<string, string> = {
	reading: "#5B8A5F",
	watching: "#5B7FFF",
	listening: "#9B59B6",
	playing: "#27AE60",
	completed: "#888",
	on_hold: "#E09840",
	dropped: "#E05252",
};

interface CoverItem {
	id: string;
	title: string;
	coverUrl: string;
	status: string;
	rating: number | null;
	type: MediaType;
	sub: string;
}

const ALL_COVERS: CoverItem[] = [
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

const ACTIVE_STATUSES = new Set([
	"reading",
	"watching",
	"listening",
	"playing",
]);

function activeVerb(type: MediaType): string {
	if (
		type === "Book" ||
		type === "Manga" ||
		type === "ComicBook" ||
		type === "VisualNovel"
	) {
		return "Reading";
	}
	if (type === "Music" || type === "Podcast" || type === "AudioBook") {
		return "Listening to";
	}
	if (type === "VideoGame") {
		return "Playing";
	}
	return "Watching";
}

function CoverTile(props: { item: CoverItem; isDark: boolean }) {
	const dotColor = STATUS_DOT[props.item.status] ?? "#888";
	const textMuted = props.isDark
		? "var(--mantine-color-dark-3)"
		: "var(--mantine-color-stone-5)";
	return (
		<Box style={{ cursor: "pointer" }}>
			<Box
				style={{
					borderRadius: 6,
					overflow: "hidden",
					aspectRatio: "2/3",
					backgroundImage: `url(${props.item.coverUrl})`,
					backgroundSize: "cover",
					backgroundPosition: "center top",
					position: "relative",
				}}
			>
				<Box
					w={9}
					h={9}
					style={{
						position: "absolute",
						top: 7,
						right: 7,
						borderRadius: "50%",
						backgroundColor: dotColor,
						boxShadow: "0 0 0 2px rgba(0,0,0,0.45)",
					}}
				/>
				{props.item.rating !== null && (
					<Box
						style={{
							position: "absolute",
							bottom: 6,
							right: 6,
							backgroundColor: GOLD,
							color: "white",
							fontSize: 10,
							fontFamily: "var(--mantine-font-family-monospace)",
							fontWeight: 700,
							padding: "1px 5px",
							borderRadius: 3,
							lineHeight: 1.6,
						}}
					>
						★{props.item.rating}
					</Box>
				)}
				<Box
					style={{
						position: "absolute",
						bottom: 0,
						left: 0,
						right: 0,
						height: "55%",
						background:
							"linear-gradient(to top, rgba(0,0,0,0.72) 0%, transparent 100%)",
					}}
				/>
				<Text
					fz={10}
					fw={600}
					c="white"
					lineClamp={2}
					style={{
						position: "absolute",
						bottom: 7,
						left: 7,
						right: props.item.rating !== null ? 34 : 7,
						fontFamily: "var(--mantine-headings-font-family)",
						lineHeight: 1.3,
					}}
				>
					{props.item.title}
				</Text>
			</Box>
			<Text fz={10} c={textMuted} mt={4} lineClamp={1}>
				{props.item.sub}
			</Text>
		</Box>
	);
}

function HeroSpotlight(props: { item: CoverItem; isDark: boolean }) {
	const textMuted = props.isDark
		? "var(--mantine-color-dark-3)"
		: "rgba(40,30,20,0.55)";
	const heroText = props.isDark ? "white" : "var(--mantine-color-dark-9)";
	const overlay = props.isDark
		? "linear-gradient(135deg, rgba(18,14,10,0.93) 0%, rgba(35,25,12,0.72) 55%, rgba(18,14,10,0.18) 100%)"
		: "linear-gradient(135deg, rgba(255,250,240,0.96) 0%, rgba(255,238,200,0.80) 55%, rgba(255,238,200,0.08) 100%)";

	const typeColor = TYPE_COLORS[props.item.type] ?? GOLD;
	const verb = activeVerb(props.item.type);

	return (
		<Box
			style={{
				borderRadius: 12,
				overflow: "hidden",
				minHeight: 200,
				backgroundImage: `url(${props.item.coverUrl})`,
				backgroundSize: "cover",
				backgroundPosition: "center 20%",
				position: "relative",
				cursor: "pointer",
			}}
		>
			<Box style={{ position: "absolute", inset: 0, background: overlay }} />
			<Box style={{ position: "relative", padding: "36px 44px 36px" }}>
				<Group gap={8} mb={10}>
					<Text
						fz={10}
						fw={700}
						c={typeColor}
						ff="var(--mantine-headings-font-family)"
						style={{ textTransform: "uppercase", letterSpacing: "1.8px" }}
					>
						Now {verb}
					</Text>
					<Text
						fz={10}
						fw={700}
						c={GOLD}
						ff="var(--mantine-headings-font-family)"
						style={{ textTransform: "uppercase", letterSpacing: "1.8px" }}
					>
						· {props.item.type}
					</Text>
				</Group>
				<Text
					ff="var(--mantine-headings-font-family)"
					fw={700}
					fz={{ base: 22, sm: 30 }}
					c={heroText}
					maw={460}
					lh={1.2}
					mb={6}
				>
					{props.item.title}
				</Text>
				<Text fz="sm" c={textMuted}>
					{props.item.sub}
				</Text>
			</Box>
		</Box>
	);
}

function RouteComponent() {
	const isDark = useColorScheme() === "dark";
	const [tab, setTab] = useState<string | null>("all");
	const bgPage = isDark
		? "var(--mantine-color-dark-9)"
		: "var(--mantine-color-stone-1)";
	const textPrimary = isDark
		? "var(--mantine-color-dark-0)"
		: "var(--mantine-color-dark-9)";
	const textMuted = isDark
		? "var(--mantine-color-dark-3)"
		: "var(--mantine-color-stone-5)";

	const inProgress = ALL_COVERS.filter((i) => ACTIVE_STATUSES.has(i.status));
	const heroItem = inProgress[0];

	// Count per type for tab labels
	const typeCounts: Record<string, number> = {};
	for (const item of ALL_COVERS) {
		typeCounts[item.type] = (typeCounts[item.type] ?? 0) + 1;
	}

	const filtered =
		tab === "all"
			? ALL_COVERS
			: ALL_COVERS.filter((i) => i.type.toLowerCase().replace(" ", "") === tab);

	return (
		<Box bg={bgPage} mih="100vh">
			<Container size="lg" py="xl">
				<Stack gap="xl">
					<Group justify="space-between" align="center">
						<Box>
							<Text
								ff="var(--mantine-headings-font-family)"
								fw={700}
								fz={20}
								c={textPrimary}
							>
								Media
							</Text>
							<Text fz="xs" c={textMuted} mt={2}>
								{ALL_COVERS.length} entries
							</Text>
						</Box>
						<Menu position="bottom-end" width={180}>
							<Menu.Target>
								<Button
									size="xs"
									leftSection={<Plus size={12} />}
									rightSection={<ChevronDown size={11} />}
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

					{heroItem && <HeroSpotlight item={heroItem} isDark={isDark} />}

					{inProgress.length > 1 && (
						<Box>
							<Text
								fz={10}
								fw={700}
								c={textMuted}
								mb="sm"
								ff="var(--mantine-headings-font-family)"
								style={{ textTransform: "uppercase", letterSpacing: "1.5px" }}
							>
								Continue
							</Text>
							<Group
								gap="sm"
								wrap="nowrap"
								style={{ overflowX: "auto", paddingBottom: 4 }}
							>
								{inProgress.slice(1).map((item) => (
									<Box key={item.id} style={{ flexShrink: 0, width: 90 }}>
										<CoverTile item={item} isDark={isDark} />
									</Box>
								))}
							</Group>
						</Box>
					)}

					<Box>
						<Tabs
							value={tab}
							onChange={setTab}
							mb="md"
							styles={{
								tab: {
									fontFamily: "var(--mantine-headings-font-family)",
									fontWeight: 600,
									fontSize: 13,
								},
							}}
						>
							<Tabs.List style={{ overflowX: "auto", flexWrap: "nowrap" }}>
								<Tabs.Tab value="all" style={{ whiteSpace: "nowrap" }}>
									All ({ALL_COVERS.length})
								</Tabs.Tab>
								{MEDIA_TYPES.filter((t) => (typeCounts[t] ?? 0) > 0).map(
									(type) => (
										<Tabs.Tab
											key={type}
											value={type.toLowerCase().replace(" ", "")}
											style={{ whiteSpace: "nowrap" }}
										>
											{type} ({typeCounts[type]})
										</Tabs.Tab>
									),
								)}
							</Tabs.List>
						</Tabs>
						<SimpleGrid cols={{ base: 3, sm: 5, md: 7 }} spacing="xs">
							{filtered.map((item) => (
								<CoverTile key={item.id} item={item} isDark={isDark} />
							))}
						</SimpleGrid>
					</Box>
				</Stack>
			</Container>
		</Box>
	);
}
