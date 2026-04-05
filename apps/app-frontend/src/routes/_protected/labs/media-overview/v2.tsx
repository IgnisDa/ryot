// Content-first gallery: cover art is the primary UI. A warm hero spotlight leads
// with what you're currently consuming; a dense cover grid fills the rest.

import {
	Box,
	Button,
	Container,
	Group,
	SimpleGrid,
	Stack,
	Tabs,
	Text,
} from "@mantine/core";
import { createFileRoute } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { useState } from "react";
import { useColorScheme } from "#/hooks/theme";

export const Route = createFileRoute(
	"/_protected/labs/media-overview/v2",
)({
	component: RouteComponent,
});

const GOLD = "#C9943A";

const STATUS_DOT: Record<string, string> = {
	reading: "#5B8A5F",
	watching: "#5B7FFF",
	completed: "#888",
	on_hold: "#E09840",
};

const SAMPLE_BOOKS = [
	{
		id: "b1",
		title: "Where Have All the Leaders Gone?",
		author: "Lee Iacocca",
		status: "completed",
		coverUrl: "https://covers.openlibrary.org/b/id/8739161-L.jpg",
		rating: 4,
	},
	{
		id: "b2",
		title: "The Wind Is Never Gone",
		author: "Sally Mandel",
		status: "reading",
		coverUrl: "https://covers.openlibrary.org/b/id/240726-L.jpg",
		rating: null,
	},
	{
		id: "b3",
		title: "What to Do When I'm Gone",
		author: "Suzy Hopkins",
		status: "reading",
		coverUrl: "https://covers.openlibrary.org/b/id/10527831-L.jpg",
		rating: null,
	},
	{
		id: "b4",
		title: "The Name of the Wind",
		author: "Patrick Rothfuss",
		status: "on_hold",
		coverUrl: "https://covers.openlibrary.org/b/id/9256378-L.jpg",
		rating: 5,
	},
];
const SAMPLE_ANIME = [
	{
		id: "a1",
		title: "Frieren: Beyond Journey's End",
		episodes: 28,
		totalEpisodes: 28,
		status: "completed",
		coverUrl: "https://cdn.myanimelist.net/images/anime/1015/138006.jpg",
		rating: 5,
	},
	{
		id: "a2",
		title: "Dungeon Meshi",
		episodes: 12,
		totalEpisodes: 24,
		status: "watching",
		coverUrl: "https://cdn.myanimelist.net/images/anime/1628/140081.jpg",
		rating: null,
	},
	{
		id: "a3",
		title: "Solo Leveling",
		episodes: 4,
		totalEpisodes: 12,
		status: "watching",
		coverUrl: "https://cdn.myanimelist.net/images/anime/1258/135739.jpg",
		rating: null,
	},
];
const SAMPLE_MANGA = [
	{
		id: "m1",
		title: "Berserk",
		chapters: 374,
		status: "on_hold",
		coverUrl: "https://cdn.myanimelist.net/images/manga/1/157897.jpg",
		rating: 5,
	},
	{
		id: "m2",
		title: "Vagabond",
		chapters: 90,
		status: "reading",
		coverUrl: "https://cdn.myanimelist.net/images/manga/3/116498.jpg",
		rating: null,
	},
];

interface CoverItem {
	id: string;
	title: string;
	coverUrl: string;
	status: string;
	rating: number | null;
	type: "Book" | "Anime" | "Manga";
	sub: string;
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
	)
}

function HeroSpotlight(props: { item: CoverItem; isDark: boolean }) {
	const textMuted = props.isDark
		? "var(--mantine-color-dark-3)"
		: "rgba(40,30,20,0.55)";
	const heroText = props.isDark ? "white" : "var(--mantine-color-dark-9)";
	const overlay = props.isDark
		? "linear-gradient(135deg, rgba(18,14,10,0.93) 0%, rgba(35,25,12,0.72) 55%, rgba(18,14,10,0.18) 100%)"
		: "linear-gradient(135deg, rgba(255,250,240,0.96) 0%, rgba(255,238,200,0.80) 55%, rgba(255,238,200,0.08) 100%)";

	const verb = props.item.type === "Book" ? "Reading" : "Watching";
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
				<Text
					fz={10}
					fw={700}
					c={GOLD}
					ff="var(--mantine-headings-font-family)"
					mb={10}
					style={{ textTransform: "uppercase", letterSpacing: "1.8px" }}
				>
					Now {verb} · {props.item.type}
				</Text>
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
	)
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

	const allCovers: CoverItem[] = [
		...SAMPLE_BOOKS.map((b) => ({
			...b,
			type: "Book" as const,
			sub: b.author,
		})),
		...SAMPLE_ANIME.map((a) => ({
			...a,
			type: "Anime" as const,
			sub: `${a.episodes}/${a.totalEpisodes} eps`,
		})),
		...SAMPLE_MANGA.map((m) => ({
			...m,
			type: "Manga" as const,
			sub: `${m.chapters} ch read`,
		})),
	]

	const inProgress = allCovers.filter(
		(i) => i.status === "reading" || i.status === "watching",
	)
	const heroItem = inProgress[0];

	const filtered =
		tab === "all"
			? allCovers
			: allCovers.filter((i) => i.type.toLowerCase() === tab);

	return (
		<Box bg={bgPage} mih="100vh">
			<Container size="lg" py="xl">
				<Stack gap="xl">
					<Group justify="space-between" align="center">
						<Text
							ff="var(--mantine-headings-font-family)"
							fw={700}
							fz={20}
							c={textPrimary}
						>
							Media
						</Text>
						<Button
							size="xs"
							leftSection={<Plus size={12} />}
							style={{ backgroundColor: GOLD, color: "white" }}
						>
							Add
						</Button>
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
							<Tabs.List>
								<Tabs.Tab value="all">All ({allCovers.length})</Tabs.Tab>
								<Tabs.Tab value="book">Books ({SAMPLE_BOOKS.length})</Tabs.Tab>
								<Tabs.Tab value="anime">Anime ({SAMPLE_ANIME.length})</Tabs.Tab>
								<Tabs.Tab value="manga">Manga ({SAMPLE_MANGA.length})</Tabs.Tab>
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
	)
}
