// Journal-first design: a dense, chronological reading/watching log is the main
// column. Stats, quick-add, and on-hold items live in a compact sticky sidebar.

import {
	Box,
	Button,
	Container,
	Grid,
	Group,
	Paper,
	Stack,
	Text,
} from "@mantine/core";
import { createFileRoute } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { useColorScheme } from "#/hooks/theme";

export const Route = createFileRoute("/_protected/labs/media-overview/v3")({
	component: RouteComponent,
});

const GOLD = "#C9943A";

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

interface JournalEntry {
	id: string;
	date: string;
	time: string;
	type: "Book" | "Anime" | "Manga";
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
		type: "Book",
		title: "What to Do When I'm Gone",
		sub: "Suzy Hopkins",
		action: "Started reading",
		actionColor: GOLD,
		coverUrl: "https://covers.openlibrary.org/b/id/10527831-L.jpg",
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
		type: "Anime",
		title: "Dungeon Meshi",
		sub: "12 of 24 episodes",
		action: "Watched episode 12",
		actionColor: "var(--mantine-color-blue-5)",
		coverUrl: "https://cdn.myanimelist.net/images/anime/1628/140081.jpg",
		rating: null,
	},
	{
		id: "j6",
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
		id: "j7",
		date: "3 days ago",
		time: "3d ago",
		type: "Anime",
		title: "Solo Leveling",
		sub: "4 of 12 episodes",
		action: "Watched episode 4",
		actionColor: "var(--mantine-color-blue-5)",
		coverUrl: "https://cdn.myanimelist.net/images/anime/1258/135739.jpg",
		rating: null,
	},
	{
		id: "j8",
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
		id: "j9",
		date: "1 week ago",
		time: "1w ago",
		type: "Manga",
		title: "Berserk",
		sub: "374 chapters",
		action: "Put on hold",
		actionColor: "#E09840",
		coverUrl: "https://cdn.myanimelist.net/images/manga/1/157897.jpg",
		rating: null,
	},
];

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
							c={textMuted}
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

	const allItems = [
		...SAMPLE_BOOKS.map((b) => ({ ...b, type: "Book" as const })),
		...SAMPLE_ANIME.map((a) => ({ ...a, type: "Anime" as const })),
		...SAMPLE_MANGA.map((m) => ({ ...m, type: "Manga" as const })),
	];
	const onHold = allItems.filter((i) => i.status === "on_hold");
	const inProgress = allItems.filter(
		(i) => i.status === "reading" || i.status === "watching",
	);
	const completed = allItems.filter((i) => i.status === "completed");

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
									Your reading & watching log
								</Text>
							</Box>

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
							<SidebarCard title="Quick Add" isDark={isDark}>
								<Stack gap="xs">
									<Button
										size="xs"
										variant="light"
										color="yellow"
										leftSection={<Plus size={11} />}
										fullWidth
										justify="flex-start"
									>
										Book
									</Button>
									<Button
										size="xs"
										variant="light"
										color="blue"
										leftSection={<Plus size={11} />}
										fullWidth
										justify="flex-start"
									>
										Anime
									</Button>
									<Button
										size="xs"
										variant="light"
										color="orange"
										leftSection={<Plus size={11} />}
										fullWidth
										justify="flex-start"
									>
										Manga
									</Button>
								</Stack>
							</SidebarCard>

							<SidebarCard title="Library" isDark={isDark}>
								<Stack gap={6}>
									{[
										{ label: "Total entries", value: allItems.length },
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
													<Text fz={10} c={textMuted}>
														{item.type}
													</Text>
												</Stack>
											</Group>
										))}
									</Stack>
								</SidebarCard>
							)}

							<SidebarCard title="Currently Reading" isDark={isDark}>
								<Stack gap="sm">
									{inProgress.slice(0, 3).map((item, i) => (
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
												<Text fz={10} c={textMuted}>
													{item.type}
												</Text>
											</Stack>
										</Group>
									))}
									{inProgress.length > 3 && (
										<Text
											fz="xs"
											c={textMuted}
											style={{
												paddingTop: 8,
												borderTop: `1px solid ${divider}`,
											}}
										>
											+{inProgress.length - 3} more
										</Text>
									)}
								</Stack>
							</SidebarCard>
						</Stack>
					</Grid.Col>
				</Grid>
			</Container>
		</Box>
	);
}
