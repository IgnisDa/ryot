/**
 * Media Overview — V4 "Hybrid"
 *
 * Design thesis: warm editorial density.
 * Combines the strongest elements from V1–V3 into a cohesive layout:
 *
 * - **Stats ribbon** (from V2): warm gold-tinted gradient, key library numbers
 *   at a glance. Positioned at top so the user never scrolls past it.
 * - **Two-column body** (from V1): left column holds all actionable items
 *   (continue + queue), right column holds passive/reflective content
 *   (activity feed, ratings prompt, library breakdown). Keeps actions
 *   grouped so the user can scan top-to-bottom on the left.
 * - **Promoted "now" card** (inspired by V1 hero, scaled down): the most
 *   recent in-progress item gets a taller card with artwork + progress bar
 *   + resume CTA, but without the full-width blurred backdrop (avoids
 *   novelty motion effects).
 * - **Continue rows** with rectangular artwork + horizontal progress bars
 *   (not rings — rings crop portrait posters badly).
 * - **Art-forward queue** (from V3): horizontal poster strip with subtle
 *   accent borders per type, rather than a plain numbered list.
 * - **Activity feed** with colored left borders per schema type, grouped
 *   by relative date ("Today", "Yesterday", "Apr 18").
 * - **Rate These** section with artwork + inline star rating.
 * - **Library breakdown** (from V2): horizontal bars per media type,
 *   sorted descending — clearest visualization of collection composition.
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
	ScrollArea,
	SimpleGrid,
	Stack,
	Text,
	Tooltip,
	UnstyledButton,
} from "@mantine/core";
import { createFileRoute } from "@tanstack/react-router";
import { Bookmark, ChevronRight, Play, Star } from "lucide-react";

export const Route = createFileRoute("/_protected/labs/media-overview/v4")({
	component: HybridOverview,
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

// --- Mock data matching backend shapes ---

const CONTINUE_ITEMS = [
	{
		id: "c1",
		name: "Breaking Bad",
		entitySchemaSlug: "show" as SchemaSlug,
		image: { url: "https://picsum.photos/seed/bb/400/600" },
		progress: { progressPercent: 62, current: "S3 E8" },
		lastActivityAt: "2026-04-21T14:30:00Z",
	},
	{
		id: "c2",
		name: "The Hobbit",
		entitySchemaSlug: "book" as SchemaSlug,
		image: { url: "https://picsum.photos/seed/hobbit/400/600" },
		progress: { progressPercent: 34, current: "Page 112" },
		lastActivityAt: "2026-04-20T14:00:00Z",
	},
	{
		id: "c3",
		name: "Naruto: Shippuuden",
		entitySchemaSlug: "anime" as SchemaSlug,
		image: { url: "https://picsum.photos/seed/naruto/400/600" },
		progress: { progressPercent: 78, current: "Ep 394" },
		lastActivityAt: "2026-04-19T20:15:00Z",
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
		action: "Watched",
		detail: "S3 E8",
		time: "2h ago",
		date: "Today",
		rating: null as number | null,
	},
	{
		id: "a2",
		entityName: "Lord Edgware Dies",
		entitySchemaSlug: "book" as SchemaSlug,
		action: "Completed",
		detail: null as string | null,
		time: "Yesterday",
		date: "Yesterday",
		rating: null as number | null,
	},
	{
		id: "a3",
		entityName: "Naruto: Shippuuden",
		entitySchemaSlug: "anime" as SchemaSlug,
		action: "Watched",
		detail: "Ep 394",
		time: "Yesterday",
		date: "Yesterday",
		rating: null as number | null,
	},
	{
		id: "a4",
		entityName: "Star Wars",
		entitySchemaSlug: "movie" as SchemaSlug,
		action: "Queued",
		detail: null as string | null,
		time: "2d ago",
		date: "Apr 19",
		rating: null as number | null,
	},
	{
		id: "a5",
		entityName: "SAO: Progressive",
		entitySchemaSlug: "movie" as SchemaSlug,
		action: "Rated",
		detail: null as string | null,
		time: "3d ago",
		date: "Apr 18",
		rating: 4,
	},
];

const LIBRARY_STATS = {
	total: 247,
	inProgress: 4,
	completed: 189,
	inBacklog: 54,
	avgRating: 3.8,
	entityTypeCounts: {
		movie: 82,
		book: 48,
		show: 41,
		anime: 38,
		manga: 22,
		"video-game": 12,
		podcast: 4,
	} as Record<string, number>,
};

// --- Helpers ---

function colorMix(color: string, alpha: number) {
	return `color-mix(in srgb, ${color} ${alpha * 100}%, transparent)`;
}

// Group activity events by date
function groupByDate(
	events: typeof ACTIVITY_EVENTS,
): Record<string, typeof ACTIVITY_EVENTS> {
	const groups: Record<string, typeof ACTIVITY_EVENTS> = {};
	for (const event of events) {
		if (!groups[event.date]) {
			groups[event.date] = [];
		}
		groups[event.date]?.push(event);
	}
	return groups;
}

// --- Stats Ribbon ---

function StatsRibbon() {
	const stats = [
		{ label: "Library", value: LIBRARY_STATS.total, color: STONE },
		{ label: "Active", value: LIBRARY_STATS.inProgress, color: "#5B7FFF" },
		{ label: "Done", value: LIBRARY_STATS.completed, color: "#5B8A5F" },
		{ label: "Backlog", value: LIBRARY_STATS.inBacklog, color: "#E09840" },
		{
			label: "Avg Rating",
			value: LIBRARY_STATS.avgRating.toFixed(1),
			color: GOLD,
		},
	];

	return (
		<Paper
			px="md"
			py="sm"
			radius="sm"
			style={{
				border: `1px solid ${colorMix(GOLD, 0.15)}`,
				background: `linear-gradient(135deg, ${colorMix(GOLD, 0.06)} 0%, transparent 60%)`,
			}}
		>
			<Group justify="space-between" gap="xs">
				{stats.map((s) => (
					<Box key={s.label} ta="center" style={{ flex: 1 }}>
						<Text
							lh={1}
							fz={20}
							fw={700}
							c={s.color}
							ff="var(--mantine-font-family-monospace)"
						>
							{s.value}
						</Text>
						<Text
							mt={4}
							fz={9}
							fw={600}
							c="dimmed"
							tt="uppercase"
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

// --- Hero Continue Card (promoted first item) ---

function HeroCard() {
	const item = CONTINUE_ITEMS[0];
	if (!item) {
		return null;
	}
	const schema = SCHEMAS[item.entitySchemaSlug];
	const pct = item.progress.progressPercent ?? 0;

	return (
		<Paper
			p="sm"
			radius="sm"
			style={{
				overflow: "hidden",
				border: `1px solid ${colorMix(schema.accent, 0.2)}`,
				background: `linear-gradient(135deg, ${colorMix(schema.accent, 0.08)} 0%, var(--mantine-color-dark-7) 50%)`,
			}}
		>
			<Group gap="md" align="stretch" wrap="nowrap">
				<Box
					w={100}
					h={140}
					component="img"
					src={item.image.url}
					alt={item.name}
					style={{
						flexShrink: 0,
						borderRadius: 6,
						objectFit: "cover",
						boxShadow: `0 4px 16px ${colorMix(schema.accent, 0.15)}`,
					}}
				/>
				<Stack gap={6} style={{ flex: 1, minWidth: 0 }} justify="center">
					<Box>
						<Text
							fz={9}
							fw={700}
							tt="uppercase"
							c={schema.accent}
							style={{ letterSpacing: "1.5px" }}
						>
							Continue {schema.name}
						</Text>
						<Text
							fz={20}
							fw={700}
							mt={2}
							lh={1.1}
							truncate
							c="var(--mantine-color-text)"
							ff="var(--mantine-headings-font-family)"
						>
							{item.name}
						</Text>
						{item.progress.current && (
							<Text fz="xs" c="dimmed" mt={2}>
								{item.progress.current}
							</Text>
						)}
					</Box>

					{/* Progress */}
					<Box maw={220}>
						<Group justify="space-between" mb={3}>
							<Text fz={10} c="dimmed">
								Progress
							</Text>
							<Text
								fz={10}
								fw={600}
								c={schema.accent}
								ff="var(--mantine-font-family-monospace)"
							>
								{pct}%
							</Text>
						</Group>
						<Progress
							h={4}
							value={pct}
							radius="xl"
							color={schema.accent}
							bg="var(--mantine-color-dark-5)"
						/>
					</Box>

					<UnstyledButton
						onClick={() => console.log("continue", item.id)}
						style={{
							gap: 5,
							color: "#111",
							fontSize: 12,
							fontWeight: 700,
							display: "inline-flex",
							padding: "5px 12px",
							borderRadius: 5,
							alignItems: "center",
							alignSelf: "flex-start",
							backgroundColor: schema.accent,
						}}
					>
						<Play size={11} fill="currentColor" />
						Resume
					</UnstyledButton>
				</Stack>
			</Group>
		</Paper>
	);
}

