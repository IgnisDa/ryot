// Analytics-first design: personal year-in-review feel.
// No external chart library — all visualizations built with CSS/SVG/Box.
// Includes: status ring, entries-per-type bars, activity heatmap, rating distribution,
// top-rated per type, and completion rate breakdown.

import {
	Box,
	Container,
	Grid,
	Group,
	Paper,
	SimpleGrid,
	Stack,
	Text,
} from "@mantine/core";
import { createFileRoute } from "@tanstack/react-router";
import { useColorScheme } from "#/hooks/theme";

export const Route = createFileRoute("/_protected/labs/media-overview/v4")({
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

interface MediaItem {
	id: string;
	title: string;
	type: MediaType;
	status: string;
	coverUrl: string;
	rating: number | null;
	sub: string;
}

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

// Heatmap: 18 weeks × 7 days. Seed some activity counts.
const HEATMAP_WEEKS = 18;
const HEATMAP_DAYS = 7;
const HEATMAP_DATA: number[][] = Array.from({ length: HEATMAP_WEEKS }, (_, w) =>
	Array.from({ length: HEATMAP_DAYS }, (_, d) => {
		const seed = (w * 7 + d * 3 + w * d) % 17;
		if (seed < 5) {
			return 0;
		}
		if (seed < 9) {
			return 1;
		}
		if (seed < 13) {
			return 2;
		}
		if (seed < 16) {
			return 3;
		}
		return 4;
	}),
);

// SVG ring chart — draws arc segments for each slice
function RingChart(props: {
	slices: Array<{ value: number; color: string; label: string }>;
	size: number;
	thickness: number;
}) {
	const total = props.slices.reduce((s, sl) => s + sl.value, 0);
	if (total === 0) {
		return null;
	}
	const cx = props.size / 2;
	const cy = props.size / 2;
	const r = (props.size - props.thickness) / 2;
	const gap = 0.025; // radians gap between slices

	let angle = -Math.PI / 2;
	const paths: Array<{
		d: string;
		color: string;
		label: string;
		value: number;
	}> = [];

	for (const slice of props.slices) {
		const span = (slice.value / total) * (2 * Math.PI) - gap;
		if (span <= 0) {
			continue;
		}
		const startAngle = angle + gap / 2;
		const endAngle = startAngle + span;
		const x1 = cx + r * Math.cos(startAngle);
		const y1 = cy + r * Math.sin(startAngle);
		const x2 = cx + r * Math.cos(endAngle);
		const y2 = cy + r * Math.sin(endAngle);
		const largeArc = span > Math.PI ? 1 : 0;
		paths.push({
			d: `M ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2}`,
			color: slice.color,
			label: slice.label,
			value: slice.value,
		});
		angle += (slice.value / total) * (2 * Math.PI);
	}

	return (
		<svg
			width={props.size}
			height={props.size}
			viewBox={`0 0 ${props.size} ${props.size}`}
			style={{ display: "block" }}
			aria-label="Status breakdown ring chart"
			role="img"
		>
			<title>Status breakdown ring chart</title>
			{paths.map((p) => (
				<path
					key={p.label}
					d={p.d}
					fill="none"
					stroke={p.color}
					strokeWidth={props.thickness}
					strokeLinecap="round"
					aria-label={`${p.label}: ${p.value}`}
				/>
			))}
		</svg>
	);
}

function ChartCard(props: {
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
				mb="md"
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
	const trackColor = isDark
		? "var(--mantine-color-dark-5)"
		: "var(--mantine-color-stone-2)";
	const heatEmpty = isDark ? "var(--mantine-color-dark-6)" : "#e8e2d9";

	// --- Derived stats ---
	const total = ALL_MEDIA.length;
	const completedItems = ALL_MEDIA.filter((i) => i.status === "completed");
	const activeItems = ALL_MEDIA.filter((i) =>
		["reading", "watching", "listening", "playing"].includes(i.status),
	);
	const onHoldItems = ALL_MEDIA.filter(
		(i) => i.status === "on_hold" || i.status === "dropped",
	);
	const ratedItems = ALL_MEDIA.filter((i) => i.rating !== null);
	const avgRating =
		ratedItems.length > 0
			? ratedItems.reduce((s, i) => s + (i.rating ?? 0), 0) / ratedItems.length
			: 0;

	// Status ring slices
	const statusSlices = [
		{
			label: "Completed",
			value: completedItems.length,
			color: "#5B8A5F",
		},
		{ label: "Active", value: activeItems.length, color: GOLD },
		{ label: "On Hold", value: onHoldItems.length, color: "#E09840" },
	];

	// Entries per type — sorted desc
	const typeGroups: Record<string, MediaItem[]> = {};
	for (const item of ALL_MEDIA) {
		if (!typeGroups[item.type]) {
			typeGroups[item.type] = [];
		}
		// biome-ignore lint/style/noNonNullAssertion: just assigned above
		typeGroups[item.type]!.push(item);
	}
	const typeRows = Object.entries(typeGroups)
		.map(([type, items]) => ({
			type,
			count: items.length,
			color: TYPE_COLORS[type] ?? GOLD,
			completed: items.filter((i) => i.status === "completed").length,
		}))
		.sort((a, b) => b.count - a.count);
	const maxTypeCount = typeRows[0]?.count ?? 1;

	// Rating distribution 1–5
	const ratingBuckets = [1, 2, 3, 4, 5].map((star) => ({
		star,
		count: ALL_MEDIA.filter((i) => i.rating === star).length,
	}));
	const maxRatingCount = Math.max(...ratingBuckets.map((b) => b.count), 1);

	// Top-rated items (rating 5) — up to 5, most recent first
	const topRated = ALL_MEDIA.filter((i) => i.rating === 5).slice(0, 5);

	// Heatmap intensity levels → colors
	function heatColor(level: number): string {
		if (level === 0) {
			return heatEmpty;
		}
		const alpha = 0.25 + level * 0.19;
		return isDark
			? `rgba(201, 148, 58, ${alpha})`
			: `rgba(139, 94, 60, ${alpha + 0.1})`;
	}

	return (
		<Box bg={bgPage} mih="100vh">
			<Container size="lg" py="xl">
				<Stack gap="xl">
					{/* Header */}
					<Box>
						<Text
							ff="var(--mantine-headings-font-family)"
							fw={700}
							fz={28}
							c={textPrimary}
							lh={1.1}
						>
							My Media · Analytics
						</Text>
						<Text fz="sm" c={textMuted} mt={4}>
							{total} entries · {ratedItems.length} rated ·{" "}
							{avgRating.toFixed(1)} avg rating
						</Text>
					</Box>

					{/* Summary stat pills */}
					<SimpleGrid cols={{ base: 2, sm: 4 }} spacing="sm">
						{[
							{ value: total, label: "Total", color: textPrimary },
							{
								value: completedItems.length,
								label: "Completed",
								color: "#5B8A5F",
							},
							{ value: activeItems.length, label: "Active", color: GOLD },
							{
								value: onHoldItems.length,
								label: "On Hold",
								color: "#E09840",
							},
						].map((s) => (
							<Paper
								key={s.label}
								p="md"
								radius="sm"
								style={{
									background: surface,
									border: `1px solid ${border}`,
								}}
							>
								<Text
									ff="var(--mantine-font-family-monospace)"
									fz={32}
									fw={700}
									c={s.color}
									lh={1}
								>
									{s.value}
								</Text>
								<Text
									ff="var(--mantine-headings-font-family)"
									fw={600}
									fz="sm"
									c={textMuted}
									mt={4}
								>
									{s.label}
								</Text>
							</Paper>
						))}
					</SimpleGrid>

					{/* Row: Status ring + Rating distribution */}
					<Grid>
						<Grid.Col span={{ base: 12, sm: 5 }}>
							<ChartCard title="Status breakdown" isDark={isDark}>
								<Group gap="lg" align="center" wrap="nowrap">
									<Box style={{ position: "relative", flexShrink: 0 }}>
										<RingChart
											slices={statusSlices}
											size={120}
											thickness={16}
										/>
										<Box
											style={{
												position: "absolute",
												inset: 0,
												display: "flex",
												flexDirection: "column",
												alignItems: "center",
												justifyContent: "center",
											}}
										>
											<Text
												ff="var(--mantine-font-family-monospace)"
												fw={700}
												fz={20}
												c={GOLD}
												lh={1}
											>
												{total}
											</Text>
											<Text fz={9} c={textMuted} mt={2}>
												total
											</Text>
										</Box>
									</Box>
									<Stack gap={8} style={{ flex: 1 }}>
										{statusSlices.map((s) => (
											<Group key={s.label} gap={8} wrap="nowrap">
												<Box
													w={10}
													h={10}
													style={{
														borderRadius: "50%",
														backgroundColor: s.color,
														flexShrink: 0,
													}}
												/>
												<Text fz="xs" c={textMuted} style={{ flex: 1 }}>
													{s.label}
												</Text>
												<Text
													fz="xs"
													fw={600}
													ff="var(--mantine-font-family-monospace)"
													c={s.color}
												>
													{s.value}
												</Text>
											</Group>
										))}
									</Stack>
								</Group>
							</ChartCard>
						</Grid.Col>

						<Grid.Col span={{ base: 12, sm: 7 }}>
							<ChartCard title="Rating distribution" isDark={isDark}>
								<Stack gap={8}>
									{[...ratingBuckets].reverse().map((b) => (
										<Group key={b.star} gap={10} wrap="nowrap" align="center">
											<Text
												fz={11}
												fw={600}
												ff="var(--mantine-font-family-monospace)"
												c={GOLD}
												style={{ width: 14, textAlign: "right", flexShrink: 0 }}
											>
												{b.star}
											</Text>
											<Text fz={10} c={GOLD} style={{ flexShrink: 0 }}>
												★
											</Text>
											<Box
												style={{
													flex: 1,
													height: 10,
													borderRadius: 3,
													background: trackColor,
													overflow: "hidden",
												}}
											>
												<Box
													h="100%"
													style={{
														width: `${(b.count / maxRatingCount) * 100}%`,
														backgroundColor: GOLD,
														borderRadius: 3,
													}}
												/>
											</Box>
											<Text
												fz={11}
												fw={600}
												ff="var(--mantine-font-family-monospace)"
												c={textMuted}
												style={{ width: 18, textAlign: "right", flexShrink: 0 }}
											>
												{b.count}
											</Text>
										</Group>
									))}
								</Stack>
							</ChartCard>
						</Grid.Col>
					</Grid>

					{/* Entries per type — horizontal bar chart */}
					<ChartCard title="Entries by type" isDark={isDark}>
						<Stack gap={10}>
							{typeRows.map((row) => {
								const pct = Math.round((row.count / maxTypeCount) * 100);
								const completePct =
									row.count > 0
										? Math.round((row.completed / row.count) * 100)
										: 0;
								return (
									<Group key={row.type} gap={10} wrap="nowrap" align="center">
										<Text
											fz={11}
											fw={600}
											ff="var(--mantine-headings-font-family)"
											c={row.color}
											style={{ width: 84, flexShrink: 0 }}
										>
											{row.type}
										</Text>
										<Box
											style={{
												flex: 1,
												height: 12,
												borderRadius: 4,
												background: trackColor,
												overflow: "hidden",
												position: "relative",
											}}
										>
											{/* Background bar (total) */}
											<Box
												style={{
													position: "absolute",
													left: 0,
													top: 0,
													bottom: 0,
													width: `${pct}%`,
													borderRadius: 4,
													backgroundColor: `${row.color}44`,
												}}
											/>
											{/* Foreground bar (completed) */}
											<Box
												style={{
													position: "absolute",
													left: 0,
													top: 0,
													bottom: 0,
													width: `${(completePct / 100) * pct}%`,
													borderRadius: 4,
													backgroundColor: row.color,
												}}
											/>
										</Box>
										<Text
											fz={11}
											fw={600}
											ff="var(--mantine-font-family-monospace)"
											c={textMuted}
											style={{ width: 20, textAlign: "right", flexShrink: 0 }}
										>
											{row.count}
										</Text>
										<Text
											fz={10}
											c={textMuted}
											style={{ width: 48, flexShrink: 0 }}
										>
											{completePct}% done
										</Text>
									</Group>
								);
							})}
						</Stack>
						<Group gap="lg" mt="md">
							<Group gap={6}>
								<Box
									w={10}
									h={10}
									style={{
										borderRadius: 2,
										backgroundColor: `${GOLD}44`,
										flexShrink: 0,
									}}
								/>
								<Text fz={10} c={textMuted}>
									tracked
								</Text>
							</Group>
							<Group gap={6}>
								<Box
									w={10}
									h={10}
									style={{
										borderRadius: 2,
										backgroundColor: GOLD,
										flexShrink: 0,
									}}
								/>
								<Text fz={10} c={textMuted}>
									completed
								</Text>
							</Group>
						</Group>
					</ChartCard>

					{/* Activity heatmap */}
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
							mb="md"
						>
							Activity · last 18 weeks
						</Text>
						<Box style={{ overflowX: "auto" }}>
							<Group gap={3} wrap="nowrap" align="flex-start">
								{HEATMAP_DATA.map((week, wi) => (
									<Stack key={`week-${wi}`} gap={3} style={{ flexShrink: 0 }}>
										{week.map((level, di) => (
											<Box
												key={`day-${di}`}
												w={13}
												h={13}
												style={{
													borderRadius: 2,
													backgroundColor: heatColor(level),
												}}
											/>
										))}
									</Stack>
								))}
							</Group>
						</Box>
						<Group gap="xs" mt="sm" align="center">
							<Text fz={10} c={textMuted}>
								Less
							</Text>
							{[0, 1, 2, 3, 4].map((level) => (
								<Box
									key={level}
									w={11}
									h={11}
									style={{
										borderRadius: 2,
										backgroundColor: heatColor(level),
										flexShrink: 0,
									}}
								/>
							))}
							<Text fz={10} c={textMuted}>
								More
							</Text>
						</Group>
					</Paper>

					{/* Top rated */}
					<Grid>
						<Grid.Col span={{ base: 12, md: 7 }}>
							<ChartCard title="Top rated" isDark={isDark}>
								<Stack gap="sm">
									{topRated.map((item, i) => (
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
											<Text
												fz={11}
												fw={700}
												ff="var(--mantine-font-family-monospace)"
												c={GOLD}
												style={{ flexShrink: 0 }}
											>
												★{item.rating}
											</Text>
										</Group>
									))}
								</Stack>
							</ChartCard>
						</Grid.Col>

						<Grid.Col span={{ base: 12, md: 5 }}>
							<ChartCard title="Completion rate by type" isDark={isDark}>
								<Stack gap={10}>
									{typeRows
										.filter((r) => r.count > 0)
										.map((row) => {
											const pct =
												row.count > 0
													? Math.round((row.completed / row.count) * 100)
													: 0;
											return (
												<Box key={row.type}>
													<Group justify="space-between" mb={4}>
														<Text
															fz={10}
															fw={600}
															c={row.color}
															ff="var(--mantine-headings-font-family)"
														>
															{row.type}
														</Text>
														<Text
															fz={10}
															fw={600}
															c={textMuted}
															ff="var(--mantine-font-family-monospace)"
														>
															{pct}%
														</Text>
													</Group>
													<Box
														h={5}
														style={{
															borderRadius: 3,
															background: trackColor,
															overflow: "hidden",
														}}
													>
														<Box
															h="100%"
															style={{
																width: `${pct}%`,
																backgroundColor: row.color,
																borderRadius: 3,
															}}
														/>
													</Box>
												</Box>
											);
										})}
								</Stack>
							</ChartCard>
						</Grid.Col>
					</Grid>
				</Stack>
			</Container>
		</Box>
	);
}
