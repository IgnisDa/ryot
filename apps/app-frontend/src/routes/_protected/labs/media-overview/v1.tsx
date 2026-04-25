/**
 * Media Overview — V1 "Journal"
 *
 * Design thesis: editorial / magazine layout.
 * - A hero "spotlight" card dominates the top — the single most-recent in-progress item
 *   gets a large cover + blurred backdrop, inviting the user to dive back in.
 * - Below: a two-column layout on desktop — left column holds the actionable queues
 *   (continue, up-next, rate), right column holds an activity timeline + library stats.
 * - Typography-forward: large Space Grotesk headings, generous whitespace, warm tones.
 * - Feels like opening a personal media journal rather than a dashboard.
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
	SimpleGrid,
	Stack,
	Text,
	UnstyledButton,
} from "@mantine/core";
import { createFileRoute } from "@tanstack/react-router";
import {
	Bookmark,
	ChevronRight,
	Clock,
	Play,
	Star,
	TrendingUp,
} from "lucide-react";

export const Route = createFileRoute("/_protected/labs/media-overview/v1")({
	component: JournalOverview,
});

const GOLD = "#C9943A";
const STONE = "#8C7560";

const SCHEMAS = {
	movie: { name: "Movie", accent: "#FACC15", icon: "film" },
	show: { name: "Show", accent: "#8B5CF6", icon: "monitor-play" },
	book: { name: "Book", accent: "#5B7FFF", icon: "book-open" },
	anime: { name: "Anime", accent: "#FB7185", icon: "tv" },
	manga: { name: "Manga", accent: "#A78BFA", icon: "book" },
	"video-game": { name: "Video Game", accent: "#22C55E", icon: "gamepad-2" },
	podcast: { name: "Podcast", accent: "#06B6D4", icon: "podcast" },
} as const;

type SchemaSlug = keyof typeof SCHEMAS;

// --- Mock data matching backend shapes ---

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
];

const UP_NEXT_ITEMS = [
	{
		id: "u1",
		name: "Star Wars",
		entitySchemaSlug: "movie" as SchemaSlug,
		image: { url: "https://picsum.photos/seed/sw/400/600" },
		backlogAt: "2026-04-10T10:00:00Z",
	},
	{
		id: "u2",
		name: "One Piece",
		entitySchemaSlug: "manga" as SchemaSlug,
		image: { url: "https://picsum.photos/seed/op/400/600" },
		backlogAt: "2026-04-05T10:00:00Z",
	},
	{
		id: "u3",
		name: "The Lightning Thief",
		entitySchemaSlug: "book" as SchemaSlug,
		image: { url: "https://picsum.photos/seed/lt/400/600" },
		backlogAt: "2026-03-28T10:00:00Z",
	},
	{
		id: "u4",
		name: "Elden Ring",
		entitySchemaSlug: "video-game" as SchemaSlug,
		image: { url: "https://picsum.photos/seed/er/400/600" },
		backlogAt: "2026-03-15T10:00:00Z",
	},
];

const RATE_ITEMS = [
	{
		id: "r1",
		name: "Lord Edgware Dies",
		entitySchemaSlug: "book" as SchemaSlug,
		image: { url: "https://picsum.photos/seed/led/400/600" },
		completedAt: "2026-04-17T12:00:00Z",
	},
	{
		id: "r2",
		name: "Sword Art Online: Progressive",
		entitySchemaSlug: "movie" as SchemaSlug,
		image: { url: "https://picsum.photos/seed/sao/400/600" },
		completedAt: "2026-04-15T20:00:00Z",
	},
];

const ACTIVITY_EVENTS = [
	{
		id: "a1",
		entityId: "c1",
		entityName: "Breaking Bad",
		entitySchemaSlug: "show" as SchemaSlug,
		action: "Watched",
		detail: "S3 E8",
		occurredAt: "2026-04-21T14:30:00Z",
		rating: null as number | null,
	},
	{
		id: "a2",
		entityId: "r1",
		entityName: "Lord Edgware Dies",
		entitySchemaSlug: "book" as SchemaSlug,
		action: "Completed",
		detail: null as string | null,
		occurredAt: "2026-04-20T22:00:00Z",
		rating: null as number | null,
	},
	{
		id: "a3",
		entityId: "c3",
		entityName: "Naruto: Shippuuden",
		entitySchemaSlug: "anime" as SchemaSlug,
		action: "Watched",
		detail: "Ep 394",
		occurredAt: "2026-04-20T20:15:00Z",
		rating: null as number | null,
	},
	{
		id: "a4",
		entityId: "u1",
		entityName: "Star Wars",
		entitySchemaSlug: "movie" as SchemaSlug,
		action: "Queued",
		detail: null as string | null,
		occurredAt: "2026-04-19T11:00:00Z",
		rating: null as number | null,
	},
	{
		id: "a5",
		entityId: "r2",
		entityName: "Sword Art Online: Progressive",
		entitySchemaSlug: "movie" as SchemaSlug,
		action: "Rated",
		detail: null as string | null,
		occurredAt: "2026-04-18T21:00:00Z",
		rating: 4,
	},
];

const LIBRARY_STATS = {
	total: 247,
	inProgress: 3,
	completed: 189,
	inBacklog: 55,
	avgRating: 3.8,
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

const WEEK_ACTIVITY = [
	{ day: "Mon", count: 2 },
	{ day: "Tue", count: 0 },
	{ day: "Wed", count: 3 },
	{ day: "Thu", count: 1 },
	{ day: "Fri", count: 4 },
	{ day: "Sat", count: 2 },
	{ day: "Sun", count: 1 },
];

// --- Components ---

function HeroSpotlight() {
	const item = CONTINUE_ITEMS[0];
	if (!item) {
		return null;
	}
	const schema = SCHEMAS[item.entitySchemaSlug];

	return (
		<Paper
			radius="md"
			pos="relative"
			style={{
				overflow: "hidden",
				cursor: "pointer",
				border: `1px solid color-mix(in srgb, ${schema.accent} 30%, var(--mantine-color-dark-6))`,
			}}
			onClick={() => console.log("continue", item.id)}
		>
			{/* Blurred backdrop */}
			<Box
				pos="absolute"
				top={0}
				left={0}
				right={0}
				bottom={0}
				style={{
					filter: "blur(40px) saturate(1.5)",
					opacity: 0.3,
					backgroundSize: "cover",
					backgroundPosition: "center",
					backgroundImage: `url(${item.image.url})`,
				}}
			/>
			<Box pos="relative" p="xl">
				<Group gap="xl" align="flex-start" wrap="nowrap">
					{/* Cover art */}
					<Box
						w={160}
						h={240}
						component="img"
						src={item.image.url}
						alt={item.name}
						style={{
							flexShrink: 0,
							borderRadius: 8,
							objectFit: "cover",
							boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
						}}
					/>
					<Stack gap="md" style={{ flex: 1 }}>
						<Box>
							<Text
								fz={10}
								fw={700}
								tt="uppercase"
								c={schema.accent}
								style={{ letterSpacing: "1.5px" }}
							>
								Continue {schema.name}
							</Text>
							<Text
								fz={28}
								fw={700}
								mt={4}
								c="var(--mantine-color-text)"
								ff="var(--mantine-headings-font-family)"
							>
								{item.name}
							</Text>
							{item.progress.current && (
								<Text fz="sm" mt={4} c="dimmed">
									{item.progress.current}
								</Text>
							)}
						</Box>
						{/* Progress bar */}
						<Box maw={300}>
							<Group justify="space-between" mb={4}>
								<Text fz="xs" c="dimmed">
									Progress
								</Text>
								<Text
									fz="xs"
									fw={600}
									ff="var(--mantine-font-family-monospace)"
									c={schema.accent}
								>
									{item.progress.progressPercent}%
								</Text>
							</Group>
							<Progress
								size="sm"
								radius="xl"
								value={item.progress.progressPercent ?? 0}
								color={schema.accent}
								bg="var(--mantine-color-dark-5)"
							/>
						</Box>
						<UnstyledButton
							mt="xs"
							onClick={(e) => {
								e.stopPropagation();
								console.log("play", item.id);
							}}
							style={{
								display: "inline-flex",
								gap: 6,
								padding: "8px 16px",
								color: "#111",
								fontWeight: 600,
								fontSize: 13,
								borderRadius: 6,
								alignItems: "center",
								backgroundColor: schema.accent,
							}}
						>
							<Play size={14} fill="currentColor" />
							Resume
						</UnstyledButton>
					</Stack>
				</Group>
			</Box>
		</Paper>
	);
}

