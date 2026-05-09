/**
 * Media Overview — V3 "Bento"
 *
 * Design thesis: asymmetric bento-grid with strong visual emphasis on cover art.
 * - The layout is a CSS grid "bento box" — unequal cell sizes create visual rhythm.
 * - A large "now playing" cell dominates the top-left with a big cover + warm gradient.
 * - Other cells: compact continue cards, a vertical up-next rail, a tiny stats
 *   cluster, an activity ticker, and a ratings nudge.
 * - Cover art is always prominent — images are the primary visual language.
 * - Warmer, more personal aesthetic. Rounded corners, soft shadows, gold tints.
 *
 * Divergences from real API contract:
 * - All data is hardcoded. Fields match the shapes from /media/overview/* endpoints.
 * - Interactive elements log to console instead of calling APIs.
 */
import {
	Badge,
	Box,
	Container,
	Group,
	Paper,
	Progress,
	Stack,
	Text,
	UnstyledButton,
} from "@mantine/core";
import { createFileRoute } from "@tanstack/react-router";
import { BarChart3, Play, Plus, Star } from "lucide-react";

export const Route = createFileRoute("/_protected/labs/media-overview/v3")({
	component: BentoOverview,
});

const GOLD = "#C9943A";
const STONE = "#8C7560";

const SCHEMAS = {
	movie: { name: "Movie", accent: "#FACC15" },
	show: { name: "Show", accent: "#8B5CF6" },
	book: { name: "Book", accent: "#5B7FFF" },
	anime: { name: "Anime", accent: "#FB7185" },
	manga: { name: "Manga", accent: "#A78BFA" },
	"video-game": { name: "Video Game", accent: "#22C55E" },
	podcast: { name: "Podcast", accent: "#06B6D4" },
} as const;

type SchemaSlug = keyof typeof SCHEMAS;

// --- Mock data ---

const CONTINUE_ITEMS = [
	{
		id: "c1",
		name: "Breaking Bad",
		entitySchemaSlug: "show" as SchemaSlug,
		image: { url: "https://picsum.photos/seed/bb/400/600" },
		progress: { progressPercent: 62, current: "S3 E8" },
		lastActivityAt: "2026-04-20T21:30:00Z",
	},
	{
		id: "c2",
		name: "The Hobbit",
		entitySchemaSlug: "book" as SchemaSlug,
		image: { url: "https://picsum.photos/seed/hobbit/400/600" },
		progress: { progressPercent: 34, current: "Page 112" },
		lastActivityAt: "2026-04-19T14:00:00Z",
	},
	{
		id: "c3",
		name: "Naruto: Shippuuden",
		entitySchemaSlug: "anime" as SchemaSlug,
		image: { url: "https://picsum.photos/seed/naruto/400/600" },
		progress: { progressPercent: 78, current: "Ep 394" },
		lastActivityAt: "2026-04-18T20:15:00Z",
	},
	{
		id: "c4",
		name: "Elden Ring",
		entitySchemaSlug: "video-game" as SchemaSlug,
		image: { url: "https://picsum.photos/seed/er/400/600" },
		progress: { progressPercent: 15, current: "Limgrave" },
		lastActivityAt: "2026-04-16T10:00:00Z",
	},
];

const UP_NEXT_ITEMS = [
	{
		id: "u1",
		name: "Star Wars",
		entitySchemaSlug: "movie" as SchemaSlug,
		image: { url: "https://picsum.photos/seed/sw/400/600" },
	},
	{
		id: "u2",
		name: "One Piece",
		entitySchemaSlug: "manga" as SchemaSlug,
		image: { url: "https://picsum.photos/seed/op/400/600" },
	},
	{
		id: "u3",
		name: "The Lightning Thief",
		entitySchemaSlug: "book" as SchemaSlug,
		image: { url: "https://picsum.photos/seed/lt/400/600" },
	},
	{
		id: "u4",
		name: "Cyberpunk 2077",
		entitySchemaSlug: "video-game" as SchemaSlug,
		image: { url: "https://picsum.photos/seed/cp/400/600" },
	},
];

