/**
 * Media Overview — V2 "Dashboard"
 *
 * Design thesis: dense, information-rich, scannable.
 * - Top stats ribbon shows key numbers at a glance with accent-colored counters.
 * - Two-column layout: left is primary content (continue cards with progress rings,
 *   up-next queue), right is a narrow sidebar with activity feed + ratings prompt.
 * - Progress shown as circular rings rather than bars — more compact.
 * - Everything is denser: smaller gaps, smaller text, more items visible without scrolling.
 * - Aims for the "power user who wants everything on one screen" experience.
 *
 * Divergences from real API contract:
 * - All data is hardcoded. Fields match the shapes from /media/overview/* endpoints.
 * - Interactive elements log to console instead of calling APIs.
 */
import {
	Badge,
	Box,
	Container,
	Divider,
	Group,
	Paper,
	RingProgress,
	SimpleGrid,
	Stack,
	Text,
	UnstyledButton,
} from "@mantine/core";
import { createFileRoute } from "@tanstack/react-router";
import {
	ArrowRight,
	BookOpen,
	ChevronRight,
	Film,
	Gamepad2,
	ListChecks,
	MonitorPlay,
	Play,
	Star,
	Tv,
} from "lucide-react";

export const Route = createFileRoute("/_protected/labs/media-overview/v2")({
	component: DashboardOverview,
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

function schemaIcon(slug: SchemaSlug, size: number) {
	const props = { size, strokeWidth: 1.5 };
	switch (slug) {
		case "movie":
			return <Film {...props} />;
		case "show":
			return <MonitorPlay {...props} />;
		case "book":
			return <BookOpen {...props} />;
		case "anime":
			return <Tv {...props} />;
		case "manga":
			return <BookOpen {...props} />;
		case "video-game":
			return <Gamepad2 {...props} />;
		default:
			return <ListChecks {...props} />;
	}
}

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
	{
		id: "u5",
		name: "Dune",
		entitySchemaSlug: "book" as SchemaSlug,
		image: { url: "https://picsum.photos/seed/dune/400/600" },
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
	{
		id: "r3",
		name: "Death Note",
		entitySchemaSlug: "anime" as SchemaSlug,
		image: { url: "https://picsum.photos/seed/dn/400/600" },
		completedAt: "2026-04-12T18:00:00Z",
	},
];

const ACTIVITY_EVENTS = [
	{
		id: "a1",
		entityName: "Breaking Bad",
		entitySchemaSlug: "show" as SchemaSlug,
		action: "Watched S3 E8",
		time: "2h ago",
	},
	{
		id: "a2",
		entityName: "Lord Edgware Dies",
		entitySchemaSlug: "book" as SchemaSlug,
		action: "Completed",
		time: "Yesterday",
	},
	{
		id: "a3",
		entityName: "Naruto: Shippuuden",
		entitySchemaSlug: "anime" as SchemaSlug,
		action: "Watched Ep 394",
		time: "Yesterday",
	},
	{
		id: "a4",
		entityName: "Star Wars",
		entitySchemaSlug: "movie" as SchemaSlug,
		action: "Added to queue",
		time: "2d ago",
	},
	{
		id: "a5",
		entityName: "SAO: Progressive",
		entitySchemaSlug: "movie" as SchemaSlug,
		action: "Rated 4/5",
		time: "3d ago",
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

// --- Components ---

function StatRibbon() {
	const stats = [
		{ label: "Library", value: LIBRARY_STATS.total, color: STONE },
		{ label: "Active", value: LIBRARY_STATS.inProgress, color: "#5B7FFF" },
		{ label: "Completed", value: LIBRARY_STATS.completed, color: "#5B8A5F" },
		{ label: "Backlog", value: LIBRARY_STATS.inBacklog, color: "#E09840" },
		{ label: "This Week", value: LIBRARY_STATS.thisWeek, color: "#6F8B75" },
		{
			label: "Avg Rating",
			value: LIBRARY_STATS.avgRating.toFixed(1),
			color: GOLD,
		},
	];

	return (
		<Paper
			p="sm"
			radius="sm"
			style={{
				border: "1px solid var(--mantine-color-dark-4)",
				background:
					"linear-gradient(90deg, color-mix(in srgb, #C9943A 6%, transparent) 0%, transparent 100%)",
			}}
		>
			<Group justify="space-between" gap="xs">
				{stats.map((s) => (
					<Box key={s.label} ta="center" style={{ flex: 1 }}>
						<Text
							fz={20}
							fw={700}
							ff="var(--mantine-font-family-monospace)"
							c={s.color}
							lh={1.1}
						>
							{s.value}
						</Text>
						<Text
							fz={9}
							fw={600}
							tt="uppercase"
							c="dimmed"
							mt={2}
							style={{ letterSpacing: "0.5px" }}
						>
							{s.label}
						</Text>
					</Box>
				))}
			</Group>
		</Paper>
	);
}

function ContinueRingCard(props: { item: (typeof CONTINUE_ITEMS)[number] }) {
	const schema = SCHEMAS[props.item.entitySchemaSlug];
	const pct = props.item.progress.progressPercent ?? 0;

	return (
		<UnstyledButton
			w="100%"
			onClick={() => console.log("continue", props.item.id)}
			style={{
				display: "flex",
				gap: 12,
				padding: 10,
				borderRadius: 8,
				alignItems: "center",
				border: "1px solid var(--mantine-color-dark-4)",
				transition: "border-color 150ms",
			}}
		>
			{/* Progress ring with cover inside */}
			<Box pos="relative" style={{ flexShrink: 0 }}>
				<RingProgress
					size={56}
					thickness={3}
					roundCaps
					sections={[{ value: pct, color: schema.accent }]}
					rootColor="var(--mantine-color-dark-5)"
				/>
				<Box
					pos="absolute"
					top={6}
					left={6}
					w={44}
					h={44}
					component="img"
					src={props.item.image.url}
					alt={props.item.name}
					style={{ borderRadius: "50%", objectFit: "cover" }}
				/>
			</Box>
			<Box style={{ flex: 1, minWidth: 0 }}>
				<Text fz="sm" fw={600} truncate lh={1.2}>
					{props.item.name}
				</Text>
				<Group gap={6} mt={3}>
					<Box style={{ color: schema.accent, display: "flex" }}>
						{schemaIcon(props.item.entitySchemaSlug, 12)}
					</Box>
					<Text fz={10} c="dimmed">
						{props.item.progress.current}
					</Text>
				</Group>
			</Box>
			<Stack gap={0} align="flex-end">
				<Text
					fz={14}
					fw={700}
					ff="var(--mantine-font-family-monospace)"
					c={schema.accent}
					lh={1}
				>
					{pct}%
				</Text>
				<Play
					size={10}
					color="var(--mantine-color-dimmed)"
					style={{ marginTop: 4 }}
				/>
			</Stack>
		</UnstyledButton>
	);
}

function QueueCompact() {
	return (
		<Box>
			<Group justify="space-between" mb={6}>
				<Text
					fz={10}
					fw={700}
					tt="uppercase"
					c="dimmed"
					style={{ letterSpacing: "1px" }}
				>
					Queue
				</Text>
				<Badge size="xs" variant="light" color="gray">
					{UP_NEXT_ITEMS.length}
				</Badge>
			</Group>
			{UP_NEXT_ITEMS.map((item, i) => {
				const schema = SCHEMAS[item.entitySchemaSlug];
				return (
					<UnstyledButton
						key={item.id}
						w="100%"
						py={6}
						px={4}
						onClick={() => console.log("start", item.id)}
						style={{
							display: "flex",
							gap: 8,
							alignItems: "center",
							borderBottom:
								i < UP_NEXT_ITEMS.length - 1
									? "1px solid var(--mantine-color-dark-6)"
									: undefined,
						}}
					>
						<Text
							fz={10}
							fw={700}
							w={16}
							ta="center"
							c="dimmed"
							ff="var(--mantine-font-family-monospace)"
						>
							{i + 1}
						</Text>
						<Box style={{ color: schema.accent, display: "flex" }}>
							{schemaIcon(item.entitySchemaSlug, 13)}
						</Box>
						<Text fz="xs" fw={500} truncate style={{ flex: 1 }}>
							{item.name}
						</Text>
						<ArrowRight size={12} color="var(--mantine-color-dimmed)" />
					</UnstyledButton>
				);
			})}
		</Box>
	);
}

function ActivitySidebar() {
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
				Activity
			</Text>
			<Stack gap={0}>
				{ACTIVITY_EVENTS.map((event, i) => {
					const schema = SCHEMAS[event.entitySchemaSlug];
					return (
						<Box
							key={event.id}
							py={8}
							style={{
								borderBottom:
									i < ACTIVITY_EVENTS.length - 1
										? "1px solid var(--mantine-color-dark-6)"
										: undefined,
							}}
						>
							<Group justify="space-between" gap="xs">
								<Text fz="xs" fw={600} truncate style={{ flex: 1 }}>
									{event.entityName}
								</Text>
								<Text fz={10} c="dimmed" style={{ flexShrink: 0 }}>
									{event.time}
								</Text>
							</Group>
							<Text fz={10} c={schema.accent} mt={1}>
								{event.action}
							</Text>
						</Box>
					);
				})}
			</Stack>
		</Box>
	);
}

function RatingSidebar() {
	return (
		<Box>
			<Group justify="space-between" mb="xs">
				<Text
					fz={10}
					fw={700}
					tt="uppercase"
					c="dimmed"
					style={{ letterSpacing: "1px" }}
				>
					Rate These
				</Text>
				<Badge size="xs" variant="light" color="orange">
					{RATE_ITEMS.length}
				</Badge>
			</Group>
			<Stack gap={6}>
				{RATE_ITEMS.map((item) => {
					const schema = SCHEMAS[item.entitySchemaSlug];
					return (
						<UnstyledButton
							key={item.id}
							w="100%"
							onClick={() => console.log("rate", item.id)}
							style={{
								gap: 8,
								padding: 8,
								display: "flex",
								borderRadius: 6,
								alignItems: "center",
								border: "1px solid var(--mantine-color-dark-5)",
							}}
						>
							<Box
								w={28}
								h={40}
								component="img"
								src={item.image.url}
								alt={item.name}
								style={{ borderRadius: 3, objectFit: "cover", flexShrink: 0 }}
							/>
							<Box style={{ flex: 1, minWidth: 0 }}>
								<Text fz={11} fw={600} truncate>
									{item.name}
								</Text>
								<Text fz={9} c={schema.accent}>
									{schema.name}
								</Text>
							</Box>
							<Group gap={1}>
								{[1, 2, 3, 4, 5].map((s) => (
									<Star
										key={s}
										size={10}
										color="var(--mantine-color-dark-4)"
										onClick={(e) => {
											e.stopPropagation();
											console.log("rate", item.id, s);
										}}
									/>
								))}
							</Group>
						</UnstyledButton>
					);
				})}
			</Stack>
		</Box>
	);
}

function TypeBreakdown() {
	const types = Object.entries(LIBRARY_STATS.entityTypeCounts) as [
		SchemaSlug,
		number,
	][];
	const sorted = [...types].sort((a, b) => b[1] - a[1]);

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
				Collection
			</Text>
			<Stack gap={4}>
				{sorted.map(([slug, count]) => {
					const schema = SCHEMAS[slug];
					if (!schema) {
						return null;
					}
					const pct = Math.round((count / LIBRARY_STATS.total) * 100);
					return (
						<Group key={slug} gap="xs" wrap="nowrap">
							<Box style={{ color: schema.accent, display: "flex" }}>
								{schemaIcon(slug, 12)}
							</Box>
							<Text fz={10} w={70} truncate>
								{schema.name}
							</Text>
							<Box style={{ flex: 1 }}>
								<Box
									h={4}
									style={{
										borderRadius: 2,
										backgroundColor: "var(--mantine-color-dark-5)",
									}}
								>
									<Box
										h={4}
										style={{
											borderRadius: 2,
											width: `${pct}%`,
											backgroundColor: schema.accent,
										}}
									/>
								</Box>
							</Box>
							<Text
								fz={10}
								fw={600}
								w={24}
								ta="right"
								ff="var(--mantine-font-family-monospace)"
								c="dimmed"
							>
								{count}
							</Text>
						</Group>
					);
				})}
			</Stack>
		</Box>
	);
}

// --- Main layout ---

function DashboardOverview() {
	return (
		<Container size="lg" px="md" pb={48} pt={40}>
			<Stack gap="lg">
				{/* Header */}
				<Group justify="space-between" align="flex-end">
					<Text
						fz={28}
						fw={700}
						lh={1}
						c="var(--mantine-color-text)"
						ff="var(--mantine-headings-font-family)"
					>
						Media
					</Text>
					<UnstyledButton
						onClick={() => console.log("track-something")}
						style={{
							gap: 6,
							fontSize: 12,
							fontWeight: 600,
							display: "flex",
							borderRadius: 6,
							alignItems: "center",
							padding: "6px 14px",
							color: "var(--mantine-color-text)",
							border: "1px solid var(--mantine-color-dark-4)",
						}}
					>
						<ChevronRight size={14} />
						Track
					</UnstyledButton>
				</Group>

				{/* Stats ribbon */}
				<StatRibbon />

				{/* Two-column body: 60/40 split */}
				<Box
					style={{
						gap: 20,
						display: "grid",
						gridTemplateColumns: "1fr",
						["@media (min-width: 768px)" as string]: {
							gridTemplateColumns: "3fr 2fr",
						},
					}}
				>
					{/* Using SimpleGrid for responsive two-column */}
					<SimpleGrid
						cols={{ base: 1, md: 2 }}
						spacing="lg"
						style={{ gridColumn: "1 / -1" }}
					>
						{/* Left column: Continue + Queue */}
						<Stack gap="lg">
							<Box>
								<Text
									fz={10}
									fw={700}
									tt="uppercase"
									c="dimmed"
									mb="xs"
									style={{ letterSpacing: "1px" }}
								>
									Continue
								</Text>
								<Stack gap={8}>
									{CONTINUE_ITEMS.map((item) => (
										<ContinueRingCard key={item.id} item={item} />
									))}
								</Stack>
							</Box>

							<Divider color="var(--mantine-color-dark-5)" />

							<QueueCompact />
						</Stack>

						{/* Right column: Activity + Ratings + Collection */}
						<Stack gap="lg">
							<ActivitySidebar />
							<Divider color="var(--mantine-color-dark-5)" />
							<RatingSidebar />
							<Divider color="var(--mantine-color-dark-5)" />
							<TypeBreakdown />
						</Stack>
					</SimpleGrid>
				</Box>
			</Stack>
		</Container>
	);
}