function ContinueStrip() {
	// Skip first item since it's in the hero
	const rest = CONTINUE_ITEMS.slice(1);
	if (rest.length === 0) {
		return null;
	}

	return (
		<Box>
			<Text
				fz={10}
				fw={700}
				tt="uppercase"
				c="dimmed"
				mb="xs"
				style={{ letterSpacing: "1px" }}
			>
				Also in progress
			</Text>
			<Stack gap="xs">
				{rest.map((item) => {
					const schema = SCHEMAS[item.entitySchemaSlug];
					return (
						<UnstyledButton
							key={item.id}
							onClick={() => console.log("continue", item.id)}
							p="sm"
							style={{
								display: "flex",
								gap: 12,
								borderRadius: 8,
								alignItems: "center",
								border: "1px solid var(--mantine-color-dark-4)",
								transition: "background 150ms",
							}}
						>
							<Box
								w={40}
								h={56}
								component="img"
								src={item.image.url}
								alt={item.name}
								style={{ borderRadius: 4, objectFit: "cover", flexShrink: 0 }}
							/>
							<Box style={{ flex: 1, minWidth: 0 }}>
								<Text fz="sm" fw={600} truncate>
									{item.name}
								</Text>
								<Group gap={6} mt={2}>
									<Badge
										size="xs"
										variant="light"
										style={{
											color: schema.accent,
											backgroundColor: `color-mix(in srgb, ${schema.accent} 12%, transparent)`,
										}}
									>
										{schema.name}
									</Badge>
									{item.progress.current && (
										<Text fz={11} c="dimmed">
											{item.progress.current}
										</Text>
									)}
								</Group>
							</Box>
							<Text
								fz="xs"
								fw={600}
								c={schema.accent}
								ff="var(--mantine-font-family-monospace)"
							>
								{item.progress.progressPercent}%
							</Text>
						</UnstyledButton>
					);
				})}
			</Stack>
		</Box>
	);
}