// --- Continue rows (remaining items) ---

function ContinueRow(props: { item: (typeof CONTINUE_ITEMS)[number] }) {
	const schema = SCHEMAS[props.item.entitySchemaSlug];
	const pct = props.item.progress.progressPercent ?? 0;

	return (
		<UnstyledButton
			w="100%"
			onClick={() => console.log("continue", props.item.id)}
			style={{
				gap: 10,
				display: "flex",
				padding: "8px 10px",
				borderRadius: 6,
				alignItems: "center",
				border: "1px solid var(--mantine-color-dark-4)",
				transition: "border-color 150ms",
			}}
		>
			<Box
				w={40}
				h={56}
				component="img"
				src={props.item.image.url}
				alt={props.item.name}
				style={{ borderRadius: 4, objectFit: "cover", flexShrink: 0 }}
			/>
			<Box style={{ flex: 1, minWidth: 0 }}>
				<Text fz="xs" fw={600} truncate lh={1.2}>
					{props.item.name}
				</Text>
				<Group gap={6} mt={2}>
					<Badge
						size="xs"
						variant="light"
						style={{
							color: schema.accent,
							backgroundColor: colorMix(schema.accent, 0.12),
						}}
					>
						{schema.name}
					</Badge>
					{props.item.progress.current && (
						<Text fz={10} c="dimmed">
							{props.item.progress.current}
						</Text>
					)}
				</Group>
				<Progress
					mt={6}
					h={3}
					value={pct}
					radius="xl"
					color={schema.accent}
					bg="var(--mantine-color-dark-5)"
				/>
			</Box>
			<Text
				fz="xs"
				fw={700}
				c={schema.accent}
				ff="var(--mantine-font-family-monospace)"
				style={{ flexShrink: 0 }}
			>
				{pct}%
			</Text>
		</UnstyledButton>
	);
}

