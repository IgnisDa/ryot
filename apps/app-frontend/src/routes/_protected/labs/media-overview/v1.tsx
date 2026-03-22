// Dashboard-first design: lead with numbers and progress bars, then in-progress
// cards, then a recent activity feed. Warm gold on stone neutrals.

import {
	Box,
	Button,
	Container,
	Group,
	Paper,
	SimpleGrid,
	Stack,
	Text,
} from "@mantine/core";
import { createFileRoute } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { useColorScheme } from "#/hooks/theme";

export const Route = createFileRoute("/_protected/labs/media-overview/v1")({
	component: RouteComponent,
});

const GOLD = "#C9943A";

interface BookEntry {
	id: string;
	title: string;
	author: string;
	status: string;
	addedAt: string;
	coverUrl: string;
	rating: number | null;
}
interface AnimeEntry {
	id: string;
	title: string;
	episodes: number;
	totalEpisodes: number;
	status: string;
	coverUrl: string;
	rating: number | null;
}
interface MangaEntry {
	id: string;
	title: string;
	chapters: number;
	status: string;
	coverUrl: string;
	rating: number | null;
}

const SAMPLE_BOOKS: BookEntry[] = [
	{
		id: "b1",
		title: "Where Have All the Leaders Gone?",
		author: "Lee Iacocca",
		status: "completed",
		addedAt: "7 hours ago",
		coverUrl: "https://covers.openlibrary.org/b/id/8739161-L.jpg",
		rating: 4,
	},
	{
		id: "b2",
		title: "The Wind Is Never Gone",
		author: "Sally Mandel",
		status: "reading",
		addedAt: "7 hours ago",
		coverUrl: "https://covers.openlibrary.org/b/id/240726-L.jpg",
		rating: null,
	},
	{
		id: "b3",
		title: "What to Do When I'm Gone",
		author: "Suzy Hopkins",
		status: "reading",
		addedAt: "11 hours ago",
		coverUrl: "https://covers.openlibrary.org/b/id/10527831-L.jpg",
		rating: null,
	},
	{
		id: "b4",
		title: "The Name of the Wind",
		author: "Patrick Rothfuss",
		status: "on_hold",
		addedAt: "2 days ago",
		coverUrl: "https://covers.openlibrary.org/b/id/9256378-L.jpg",
		rating: 5,
	},
];
const SAMPLE_ANIME: AnimeEntry[] = [
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
const SAMPLE_MANGA: MangaEntry[] = [
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
		title: "The Wind Is Never Gone",
		coverUrl: "https://covers.openlibrary.org/b/id/240726-L.jpg",
		type: "Book",
		action: "Started reading",
		time: "7h ago",
		rating: null,
	},
	{
		id: "r3",
		title: "What to Do When I'm Gone",
		coverUrl: "https://covers.openlibrary.org/b/id/10527831-L.jpg",
		type: "Book",
		action: "Started reading",
		time: "11h ago",
		rating: null,
	},
	{
		id: "r4",
		title: "Frieren: Beyond Journey's End",
		coverUrl: "https://cdn.myanimelist.net/images/anime/1015/138006.jpg",
		type: "Anime",
		action: "Finished",
		time: "Yesterday",
		rating: 5,
	},
	{
		id: "r5",
		title: "The Name of the Wind",
		coverUrl: "https://covers.openlibrary.org/b/id/9256378-L.jpg",
		type: "Book",
		action: "Put on hold",
		time: "2d ago",
		rating: null,
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

function MiniProgressBar(props: { value: number; isDark: boolean }) {
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
				style={{ backgroundColor: GOLD, borderRadius: 2 }}
			/>
		</Box>
	);
}

function InProgressCard(props: {
	title: string;
	subtitle: string;
	coverUrl: string;
	typeBadge: string;
	progressPct?: number;
	progressLabel?: string;
	isDark: boolean;
}) {
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
						backgroundImage: `url(${props.coverUrl})`,
						backgroundSize: "cover",
						backgroundPosition: "center",
						minHeight: 96,
					}}
				/>
				<Stack gap={6} p="sm" style={{ flex: 1, minWidth: 0 }}>
					<Text
						fz={10}
						fw={600}
						c={GOLD}
						ff="var(--mantine-headings-font-family)"
						style={{ textTransform: "uppercase", letterSpacing: "0.8px" }}
					>
						{props.typeBadge}
					</Text>
					<Text
						ff="var(--mantine-headings-font-family)"
						fw={600}
						fz="sm"
						c={textPrimary}
						lineClamp={2}
						lh={1.3}
					>
						{props.title}
					</Text>
					<Text fz="xs" c={textMuted} lineClamp={1}>
						{props.subtitle}
					</Text>
					{props.progressPct !== undefined && (
						<Box>
							<MiniProgressBar
								value={props.progressPct}
								isDark={props.isDark}
							/>
							<Text
								fz={10}
								c={textMuted}
								ff="var(--mantine-font-family-monospace)"
								mt={3}
							>
								{props.progressLabel}
							</Text>
						</Box>
					)}
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
					<Text fz="xs" c={textMuted}>
						{props.action}
					</Text>
					{props.rating && (
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

	const allItems = [
		...SAMPLE_BOOKS.map((b) => ({ ...b, type: "Book" as const })),
		...SAMPLE_ANIME.map((a) => ({ ...a, type: "Anime" as const })),
		...SAMPLE_MANGA.map((m) => ({ ...m, type: "Manga" as const })),
	];
	const inProgress = allItems.filter(
		(i) => i.status === "reading" || i.status === "watching",
	);
	const completed = allItems.filter((i) => i.status === "completed");
	const onHold = allItems.filter((i) => i.status === "on_hold");

	const categories = [
		{ label: "Books", items: SAMPLE_BOOKS, color: "#8B5E3C" },
		{ label: "Anime", items: SAMPLE_ANIME, color: "#5B7FFF" },
		{ label: "Manga", items: SAMPLE_MANGA, color: GOLD },
	];

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
								{allItems.length} entries across books, anime & manga
							</Text>
						</Box>
						<Group gap="xs">
							<Button
								size="xs"
								leftSection={<Plus size={12} />}
								variant="light"
								color="yellow"
							>
								Book
							</Button>
							<Button
								size="xs"
								leftSection={<Plus size={12} />}
								variant="light"
								color="blue"
							>
								Anime
							</Button>
							<Button
								size="xs"
								leftSection={<Plus size={12} />}
								variant="light"
								color="orange"
							>
								Manga
							</Button>
						</Group>
					</Group>

					<SimpleGrid cols={{ base: 2, sm: 4 }} spacing="sm">
						<StatTile
							value={allItems.length}
							label="Total Entries"
							sub="books, anime & manga"
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
							{SAMPLE_BOOKS.filter((b) => b.status === "reading").map((b) => (
								<InProgressCard
									key={b.id}
									title={b.title}
									subtitle={b.author}
									coverUrl={b.coverUrl}
									typeBadge="Book"
									isDark={isDark}
								/>
							))}
							{SAMPLE_ANIME.filter((a) => a.status === "watching").map((a) => (
								<InProgressCard
									key={a.id}
									title={a.title}
									subtitle={`ep ${a.episodes} of ${a.totalEpisodes}`}
									coverUrl={a.coverUrl}
									typeBadge="Anime"
									progressPct={Math.round((a.episodes / a.totalEpisodes) * 100)}
									progressLabel={`${a.episodes} / ${a.totalEpisodes} episodes`}
									isDark={isDark}
								/>
							))}
							{SAMPLE_MANGA.filter((m) => m.status === "reading").map((m) => (
								<InProgressCard
									key={m.id}
									title={m.title}
									subtitle={`${m.chapters} chapters read`}
									coverUrl={m.coverUrl}
									typeBadge="Manga"
									isDark={isDark}
								/>
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
						<SimpleGrid cols={{ base: 1, sm: 3 }} spacing="sm">
							{categories.map((cat) => {
								const total = cat.items.length;
								const done = cat.items.filter(
									(i) => i.status === "completed",
								).length;
								const active = cat.items.filter(
									(i) => i.status === "reading" || i.status === "watching",
								).length;
								const pct = total > 0 ? Math.round((done / total) * 100) : 0;
								return (
									<Paper
										key={cat.label}
										p="md"
										radius="sm"
										style={{
											background: surface,
											border: `1px solid ${border}`,
										}}
									>
										<Group justify="space-between" mb={8}>
											<Text
												ff="var(--mantine-headings-font-family)"
												fw={600}
												fz="sm"
												c={textPrimary}
											>
												{cat.label}
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
										<MiniProgressBar value={pct} isDark={isDark} />
										<Group gap="md" mt={6}>
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