function QueueList() {
	return (
		<Box>
			<Group justify="space-between" mb="xs">
				<Group gap={6}>
					<Bookmark size={14} color={STONE} />
					<Text
						fz={10}
						fw={700}
						tt="uppercase"
						c="dimmed"
						style={{ letterSpacing: "1px" }}
					>
						Up Next
					</Text>
				</Group>
				<Text fz={11} c="dimmed">
					{UP_NEXT_ITEMS.length} queued
				</Text>
			</Group>
			<Stack gap={6}>
				{UP_NEXT_ITEMS.map((item, i) => {
					const schema = SCHEMAS[item.entitySchemaSlug];
					return (
						<UnstyledButton
							key={item.id}
							p="xs"
							onClick={() => console.log("start", item.id)}
							style={{
								gap: 10,
								display: "flex",
								borderRadius: 6,
								alignItems: "center",
								border: "1px solid var(--mantine-color-dark-4)",
							}}
						>
							<Text
								fz={11}
								fw={700}
								c="dimmed"
								w={18}
								ta="center"
								ff="var(--mantine-font-family-monospace)"
							>
								{i + 1}
							</Text>
							<Box
								w={32}
								h={44}
								component="img"
								src={item.image.url}
								alt={item.name}
								style={{ borderRadius: 3, objectFit: "cover", flexShrink: 0 }}
							/>
							<Box style={{ flex: 1, minWidth: 0 }}>
								<Text fz="xs" fw={600} truncate>
									{item.name}
								</Text>
								<Text fz={10} c={schema.accent}>
									{schema.name}
								</Text>
							</Box>
							<ChevronRight size={14} color="var(--mantine-color-dimmed)" />
						</UnstyledButton>
					);
				})}
			</Stack>
		</Box>
	);
}