// --- Queue poster strip ---

function QueueStrip() {
	return (
		<Box>
			<Group justify="space-between" mb="xs">
				<Group gap={6}>
					<Bookmark size={12} color={STONE} />
					<Text
						fz={10}
						fw={700}
						c="dimmed"
						tt="uppercase"
						style={{ letterSpacing: "1px" }}
					>
						Up Next
					</Text>
				</Group>
				<Text fz={10} c="dimmed">
					{UP_NEXT_ITEMS.length} queued
				</Text>
			</Group>
			<ScrollArea scrollbarSize={4} type="hover">
				<Group gap={10} wrap="nowrap" pb={4}>
					{UP_NEXT_ITEMS.map((item) => {
						const schema = SCHEMAS[item.entitySchemaSlug];
						return (
							<UnstyledButton
								key={item.id}
								style={{ flexShrink: 0 }}
								onClick={() => console.log("start", item.id)}
							>
								<Box pos="relative">
									<Box
										w={80}
										h={112}
										component="img"
										src={item.image.url}
										alt={item.name}
										style={{
											objectFit: "cover",
											borderRadius: 6,
											border: `2px solid ${colorMix(schema.accent, 0.3)}`,
											transition: "border-color 150ms",
										}}
									/>
									{/* Title overlay at bottom */}
									<Box
										pos="absolute"
										left={0}
										right={0}
										bottom={0}
										px={6}
										py={4}
										style={{
											borderRadius: "0 0 4px 4px",
											background:
												"linear-gradient(transparent, rgba(0,0,0,0.85))",
										}}
									>
										<Text fz={8} fw={600} c="white" truncate lh={1.2}>
											{item.name}
										</Text>
									</Box>
								</Box>
								{/* Type badge below poster */}
								<Text fz={9} c={schema.accent} ta="center" mt={4} truncate>
									{schema.name}
								</Text>
							</UnstyledButton>
						);
					})}
				</Group>
			</ScrollArea>
		</Box>
	);
}

// --- Activity feed ---