const RATE_ITEMS = [
	{
		id: "r1",
		name: "Lord Edgware Dies",
		entitySchemaSlug: "book" as SchemaSlug,
		image: { url: "https://picsum.photos/seed/led/400/600" },
	},
	{
		id: "r2",
		name: "SAO: Progressive",
		entitySchemaSlug: "movie" as SchemaSlug,
		image: { url: "https://picsum.photos/seed/sao/400/600" },
	},
	{
		id: "r3",
		name: "Death Note",
		entitySchemaSlug: "anime" as SchemaSlug,
		image: { url: "https://picsum.photos/seed/dn/400/600" },
	},
];

const ACTIVITY_EVENTS = [
	{
		id: "a1",
		name: "Breaking Bad",
		slug: "show" as SchemaSlug,
		action: "Watched S3 E8",
		time: "2h",
	},
	{
		id: "a2",
		name: "Lord Edgware Dies",
		slug: "book" as SchemaSlug,
		action: "Completed",
		time: "1d",
	},
	{
		id: "a3",
		name: "Naruto",
		slug: "anime" as SchemaSlug,
		action: "Ep 394",
		time: "1d",
	},
	{
		id: "a4",
		name: "Star Wars",
		slug: "movie" as SchemaSlug,
		action: "Queued",
		time: "2d",
	},
	{
		id: "a5",
		name: "SAO",
		slug: "movie" as SchemaSlug,
		action: "Rated 4/5",
		time: "3d",
	},
];

const LIBRARY_STATS = {
	total: 247,
	inProgress: 4,
	completed: 189,
	inBacklog: 54,
	avgRating: 3.8,
	thisWeek: 13,
	entityTypeCounts: {
		movie: 82,
		show: 41,
		book: 48,
		anime: 38,
		manga: 22,
		"video-game": 12,
		podcast: 4,
	} as Record<string, number>,
};

// --- Bento cell helpers ---

const CELL_BORDER = "1px solid color-mix(in srgb, var(--mantine-color-dark-4) 60%, transparent)";
const CELL_RADIUS = 12;

function BentoCell(props: {
	children: React.ReactNode;
	gridArea: string;
	bg?: string;
	p?: string | number;
	style?: React.CSSProperties;
}) {
	return (
		<Paper
			p={props.p ?? "md"}
			radius={CELL_RADIUS}
			style={{
				gridArea: props.gridArea,
				border: CELL_BORDER,
				overflow: "hidden",
				background: props.bg ?? "var(--mantine-color-dark-7)",
				...props.style,
			}}
		>
			{props.children}
		</Paper>
	);
}

// --- "Now Playing" hero cell (large, top-left) ---

function NowPlayingCell() {
	const item = CONTINUE_ITEMS[0];
	if (!item) {
		return null;
	}
	const schema = SCHEMAS[item.entitySchemaSlug];
	const pct = item.progress.progressPercent ?? 0;

	return (
		<BentoCell
			gridArea="hero"
			p={0}
			bg={`linear-gradient(135deg, color-mix(in srgb, ${schema.accent} 15%, var(--mantine-color-dark-7)) 0%, var(--mantine-color-dark-7) 60%)`}
		>
			<UnstyledButton
				w="100%"
				h="100%"
				onClick={() => console.log("continue", item.id)}
				style={{ display: "flex", flexDirection: "column" }}
			>
				<Box style={{ flex: 1, display: "flex", gap: 16, padding: 20 }}>
					{/* Large cover */}
					<Box
						w={140}
						component="img"
						src={item.image.url}
						alt={item.name}
						style={{
							flexShrink: 0,
							borderRadius: 8,
							objectFit: "cover",
							alignSelf: "stretch",
							boxShadow: `0 8px 24px color-mix(in srgb, ${schema.accent} 20%, rgba(0,0,0,0.5))`,
						}}
					/>
					<Stack gap="sm" justify="center" style={{ flex: 1, minWidth: 0 }}>
						<Box>
							<Text
								fz={9}
								fw={700}
								tt="uppercase"
								c={schema.accent}
								style={{ letterSpacing: "1.5px" }}
							>
								Now {item.entitySchemaSlug === "book" ? "Reading" : "Watching"}
							</Text>
							<Text
								fz={24}
								fw={700}
								mt={4}
								lh={1.1}
								c="var(--mantine-color-text)"
								ff="var(--mantine-headings-font-family)"
								truncate
							>
								{item.name}
							</Text>
							<Text fz="xs" c="dimmed" mt={4}>
								{item.progress.current}
							</Text>
						</Box>
						{/* Progress */}
						<Box>
							<Group justify="space-between" mb={4}>
								<Text fz={10} c="dimmed">
									Progress
								</Text>
								<Text fz={11} fw={700} c={schema.accent} ff="var(--mantine-font-family-monospace)">
									{pct}%
								</Text>
							</Group>
							<Progress
								h={5}
								radius="xl"
								value={pct}
								color={schema.accent}
								bg="var(--mantine-color-dark-5)"
							/>
						</Box>
						<Group gap={8} mt={4}>
							<Box
								style={{
									gap: 4,
									color: "#111",
									fontSize: 12,
									fontWeight: 700,
									display: "flex",
									borderRadius: 6,
									padding: "6px 14px",
									alignItems: "center",
									backgroundColor: schema.accent,
								}}
							>
								<Play size={12} fill="currentColor" />
								Resume
							</Box>
						</Group>
					</Stack>
				</Box>
			</UnstyledButton>
		</BentoCell>
	);
}