function UnratedList() {
	if (RATE_ITEMS.length === 0) {
		return null;
	}

	return (
		<Box>
			<Group gap={6} mb="xs">
				<Star size={14} color="#D38D5A" />
				<Text
					fz={10}
					fw={700}
					tt="uppercase"
					c="dimmed"
					style={{ letterSpacing: "1px" }}
				>
					Needs Rating
				</Text>
			</Group>
			<Stack gap={6}>
				{RATE_ITEMS.map((item) => {
					const schema = SCHEMAS[item.entitySchemaSlug];
					return (
						<UnstyledButton
							key={item.id}
							p="xs"
							onClick={() => console.log("rate", item.id)}
							style={{
								gap: 10,
								display: "flex",
								borderRadius: 6,
								alignItems: "center",
								border: "1px solid var(--mantine-color-dark-4)",
							}}
						>
							<Box
								w={32}
								h={44}
								component="img"
								src={item.image.url}
								alt={item.name}
								style={{ borderRadius: 3, objectFit: "cover", flexShrink: 0 }}
							/>
							<Box style={{ flex: 1, minWidth: 0 }}>
								<Text fz="xs" fw={600} truncate>
									{item.name}
								</Text>
								<Text fz={10} c={schema.accent}>
									{schema.name}
								</Text>
							</Box>
							{/* Five empty stars indicating "needs rating" */}
							<Group gap={2}>
								{[1, 2, 3, 4, 5].map((s) => (
									<Star key={s} size={12} color="var(--mantine-color-dark-4)" />
								))}
							</Group>
						</UnstyledButton>
					);
				})}
			</Stack>
		</Box>
	);
}

function ActivityTimeline() {
	return (
		<Box>
			<Group gap={6} mb="sm">
				<Clock size={14} color="#6F8B75" />
				<Text
					fz={10}
					fw={700}
					tt="uppercase"
					c="dimmed"
					style={{ letterSpacing: "1px" }}
				>
					Recent
				</Text>
			</Group>
			<Box
				pl="md"
				style={{ borderLeft: "2px solid var(--mantine-color-dark-4)" }}
			>
				{ACTIVITY_EVENTS.map((event) => {
					const schema = SCHEMAS[event.entitySchemaSlug];
					return (
						<Box key={event.id} mb="md" pos="relative">
							{/* Timeline dot */}
							<Box
								pos="absolute"
								left={-23}
								top={4}
								w={8}
								h={8}
								style={{
									borderRadius: "50%",
									backgroundColor: schema.accent,
								}}
							/>
							<Text fz="xs" fw={600} c="var(--mantine-color-text)">
								{event.entityName}
							</Text>
							<Group gap={6} mt={2}>
								<Text fz={10} c={schema.accent}>
									{event.action}
								</Text>
								{event.detail && (
									<Text fz={10} c="dimmed">
										{event.detail}
									</Text>
								)}
								{event.rating && (
									<Group gap={2}>
										<Star size={10} fill={GOLD} color={GOLD} />
										<Text fz={10} c={GOLD} fw={600}>
											{event.rating}
										</Text>
									</Group>
								)}
							</Group>
						</Box>
					);
				})}
			</Box>
		</Box>
	);
}

function WeekBar() {
	const max = Math.max(...WEEK_ACTIVITY.map((d) => d.count), 1);
	const total = WEEK_ACTIVITY.reduce((s, d) => s + d.count, 0);

	return (
		<Paper
			p="md"
			radius="sm"
			style={{ border: "1px solid var(--mantine-color-dark-4)" }}
		>
			<Group justify="space-between" mb="sm">
				<Text
					fz={10}
					fw={700}
					tt="uppercase"
					c="dimmed"
					style={{ letterSpacing: "1px" }}
				>
					This Week
				</Text>
				<Text
					fz="xs"
					fw={600}
					c={GOLD}
					ff="var(--mantine-font-family-monospace)"
				>
					{total} events
				</Text>
			</Group>
			<Group gap={6} align="flex-end" h={48}>
				{WEEK_ACTIVITY.map((day) => (
					<Stack key={day.day} gap={4} align="center" style={{ flex: 1 }}>
						<Box
							w="100%"
							style={{
								height: Math.max(4, (day.count / max) * 40),
								borderRadius: 2,
								backgroundColor:
									day.count > 0 ? "#6F8B75" : "var(--mantine-color-dark-5)",
								transition: "height 300ms",
							}}
						/>
						<Text fz={9} c="dimmed" ta="center">
							{day.day}
						</Text>
					</Stack>
				))}
			</Group>
		</Paper>
	);
}