function ActivityFeed() {
	const dateGroups = groupByDate(ACTIVITY_EVENTS);

	return (
		<Box>
			<Text
				fz={10}
				fw={700}
				c="dimmed"
				mb="sm"
				tt="uppercase"
				style={{ letterSpacing: "1px" }}
			>
				Recent Activity
			</Text>
			<Stack gap="sm">
				{Object.entries(dateGroups).map(([date, events]) => (
					<Box key={date}>
						<Text
							fz={9}
							fw={700}
							c="dimmed"
							mb={4}
							tt="uppercase"
							style={{ letterSpacing: "0.5px" }}
						>
							{date}
						</Text>
						<Stack gap={0}>
							{events.map((event, i) => {
								const schema = SCHEMAS[event.entitySchemaSlug];
								return (
									<Group
										key={event.id}
										py={7}
										gap="xs"
										wrap="nowrap"
										align="flex-start"
										style={{
											paddingLeft: 10,
											borderLeft: `3px solid ${schema.accent}`,
											borderBottom:
												i < events.length - 1
													? "1px solid var(--mantine-color-dark-6)"
													: undefined,
										}}
									>
										<Box style={{ flex: 1, minWidth: 0 }}>
											<Text fz="xs" fw={600} truncate lh={1.2}>
												{event.entityName}
											</Text>
											<Group gap={4} mt={1}>
												<Text fz={10} c={schema.accent}>
													{event.action}
												</Text>
												{event.detail && (
													<Text fz={10} c="dimmed">
														{event.detail}
													</Text>
												)}
												{event.rating !== null && (
													<Group gap={2}>
														<Star size={9} fill={GOLD} color={GOLD} />
														<Text
															fz={10}
															fw={600}
															c={GOLD}
															ff="var(--mantine-font-family-monospace)"
														>
															{event.rating}
														</Text>
													</Group>
												)}
											</Group>
										</Box>
										<Text
											fz={10}
											c="dimmed"
											style={{ flexShrink: 0, whiteSpace: "nowrap" }}
										>
											{event.time}
										</Text>
									</Group>
								);
							})}
						</Stack>
					</Box>
				))}
			</Stack>
		</Box>
	);
}

// --- Rate These ---