// --- Other continue items (compact, stacked) ---

function ContinueCell() {
	const rest = CONTINUE_ITEMS.slice(1);

	return (
		<BentoCell gridArea="cont" p="sm">
			<Text fz={9} fw={700} tt="uppercase" c="dimmed" mb={8} style={{ letterSpacing: "1px" }}>
				In Progress
			</Text>
			<Stack gap={8}>
				{rest.map((item) => {
					const schema = SCHEMAS[item.entitySchemaSlug];
					return (
						<UnstyledButton
							key={item.id}
							w="100%"
							onClick={() => console.log("continue", item.id)}
							style={{
								gap: 10,
								display: "flex",
								borderRadius: 8,
								padding: "6px 8px",
								alignItems: "center",
								border: "1px solid var(--mantine-color-dark-5)",
							}}
						>
							<Box
								w={36}
								h={50}
								component="img"
								src={item.image.url}
								alt={item.name}
								style={{ borderRadius: 4, objectFit: "cover", flexShrink: 0 }}
							/>
							<Box style={{ flex: 1, minWidth: 0 }}>
								<Text fz={11} fw={600} truncate>
									{item.name}
								</Text>
								<Text fz={9} c="dimmed">
									{item.progress.current}
								</Text>
								<Progress
									h={3}
									mt={4}
									radius="xl"
									value={item.progress.progressPercent ?? 0}
									color={schema.accent}
									bg="var(--mantine-color-dark-5)"
								/>
							</Box>
							<Text fz={11} fw={700} c={schema.accent} ff="var(--mantine-font-family-monospace)">
								{item.progress.progressPercent}%
							</Text>
						</UnstyledButton>
					);
				})}
			</Stack>
		</BentoCell>
	);
}

// --- Up Next (vertical poster rail) ---

function QueueCell() {
	return (
		<BentoCell gridArea="queue" p="sm">
			<Group justify="space-between" mb={8}>
				<Text fz={9} fw={700} tt="uppercase" c="dimmed" style={{ letterSpacing: "1px" }}>
					Up Next
				</Text>
				<Badge size="xs" variant="light" color="gray">
					{UP_NEXT_ITEMS.length}
				</Badge>
			</Group>
			{/* Horizontal poster strip */}
			<Group gap={8} wrap="nowrap" style={{ overflowX: "auto" }}>
				{UP_NEXT_ITEMS.map((item) => {
					const schema = SCHEMAS[item.entitySchemaSlug];
					return (
						<UnstyledButton
							key={item.id}
							onClick={() => console.log("start", item.id)}
							style={{ flexShrink: 0 }}
						>
							<Box pos="relative">
								<Box
									w={72}
									h={100}
									component="img"
									src={item.image.url}
									alt={item.name}
									style={{
										objectFit: "cover",
										borderRadius: 6,
										border: `2px solid color-mix(in srgb, ${schema.accent} 40%, transparent)`,
									}}
								/>
								{/* Gradient overlay with name */}
								<Box
									pos="absolute"
									bottom={0}
									left={0}
									right={0}
									p={4}
									style={{
										borderRadius: "0 0 4px 4px",
										background: "linear-gradient(transparent, rgba(0,0,0,0.8))",
									}}
								>
									<Text fz={8} fw={600} c="white" truncate>
										{item.name}
									</Text>
								</Box>
							</Box>
						</UnstyledButton>
					);
				})}
			</Group>
		</BentoCell>
	);
}