function LibraryCompact() {
	const types = Object.entries(LIBRARY_STATS.entityTypeCounts) as [
		SchemaSlug,
		number,
	][];
	const barTotal = types.reduce((s, [, c]) => s + c, 0);

	return (
		<Paper
			p="md"
			radius="sm"
			style={{ border: "1px solid var(--mantine-color-dark-4)" }}
		>
			<Group justify="space-between" mb="sm">
				<Text
					fz={10}
					fw={700}
					tt="uppercase"
					c="dimmed"
					style={{ letterSpacing: "1px" }}
				>
					Library
				</Text>
				<Text fz="xs" c="dimmed">
					{LIBRARY_STATS.total} total
				</Text>
			</Group>
			{/* Stats row */}
			<Group gap="lg" mb="md">
				{[
					{ label: "Done", value: LIBRARY_STATS.completed, color: "#5B8A5F" },
					{
						label: "Active",
						value: LIBRARY_STATS.inProgress,
						color: "#5B7FFF",
					},
					{
						label: "Backlog",
						value: LIBRARY_STATS.inBacklog,
						color: "#E09840",
					},
					{
						label: "Avg",
						value: LIBRARY_STATS.avgRating.toFixed(1),
						color: GOLD,
					},
				].map((stat) => (
					<Box key={stat.label} ta="center">
						<Text
							fz={18}
							fw={700}
							ff="var(--mantine-font-family-monospace)"
							c={stat.color}
						>
							{stat.value}
						</Text>
						<Text fz={9} c="dimmed" tt="uppercase">
							{stat.label}
						</Text>
					</Box>
				))}
			</Group>
			{/* Type distribution bar */}
			<Box
				h={6}
				style={{
					display: "flex",
					overflow: "hidden",
					borderRadius: 3,
				}}
			>
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
			{/* Legend */}
			<Group gap="xs" mt="xs" wrap="wrap">
				{types.map(([slug, count]) => (
					<Group key={slug} gap={4}>
						<Box
							w={6}
							h={6}
							style={{
								borderRadius: 2,
								backgroundColor: SCHEMAS[slug]?.accent ?? STONE,
							}}
						/>
						<Text fz={9} c="dimmed">
							{SCHEMAS[slug]?.name} ({count})
						</Text>
					</Group>
				))}
			</Group>
		</Paper>
	);
}

// --- Main layout ---

function JournalOverview() {
	return (
		<Container size="lg" px="md" pb={48} pt={40}>
			<Stack gap="xl">
				{/* Page header — minimal, editorial */}
				<Box>
					<Text
						fz={34}
						fw={700}
						lh={1}
						c="var(--mantine-color-text)"
						ff="var(--mantine-headings-font-family)"
					>
						Media
					</Text>
					<Group gap="xs" mt={8}>
						<Badge size="sm" variant="light" color="yellow">
							{CONTINUE_ITEMS.length} in progress
						</Badge>
						<Badge size="sm" variant="light" color="gray">
							{UP_NEXT_ITEMS.length} queued
						</Badge>
						<Badge size="sm" variant="light" color="orange">
							{RATE_ITEMS.length} unrated
						</Badge>
					</Group>
				</Box>

				{/* Hero spotlight */}
				<HeroSpotlight />

				{/* Two-column body */}
				<SimpleGrid cols={{ base: 1, md: 2 }} spacing="xl">
					{/* Left: actionable queues */}
					<Stack gap="xl">
						<ContinueStrip />
						<QueueList />
						<UnratedList />
					</Stack>

					{/* Right: timeline + stats */}
					<Stack gap="lg">
						<WeekBar />
						<ActivityTimeline />
						<LibraryCompact />
					</Stack>
				</SimpleGrid>

				{/* Track something button */}
				<Group justify="center">
					<UnstyledButton
						onClick={() => console.log("track-something")}
						style={{
							gap: 8,
							fontSize: 13,
							fontWeight: 600,
							display: "flex",
							borderRadius: 8,
							alignItems: "center",
							padding: "10px 24px",
							color: "var(--mantine-color-text)",
							border: "1px solid var(--mantine-color-dark-4)",
						}}
					>
						<TrendingUp size={16} />
						Track Something New
					</UnstyledButton>
				</Group>
			</Stack>
		</Container>
	);
}