function RateTheseSection() {
	if (RATE_ITEMS.length === 0) {
		return null;
	}

	return (
		<Box>
			<Group justify="space-between" mb="xs">
				<Group gap={6}>
					<Star size={12} color="#D38D5A" />
					<Text
						fz={10}
						fw={700}
						c="dimmed"
						tt="uppercase"
						style={{ letterSpacing: "1px" }}
					>
						Rate These
					</Text>
				</Group>
				<Badge size="xs" variant="light" color="orange">
					{RATE_ITEMS.length}
				</Badge>
			</Group>
			<Stack gap={6}>
				{RATE_ITEMS.map((item) => {
					const schema = SCHEMAS[item.entitySchemaSlug];
					return (
						<Paper
							key={item.id}
							p={8}
							radius="sm"
							style={{
								gap: 8,
								display: "flex",
								alignItems: "center",
								border: "1px solid var(--mantine-color-dark-5)",
								background: `linear-gradient(90deg, ${colorMix(GOLD, 0.04)} 0%, transparent 40%)`,
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
								<Text fz={11} fw={600} truncate lh={1.2}>
									{item.name}
								</Text>
								<Text fz={9} c={schema.accent}>
									{schema.name}
								</Text>
							</Box>
							{/* Star rating — each star is tappable */}
							<Group gap={2}>
								{[1, 2, 3, 4, 5].map((s) => (
									<UnstyledButton
										key={s}
										onClick={() => console.log("rate", item.id, s)}
										style={{ display: "flex", padding: 2 }}
									>
										<Star
											size={14}
											color={colorMix(GOLD, 0.4)}
											strokeWidth={1.5}
										/>
									</UnstyledButton>
								))}
							</Group>
						</Paper>
					);
				})}
			</Stack>
		</Box>
	);
}

// --- Library breakdown (horizontal bars) ---

function LibraryBreakdown() {
	const types = Object.entries(LIBRARY_STATS.entityTypeCounts) as [
		SchemaSlug,
		number,
	][];
	const sorted = [...types].sort((a, b) => b[1] - a[1]);
	const maxCount = Math.max(...sorted.map(([, c]) => c), 1);

	return (
		<Paper
			p="sm"
			radius="sm"
			style={{
				border: "1px solid var(--mantine-color-dark-4)",
				background: `linear-gradient(180deg, ${colorMix(STONE, 0.06)} 0%, transparent 100%)`,
			}}
		>
			<Group justify="space-between" mb="sm">
				<Text
					fz={10}
					fw={700}
					c="dimmed"
					tt="uppercase"
					style={{ letterSpacing: "1px" }}
				>
					Collection
				</Text>
				<Text fz={10} c="dimmed">
					{LIBRARY_STATS.total} total
				</Text>
			</Group>
			<Stack gap={6}>
				{sorted.map(([slug, count]) => {
					const schema = SCHEMAS[slug];
					if (!schema) {
						return null;
					}
					const pct = (count / maxCount) * 100;
					return (
						<Group key={slug} gap="xs" wrap="nowrap">
							<Text fz={10} w={70} c="dimmed" truncate>
								{schema.name}
							</Text>
							<Box style={{ flex: 1 }}>
								<Tooltip label={`${schema.name}: ${count}`}>
									<Box
										h={6}
										style={{
											borderRadius: 3,
											backgroundColor: "var(--mantine-color-dark-5)",
										}}
									>
										<Box
											h={6}
											style={{
												borderRadius: 3,
												width: `${pct}%`,
												transition: "width 300ms ease",
												backgroundColor: schema.accent,
											}}
										/>
									</Box>
								</Tooltip>
							</Box>
							<Text
								fz={10}
								fw={600}
								w={24}
								ta="right"
								c="dimmed"
								ff="var(--mantine-font-family-monospace)"
							>
								{count}
							</Text>
						</Group>
					);
				})}
			</Stack>
		</Paper>
	);
}

// --- Main layout ---

function HybridOverview() {
	const continueRest = CONTINUE_ITEMS.slice(1);

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
						<Group gap="xs" mt={6}>
							<Badge
								size="sm"
								variant="light"
								style={{
									color: GOLD,
									backgroundColor: colorMix(GOLD, 0.12),
								}}
							>
								{CONTINUE_ITEMS.length} active
							</Badge>
							<Badge
								size="sm"
								variant="light"
								style={{
									color: STONE,
									backgroundColor: colorMix(STONE, 0.12),
								}}
							>
								{UP_NEXT_ITEMS.length} queued
							</Badge>
							{RATE_ITEMS.length > 0 && (
								<Badge
									size="sm"
									variant="light"
									style={{
										color: "#D38D5A",
										backgroundColor: colorMix("#D38D5A", 0.12),
									}}
								>
									{RATE_ITEMS.length} unrated
								</Badge>
							)}
						</Group>
					</Box>
					<UnstyledButton
						onClick={() => console.log("track-something")}
						style={{
							gap: 6,
							fontSize: 12,
							fontWeight: 600,
							display: "flex",
							borderRadius: 6,
							alignItems: "center",
							padding: "7px 14px",
							color: "var(--mantine-color-text)",
							border: "1px solid var(--mantine-color-dark-4)",
						}}
					>
						<ChevronRight size={14} />
						Track
					</UnstyledButton>
				</Group>

				{/* Stats ribbon */}
				<StatsRibbon />

				{/* Two-column body: 55/45 split on desktop */}
				<SimpleGrid
					cols={{ base: 1, md: 2 }}
					spacing="lg"
					style={{ alignItems: "start" }}
				>
					{/* Left column: actionable items */}
					<Stack gap="lg">
						{/* Hero continue card */}
						<Box>
							<Text
								fz={10}
								fw={700}
								c="dimmed"
								mb="xs"
								tt="uppercase"
								style={{ letterSpacing: "1px" }}
							>
								Continue
							</Text>
							<HeroCard />
						</Box>

						{/* Other in-progress items */}
						{continueRest.length > 0 && (
							<Stack gap={6}>
								{continueRest.map((item) => (
									<ContinueRow key={item.id} item={item} />
								))}
							</Stack>
						)}

						{/* Queue poster strip */}
						{UP_NEXT_ITEMS.length > 0 && <QueueStrip />}
					</Stack>

					{/* Right column: reflective / passive content */}
					<Stack gap="lg">
						<ActivityFeed />
						<RateTheseSection />
						<LibraryBreakdown />
					</Stack>
				</SimpleGrid>
			</Stack>
		</Container>
	);
}