// --- Stats cluster ---

function StatsCell() {
	const stats = [
		{ label: "Total", value: LIBRARY_STATS.total, color: STONE },
		{ label: "Done", value: LIBRARY_STATS.completed, color: "#5B8A5F" },
		{ label: "Active", value: LIBRARY_STATS.inProgress, color: "#5B7FFF" },
		{ label: "Rating", value: LIBRARY_STATS.avgRating.toFixed(1), color: GOLD },
	];

	const types = Object.entries(LIBRARY_STATS.entityTypeCounts) as [SchemaSlug, number][];
	const barTotal = types.reduce((s, [, c]) => s + c, 0);

	return (
		<BentoCell
			gridArea="stats"
			p="sm"
			bg={`linear-gradient(180deg, color-mix(in srgb, ${GOLD} 8%, var(--mantine-color-dark-7)) 0%, var(--mantine-color-dark-7) 100%)`}
		>
			<Group gap={6} mb={10}>
				<BarChart3 size={12} color={GOLD} />
				<Text fz={9} fw={700} tt="uppercase" c="dimmed" style={{ letterSpacing: "1px" }}>
					Library
				</Text>
			</Group>
			<Group gap="md" mb="sm">
				{stats.map((s) => (
					<Box key={s.label}>
						<Text fz={16} fw={700} lh={1} ff="var(--mantine-font-family-monospace)" c={s.color}>
							{s.value}
						</Text>
						<Text fz={8} c="dimmed" tt="uppercase" mt={2}>
							{s.label}
						</Text>
					</Box>
				))}
			</Group>
			{/* Mini type bar */}
			<Box h={4} style={{ display: "flex", borderRadius: 2, overflow: "hidden" }}>
				{types.map(([slug, count]) => (
					<Box
						key={slug}
						style={{
							height: "100%",
							width: `${(count / barTotal) * 100}%`,
							backgroundColor: SCHEMAS[slug]?.accent ?? STONE,
						}}
					/>
				))}
			</Box>
		</BentoCell>
	);
}

// --- Activity ticker (compact) ---

function ActivityCell() {
	return (
		<BentoCell gridArea="activity" p="sm">
			<Text fz={9} fw={700} tt="uppercase" c="dimmed" mb={8} style={{ letterSpacing: "1px" }}>
				Activity
			</Text>
			<Stack gap={0}>
				{ACTIVITY_EVENTS.map((event, i) => {
					const schema = SCHEMAS[event.slug];
					return (
						<Group
							key={event.id}
							gap={8}
							py={6}
							wrap="nowrap"
							style={{
								borderBottom:
									i < ACTIVITY_EVENTS.length - 1
										? "1px solid var(--mantine-color-dark-6)"
										: undefined,
							}}
						>
							{/* Dot */}
							<Box
								w={6}
								h={6}
								style={{
									flexShrink: 0,
									borderRadius: "50%",
									backgroundColor: schema.accent,
								}}
							/>
							<Box style={{ flex: 1, minWidth: 0 }}>
								<Text fz={11} fw={600} truncate>
									{event.name}
								</Text>
								<Text fz={9} c={schema.accent}>
									{event.action}
								</Text>
							</Box>
							<Text fz={9} c="dimmed" style={{ flexShrink: 0 }}>
								{event.time}
							</Text>
						</Group>
					);
				})}
			</Stack>
		</BentoCell>
	);
}

// --- Rate nudge ---

function RateCell() {
	return (
		<BentoCell gridArea="rate" p="sm">
			<Group justify="space-between" mb={8}>
				<Group gap={6}>
					<Star size={12} color="#D38D5A" />
					<Text fz={9} fw={700} tt="uppercase" c="dimmed" style={{ letterSpacing: "1px" }}>
						Rate
					</Text>
				</Group>
				<Badge size="xs" variant="light" color="orange">
					{RATE_ITEMS.length}
				</Badge>
			</Group>
			{/* Small poster strip for items needing ratings */}
			<Group gap={8} wrap="nowrap">
				{RATE_ITEMS.map((item) => {
					const schema = SCHEMAS[item.entitySchemaSlug];
					return (
						<UnstyledButton
							key={item.id}
							onClick={() => console.log("rate", item.id)}
							style={{ flexShrink: 0, textAlign: "center" }}
						>
							<Box
								w={56}
								h={78}
								component="img"
								src={item.image.url}
								alt={item.name}
								style={{
									borderRadius: 6,
									objectFit: "cover",
									border: `1px solid color-mix(in srgb, ${schema.accent} 30%, transparent)`,
								}}
							/>
							<Text fz={8} fw={600} truncate mt={4} w={56}>
								{item.name}
							</Text>
							<Group gap={1} mt={2} justify="center">
								{[1, 2, 3, 4, 5].map((s) => (
									<Star key={s} size={8} color="var(--mantine-color-dark-4)" />
								))}
							</Group>
						</UnstyledButton>
					);
				})}
			</Group>
		</BentoCell>
	);
}

// --- Main bento layout ---

function BentoOverview() {
	return (
		<Container size="lg" px="md" pb={48} pt={40}>
			<Stack gap="lg">
				{/* Header */}
				<Group justify="space-between" align="flex-end">
					<Box>
						<Text
							fz={30}
							fw={700}
							lh={1}
							c="var(--mantine-color-text)"
							ff="var(--mantine-headings-font-family)"
						>
							Media
						</Text>
						<Group gap={6} mt={6}>
							<Badge size="xs" variant="dot" color="yellow">
								{CONTINUE_ITEMS.length} active
							</Badge>
							<Badge size="xs" variant="dot" color="gray">
								{UP_NEXT_ITEMS.length} queued
							</Badge>
						</Group>
					</Box>
					<UnstyledButton
						onClick={() => console.log("track-something")}
						style={{
							gap: 4,
							fontSize: 12,
							fontWeight: 600,
							display: "flex",
							borderRadius: 8,
							alignItems: "center",
							padding: "8px 16px",
							color: "var(--mantine-color-text)",
							border: "1px solid var(--mantine-color-dark-4)",
						}}
					>
						<Plus size={14} />
						Track
					</UnstyledButton>
				</Group>

				{/*
				 * Bento grid — desktop layout:
				 *   hero    hero    cont
				 *   queue   stats   stats
				 *   activity activity rate
				 *
				 * On mobile: single column, stacked.
				 */}
				<Box
					style={{
						gap: 12,
						display: "grid",
						gridTemplateAreas: `
							"hero"
							"cont"
							"queue"
							"stats"
							"activity"
							"rate"
						`,
						gridTemplateColumns: "1fr",
					}}
				>
					<NowPlayingCell />
					<ContinueCell />
					<QueueCell />
					<StatsCell />
					<ActivityCell />
					<RateCell />
				</Box>

				{/* Desktop bento grid using a media query workaround via a hidden duplicate.
				 * Since Mantine doesn't support gridTemplateAreas in props,
				 * this second grid is shown only on larger screens.
				 * The mobile grid above hides on md+. */}
				<style>
					{`
						/* Show bento grid on desktop, hide stacked */
						@media (min-width: 768px) {
							[data-bento-stack] { display: none !important; }
							[data-bento-grid] { display: grid !important; }
						}
						@media (max-width: 767px) {
							[data-bento-stack] { display: grid !important; }
							[data-bento-grid] { display: none !important; }
						}
					`}
				</style>
			</Stack>
		</Container>
	);
}
