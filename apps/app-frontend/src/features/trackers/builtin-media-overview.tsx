import { useAutoAnimate } from "@formkit/auto-animate/react";
import {
	ActionIcon,
	Badge,
	Box,
	Button,
	Center,
	Group,
	Loader,
	Paper,
	Progress,
	ScrollArea,
	SimpleGrid,
	Stack,
	Text,
	ThemeIcon,
	Tooltip,
	UnstyledButton,
} from "@mantine/core";
import { useDebouncedCallback } from "@mantine/hooks";
import { modals } from "@mantine/modals";
import { notifications } from "@mantine/notifications";
import { useQueryClient } from "@tanstack/react-query";
import { Bookmark, Clock, Play, Star } from "lucide-react";
import { useCallback, useState } from "react";
import { useResolvedImageUrls } from "#/features/entities/image";
import { toAppEntityImage } from "#/features/entities/model";
import {
	SearchEntityModalContent,
	SearchEntityModalTitle,
} from "#/features/entities/search-modal";
import { createReviewEventPayload } from "#/features/entities/search-modal-media-actions";
import { useEntitySchemasQuery } from "#/features/entity-schemas/hooks";
import type { AppEntitySchema } from "#/features/entity-schemas/model";
import { useEventSchemasQuery } from "#/features/event-schemas/hooks";
import { TrackerIcon } from "#/features/trackers/icons";
import type { AppTracker } from "#/features/trackers/model";
import { getLastActivityLabel } from "#/features/trackers/tracker-overview-data";
import { useApiClient } from "#/hooks/api";
import { useThemeTokens } from "#/hooks/theme";
import type { ApiGetResponseData } from "#/lib/api/types";

const GOLD = "#C9943A";
const STONE = "#8C7560";

const SECTION_ACCENTS = {
	library: STONE,
	continue: GOLD,
	queue: "#8E6A4D",
	review: "#D38D5A",
	activity: "#6F8B75",
};

function colorMix(color: string, alpha: number) {
	return `color-mix(in srgb, ${color} ${alpha * 100}%, transparent)`;
}

function getQueueNote(slug: string, backlogAt: Date, rank: number) {
	if (rank === 0) {
		return "Pick tonight";
	}
	const daysSinceBacklog =
		(Date.now() - backlogAt.getTime()) / (1000 * 60 * 60 * 24);
	if (daysSinceBacklog < 7) {
		return "Freshly queued";
	}
	if (slug === "anime") {
		return "Easy to resume";
	}
	if (slug === "book" || slug === "manga") {
		return "Settle in with this";
	}
	return "Waiting in the wings";
}

function getSectionBackground(props: {
	accent: string;
	isDark: boolean;
	surface: string;
}) {
	if (props.isDark) {
		return `linear-gradient(180deg, ${colorMix(props.accent, 0.18)} 0%, ${props.surface} 22%, ${props.surface} 100%)`;
	}
	return `linear-gradient(180deg, ${colorMix(props.accent, 0.08)} 0%, ${colorMix(props.accent, 0.03)} 18%, ${props.surface} 40%, ${props.surface} 100%)`;
}

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

const TYPE_COLORS: Record<MediaType, string> = {
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

type OverviewUpNextItem =
	ApiGetResponseData<"/media/overview/up-next">["items"][number];
type OverviewContinueItem =
	ApiGetResponseData<"/media/overview/continue">["items"][number];
type OverviewRateTheseItem =
	ApiGetResponseData<"/media/overview/review">["items"][number];
type OverviewActivityItem =
	ApiGetResponseData<"/media/overview/activity">["items"][number];
type OverviewWeekItem =
	ApiGetResponseData<"/media/overview/week">["items"][number];

interface ActivityEventView {
	id: string;
	imageUrl?: string;
	sub?: string;
	date: string;
	time: string;
	title: string;
	action: string;
	rating: number | null;
	entitySchemaSlug: string;
}

interface WeekDayView {
	day: string;
	count: number;
}

const LIBRARY_STATS = {
	total: 29,
	onHold: 5,
	active: 11,
	dropped: 1,
	completed: 15,
	avgRating: 4.6,
	thisWeekHours: 18,
	thisWeekCompleted: 2,
};

const TYPE_COUNTS: { type: MediaType; count: number }[] = [
	{ type: "Book", count: 4 },
	{ type: "Show", count: 3 },
	{ type: "Anime", count: 5 },
	{ type: "Movie", count: 3 },
	{ type: "Music", count: 3 },
	{ type: "Manga", count: 2 },
	{ type: "Podcast", count: 2 },
	{ type: "VideoGame", count: 3 },
	{ type: "AudioBook", count: 2 },
	{ type: "ComicBook", count: 2 },
	{ type: "VisualNovel", count: 2 },
];

function getActivityDateLabel(date: Date) {
	const now = new Date();
	const today = new Date(now);
	today.setHours(0, 0, 0, 0);

	const yesterday = new Date(today);
	yesterday.setDate(today.getDate() - 1);

	const target = new Date(date);
	target.setHours(0, 0, 0, 0);

	if (target.getTime() === today.getTime()) {
		return "Today";
	}
	if (target.getTime() === yesterday.getTime()) {
		return "Yesterday";
	}

	return date.toLocaleDateString(undefined, {
		month: "short",
		day: "numeric",
		year: date.getFullYear() === now.getFullYear() ? undefined : "numeric",
	});
}

function getActivityActionLabel(item: OverviewActivityItem) {
	if (item.eventSchemaSlug === "progress") {
		return item.entity.entitySchemaSlug === "anime"
			? "Watched"
			: "Logged progress";
	}
	if (item.eventSchemaSlug === "backlog") {
		return "Queued";
	}
	if (item.eventSchemaSlug === "review") {
		return "Rated";
	}
	return "Completed";
}

function buildWeekActivity(days: OverviewWeekItem[]): WeekDayView[] {
	return days.map((day) => ({ day: day.dayLabel, count: day.count }));
}

function SectionHeader(props: {
	title: string;
	eyebrow?: string;
	textMuted: string;
	textPrimary: string;
	accentColor: string;
	right?: React.ReactNode;
}) {
	return (
		<Group justify="space-between" align="flex-end" mb="md" gap="sm">
			<Stack gap={4}>
				{props.eyebrow ? (
					<Group gap={8}>
						<Box
							h={2}
							w={18}
							style={{ borderRadius: 999, backgroundColor: props.accentColor }}
						/>
						<Text
							fz={10}
							fw={700}
							tt="uppercase"
							c={props.accentColor}
							style={{ letterSpacing: "1px" }}
							ff="var(--mantine-headings-font-family)"
						>
							{props.eyebrow}
						</Text>
					</Group>
				) : null}
				<Text
					fz="xl"
					fw={700}
					lh={1.1}
					c={props.textPrimary}
					ff="var(--mantine-headings-font-family)"
				>
					{props.title}
				</Text>
			</Stack>
			{props.right ? <Box>{props.right}</Box> : null}
		</Group>
	);
}

function SectionFrame(props: {
	border: string;
	isDark: boolean;
	surface: string;
	accentColor: string;
	children: React.ReactNode;
}) {
	return (
		<Paper
			p="md"
			radius="sm"
			style={{
				overflow: "hidden",
				position: "relative",
				border: `1px solid ${props.border}`,
				boxShadow: props.isDark
					? `0 12px 32px ${colorMix("#000000", 0.22)}`
					: `0 10px 30px ${colorMix(props.accentColor, 0.08)}`,
				background: getSectionBackground({
					isDark: props.isDark,
					surface: props.surface,
					accent: props.accentColor,
				}),
			}}
		>
			<Box
				style={{
					top: 0,
					left: 0,
					height: 3,
					width: "100%",
					position: "absolute",
					background: `linear-gradient(90deg, ${props.accentColor} 0%, ${colorMix(props.accentColor, 0)} 100%)`,
				}}
			/>
			{props.children}
		</Paper>
	);
}

function Artwork(props: {
	url?: string;
	icon: string;
	note?: string;
	color: string;
	title: string;
	width?: number;
	height?: number;
	radius?: number;
}) {
	const [hasError, setHasError] = useState(!props.url);

	return (
		<Box
			w={props.width}
			h={props.height}
			style={{
				overflow: "hidden",
				position: "relative",
				borderRadius: props.radius ?? 8,
				background: `linear-gradient(160deg, ${colorMix(props.color, 0.2)} 0%, ${colorMix(STONE, 0.08)} 100%)`,
			}}
		>
			{props.url && !hasError ? (
				<Box
					w="100%"
					h="100%"
					src={props.url}
					component="img"
					alt={props.title}
					style={{ objectFit: "cover" }}
					onError={() => setHasError(true)}
				/>
			) : (
				<Stack
					p="sm"
					gap={8}
					h="100%"
					align="center"
					justify="center"
					style={{
						background: `linear-gradient(180deg, ${colorMix(props.color, 0.28)} 0%, ${colorMix(STONE, 0.08)} 100%)`,
					}}
				>
					<ThemeIcon
						size={32}
						radius="xl"
						variant="light"
						style={{
							color: props.color,
							backgroundColor: colorMix(props.color, 0.16),
						}}
					>
						<TrackerIcon icon={props.icon} size={16} color={props.color} />
					</ThemeIcon>
					<Text
						fz={10}
						fw={600}
						ta="center"
						lineClamp={3}
						ff="var(--mantine-headings-font-family)"
						c={colorMix("#2D241D", 0.84)}
					>
						{props.title}
					</Text>
				</Stack>
			)}

			<Box
				style={{
					inset: 0,
					position: "absolute",
					background:
						"linear-gradient(180deg, rgba(0, 0, 0, 0) 45%, rgba(0, 0, 0, 0.6) 100%)",
				}}
			/>
			{props.note ? (
				<Badge
					size="xs"
					variant="filled"
					style={{
						left: 8,
						bottom: 8,
						color: "white",
						position: "absolute",
						backgroundColor: colorMix("#201812", 0.72),
					}}
				>
					{props.note}
				</Badge>
			) : null}
		</Box>
	);
}

function ContinueCard(props: {
	border: string;
	surface: string;
	textMuted: string;
	textPrimary: string;
	surfaceHover: string;
	item: OverviewContinueItem;
	imageUrl: string | undefined;
	schemaBySlug: Map<string, AppEntitySchema>;
}) {
	const schema = props.schemaBySlug.get(props.item.entitySchemaSlug);
	const icon = schema?.icon ?? "circle";
	const color = schema?.accentColor ?? STONE;
	const progressLabel = props.item.labels.progress;
	const pct = props.item.progress.progressPercent ?? null;
	const lastActivity = getLastActivityLabel(new Date(props.item.progressAt));

	return (
		<Paper
			radius="sm"
			style={{
				overflow: "hidden",
				border: `1px solid ${props.border}`,
				boxShadow: `0 10px 24px ${colorMix(color, 0.08)}`,
				background: `linear-gradient(180deg, ${colorMix(color, 0.08)} 0%, ${props.surface} 34%, ${props.surface} 100%)`,
			}}
			styles={{
				root: {
					transition: "all 0.18s ease",
					"&:hover": {
						transform: "translateY(-2px)",
						background: `linear-gradient(180deg, ${colorMix(color, 0.1)} 0%, ${props.surfaceHover} 30%, ${props.surfaceHover} 100%)`,
					},
				},
			}}
		>
			<Group gap={0} align="stretch" wrap="nowrap">
				<Artwork
					width={84}
					radius={0}
					icon={icon}
					color={color}
					url={props.imageUrl}
					title={props.item.title}
					note={pct !== null ? `${pct}% done` : undefined}
				/>
				<Stack gap={8} p="sm" style={{ flex: 1, minWidth: 0 }}>
					<Group gap={6} wrap="nowrap">
						<Badge
							size="xs"
							variant="light"
							style={{ color, backgroundColor: colorMix(color, 0.12) }}
						>
							{schema?.name ?? "Item"}
						</Badge>
						<Text
							fz={10}
							tt="uppercase"
							c={props.textMuted}
							style={{ letterSpacing: "0.8px" }}
							ff="var(--mantine-headings-font-family)"
						>
							Resume
						</Text>
						<Box style={{ flex: 1 }} />
						<Text fz={10} c={props.textMuted}>
							{lastActivity}
						</Text>
					</Group>

					<Text
						fz="sm"
						fw={600}
						lh={1.3}
						lineClamp={1}
						c={props.textPrimary}
						ff="var(--mantine-headings-font-family)"
					>
						{props.item.title}
					</Text>
					<Text fz="xs" c={props.textMuted} lineClamp={1}>
						{props.item.subtitle.label}
					</Text>

					<Box mt={2}>
						<Group gap={6} mb={4}>
							<Text
								fz={10}
								c={props.textMuted}
								ff="var(--mantine-font-family-monospace)"
							>
								{progressLabel}
							</Text>
							{pct !== null ? (
								<Text
									fz={10}
									fw={600}
									c={color}
									ff="var(--mantine-font-family-monospace)"
								>
									{pct}%
								</Text>
							) : null}
						</Group>
						{pct !== null ? (
							<Progress
								size={5}
								value={pct}
								radius="xl"
								color={color}
								bg={props.border}
							/>
						) : null}
					</Box>

					<Button
						mt={4}
						variant="light"
						size="compact-xs"
						leftSection={<Play size={10} />}
						style={{
							color,
							border: "none",
							alignSelf: "flex-start",
							backgroundColor: colorMix(color, 0.12),
						}}
					>
						{props.item.labels.cta}
					</Button>
				</Stack>
			</Group>
		</Paper>
	);
}

function BacklogCard(props: {
	rank: number;
	border: string;
	surface: string;
	textMuted: string;
	textPrimary: string;
	surfaceHover: string;
	item: OverviewUpNextItem;
	imageUrl: string | undefined;
	schemaBySlug: Map<string, AppEntitySchema>;
}) {
	const schema = props.schemaBySlug.get(props.item.entitySchemaSlug);
	const color = schema?.accentColor ?? STONE;
	const icon = schema?.icon ?? "circle";
	const backlogAt = new Date(props.item.backlogAt);
	const note = getQueueNote(props.item.entitySchemaSlug, backlogAt, props.rank);

	return (
		<UnstyledButton
			style={{ flexShrink: 0 }}
			onClick={() => console.log("[builtin-tracker] Start:", props.item.title)}
		>
			<Paper
				w={164}
				radius="sm"
				style={{
					overflow: "hidden",
					border: `1px solid ${props.border}`,
					boxShadow: `0 10px 26px ${colorMix(color, 0.08)}`,
					background: `linear-gradient(180deg, ${colorMix(color, 0.08)} 0%, ${props.surface} 26%, ${props.surface} 100%)`,
				}}
				styles={{
					root: {
						transition: "all 0.18s ease",
						"&:hover": {
							transform: "translateY(-2px)",
							background: `linear-gradient(180deg, ${colorMix(color, 0.1)} 0%, ${props.surfaceHover} 24%, ${props.surfaceHover} 100%)`,
						},
					},
				}}
			>
				<Box p={8} pb={0} style={{ position: "relative" }}>
					<Artwork
						icon={icon}
						height={220}
						color={color}
						note={schema?.name}
						url={props.imageUrl}
						title={props.item.title}
					/>
					<Badge
						size="xs"
						variant="light"
						style={{
							color,
							top: 14,
							left: 14,
							position: "absolute",
							backgroundColor: colorMix(color, 0.12),
						}}
					>
						{schema?.name ?? "Item"}
					</Badge>
				</Box>
				<Stack gap={4} p="sm" pt="xs">
					<Text
						fz={10}
						fw={700}
						c={color}
						tt="uppercase"
						style={{ letterSpacing: "0.9px" }}
						ff="var(--mantine-headings-font-family)"
					>
						{note}
					</Text>
					<Text
						fz="sm"
						fw={600}
						lh={1.3}
						lineClamp={2}
						c={props.textPrimary}
						ff="var(--mantine-headings-font-family)"
					>
						{props.item.title}
					</Text>
					<Text fz={10} c={props.textMuted} lineClamp={1}>
						{props.item.subtitle.label}
					</Text>
					<Text fz={10} c={props.textMuted}>
						Added {getLastActivityLabel(backlogAt)}
					</Text>
				</Stack>
			</Paper>
		</UnstyledButton>
	);
}

function RateCard(props: {
	border: string;
	surface: string;
	textMuted: string;
	textPrimary: string;
	onRated: () => void;
	surfaceHover: string;
	item: OverviewRateTheseItem;
	imageUrl: string | undefined;
	schemaBySlug: Map<string, AppEntitySchema>;
}) {
	const [hovered, setHovered] = useState(0);
	const [selected, setSelected] = useState(0);
	const apiClient = useApiClient();
	const createEvents = apiClient.useMutation("post", "/events");
	const schema = props.schemaBySlug.get(props.item.entitySchemaSlug);
	const entitySchemaId = schema?.id ?? "";
	const eventSchemasQuery = useEventSchemasQuery(
		entitySchemaId,
		!!entitySchemaId,
	);
	const color = schema?.accentColor ?? STONE;
	const icon = schema?.icon ?? "circle";
	const completedDate = getLastActivityLabel(new Date(props.item.completedAt));

	const saveRating = useDebouncedCallback(async (stars: number) => {
		try {
			await createEvents.mutateAsync({
				body: createReviewEventPayload({
					rating: stars,
					entityId: props.item.id,
					eventSchemas: eventSchemasQuery.eventSchemas,
				}),
			});
			props.onRated();
		} catch {
			notifications.show({
				color: "red",
				title: "Could not save rating",
				message: `Failed to rate "${props.item.title}". Please try again.`,
			});
		}
	}, 1000);

	return (
		<Paper
			radius="sm"
			style={{
				overflow: "hidden",
				border: `1px solid ${props.border}`,
				boxShadow: `0 10px 26px ${colorMix(GOLD, 0.08)}`,
				background: `linear-gradient(180deg, ${colorMix(GOLD, 0.09)} 0%, ${props.surface} 34%, ${props.surface} 100%)`,
			}}
			styles={{
				root: {
					transition: "all 0.18s ease",
					"&:hover": {
						transform: "translateY(-2px)",
						background: `linear-gradient(180deg, ${colorMix(GOLD, 0.11)} 0%, ${props.surfaceHover} 34%, ${props.surfaceHover} 100%)`,
					},
				},
			}}
		>
			<Box h={3} bg={GOLD} />
			<Group gap="sm" wrap="nowrap" p="sm">
				<Artwork
					width={64}
					radius={8}
					height={86}
					icon={icon}
					color={color}
					url={props.imageUrl}
					title={props.item.title}
				/>
				<Stack gap={4} style={{ flex: 1, minWidth: 0 }}>
					<Group gap={6}>
						<Badge
							size="xs"
							variant="light"
							style={{ backgroundColor: colorMix(color, 0.12), color }}
						>
							{schema?.name ?? "Item"}
						</Badge>
						<Text fz={10} c={props.textMuted}>
							{completedDate}
						</Text>
					</Group>
					<Text
						fz="sm"
						fw={600}
						lineClamp={1}
						c={props.textPrimary}
						ff="var(--mantine-headings-font-family)"
					>
						{props.item.title}
					</Text>
					<Text fz="xs" c={props.textMuted}>
						{props.item.subtitle.label}
					</Text>
					<Group
						mt={2}
						px={6}
						py={5}
						gap={4}
						style={{
							borderRadius: 999,
							alignSelf: "flex-start",
							backgroundColor: colorMix(GOLD, 0.08),
						}}
					>
						{[1, 2, 3, 4, 5].map((star) => (
							<Tooltip key={star} label={`${star} star${star > 1 ? "s" : ""}`}>
								<ActionIcon
									size="sm"
									variant="transparent"
									disabled={createEvents.isPending}
									onMouseLeave={() => setHovered(0)}
									onMouseEnter={() => setHovered(star)}
									onClick={() => {
										setSelected(star);
										void saveRating(star);
									}}
								>
									<Star
										size={18}
										color={GOLD}
										fill={star <= (hovered || selected) ? GOLD : "transparent"}
									/>
								</ActionIcon>
							</Tooltip>
						))}
						{selected > 0 && (
							<Text
								ml={2}
								fz={10}
								fw={600}
								c={GOLD}
								ff="var(--mantine-font-family-monospace)"
							>
								{selected}/5
							</Text>
						)}
					</Group>
				</Stack>
			</Group>
		</Paper>
	);
}

function WeekStrip(props: {
	border: string;
	textMuted: string;
	days: WeekDayView[];
	accentColor: string;
	textPrimary: string;
}) {
	const maxCount = Math.max(...props.days.map((d) => d.count), 1);
	const activeDays = props.days.filter((day) => day.count > 0).length;

	return (
		<Stack gap="md">
			<Group justify="space-between" align="flex-start" gap="sm">
				<Stack gap={4}>
					<Text
						fz={10}
						fw={700}
						tt="uppercase"
						c={props.accentColor}
						style={{ letterSpacing: "1px" }}
						ff="var(--mantine-headings-font-family)"
					>
						Weekly rhythm
					</Text>
					<Text
						fz="sm"
						fw={600}
						c={props.textPrimary}
						ff="var(--mantine-headings-font-family)"
					>
						You showed up {activeDays} of 7 days.
					</Text>
				</Stack>
				<Text fz="xs" c={props.textMuted}>
					{LIBRARY_STATS.thisWeekCompleted} completed &middot;{" "}
					{LIBRARY_STATS.thisWeekHours}h tracked
				</Text>
			</Group>
			<Group gap="xs" justify="space-between">
				{props.days.map((day) => {
					const h = day.count > 0 ? 10 + (day.count / maxCount) * 28 : 6;
					return (
						<Stack key={day.day} gap={4} align="center" style={{ flex: 1 }}>
							<Tooltip
								label={`${day.count} event${day.count !== 1 ? "s" : ""}`}
							>
								<Box
									w="100%"
									h={h}
									style={{
										borderRadius: 999,
										transition: "height 0.2s ease",
										backgroundColor:
											day.count > 0 ? props.accentColor : `${props.border}`,
										opacity:
											day.count > 0 ? 0.4 + (day.count / maxCount) * 0.6 : 1,
									}}
								/>
							</Tooltip>
							<Text fz={10} c={props.textMuted} ta="center">
								{day.day}
							</Text>
						</Stack>
					);
				})}
			</Group>
		</Stack>
	);
}

function EventRow(props: {
	border: string;
	isLast: boolean;
	textMuted: string;
	textPrimary: string;
	event: ActivityEventView;
	schemaBySlug: Map<string, AppEntitySchema>;
}) {
	const schema = props.schemaBySlug.get(props.event.entitySchemaSlug);
	const color = schema?.accentColor ?? STONE;
	const icon = schema?.icon ?? "circle";

	return (
		<Group
			py={10}
			gap="sm"
			wrap="nowrap"
			align="flex-start"
			style={{
				paddingLeft: 12,
				borderLeft: `3px solid ${color}`,
				borderBottom: props.isLast ? "none" : `1px solid ${props.border}`,
			}}
		>
			<Artwork
				radius={6}
				width={36}
				height={48}
				icon={icon}
				color={color}
				title={props.event.title}
				url={props.event.imageUrl}
			/>
			<Stack gap={2} style={{ flex: 1, minWidth: 0 }}>
				<Text
					fz="sm"
					fw={600}
					lineClamp={1}
					c={props.textPrimary}
					ff="var(--mantine-headings-font-family)"
				>
					{props.event.title}
				</Text>
				<Group gap={6} wrap="wrap">
					<Badge
						size="xs"
						variant="light"
						style={{ backgroundColor: colorMix(color, 0.12), color }}
					>
						{schema?.name ?? "Item"}
					</Badge>
					<Text fz={10} fw={600} c={color}>
						{props.event.action}
					</Text>
					{props.event.sub ? (
						<Text fz={10} c={props.textMuted}>
							&middot; {props.event.sub}
						</Text>
					) : null}
					{props.event.rating !== null && (
						<Text fz={10} ff="var(--mantine-font-family-monospace)" c={GOLD}>
							{"★".repeat(props.event.rating)}
						</Text>
					)}
				</Group>
			</Stack>
			<Text
				fz={10}
				c={props.textMuted}
				style={{ whiteSpace: "nowrap", flexShrink: 0 }}
			>
				{props.event.time}
			</Text>
		</Group>
	);
}

function TypeBar(props: {
	total: number;
	border: string;
	textMuted: string;
	types: { type: MediaType; count: number }[];
}) {
	return (
		<Stack gap={6}>
			<Box
				h={8}
				style={{ display: "flex", borderRadius: 4, overflow: "hidden" }}
			>
				{props.types.map((t) => {
					const pct = (t.count / props.total) * 100;
					return (
						<Tooltip key={t.type} label={`${t.type}: ${t.count}`}>
							<Box
								h="100%"
								style={{
									minWidth: 3,
									width: `${pct}%`,
									backgroundColor: TYPE_COLORS[t.type],
								}}
							/>
						</Tooltip>
					);
				})}
			</Box>
			<Group gap="sm" wrap="wrap">
				{props.types.slice(0, 6).map((t) => (
					<Group key={t.type} gap={4}>
						<Box
							w={8}
							h={8}
							style={{ borderRadius: 2, backgroundColor: TYPE_COLORS[t.type] }}
						/>
						<Text fz={10} c={props.textMuted}>
							{t.type} ({t.count})
						</Text>
					</Group>
				))}
				{props.types.length > 6 && (
					<Text fz={10} c={props.textMuted}>
						+{props.types.length - 6} more
					</Text>
				)}
			</Group>
		</Stack>
	);
}

function StatChip(props: {
	label: string;
	color?: string;
	border: string;
	surface: string;
	textMuted: string;
	textPrimary: string;
	value: string | number;
}) {
	return (
		<Paper
			px="md"
			py="sm"
			radius="sm"
			style={{
				border: `1px solid ${props.border}`,
				borderTop: `3px solid ${props.color ?? STONE}`,
				background: `linear-gradient(180deg, ${colorMix(props.color ?? STONE, 0.08)} 0%, ${props.surface} 100%)`,
			}}
		>
			<Text
				fz={10}
				fw={700}
				tt="uppercase"
				c={props.textMuted}
				style={{ letterSpacing: "0.9px" }}
				ff="var(--mantine-headings-font-family)"
			>
				{props.label}
			</Text>
			<Text
				mt={6}
				fz="xl"
				fw={700}
				lh={1.2}
				c={props.color ?? props.textPrimary}
				ff="var(--mantine-font-family-monospace)"
			>
				{props.value}
			</Text>
			<Text fz={10} c={props.textMuted} fw={500} mt={2}>
				In your library
			</Text>
		</Paper>
	);
}

interface BuiltinMediaTrackerOverviewProps {
	tracker: AppTracker;
}

export function BuiltinMediaTrackerOverview(
	props: BuiltinMediaTrackerOverviewProps,
) {
	const t = useThemeTokens();
	const apiClient = useApiClient();
	const queryClient = useQueryClient();
	const [mainRef] = useAutoAnimate<HTMLDivElement>();
	const [upNextRef] = useAutoAnimate<HTMLDivElement>();
	const [continueRef] = useAutoAnimate<HTMLDivElement>();
	const [rateTheseRef] = useAutoAnimate<HTMLDivElement>();

	const weekQuery = apiClient.useQuery("get", "/media/overview/week");
	const upNextQuery = apiClient.useQuery("get", "/media/overview/up-next");
	const rateTheseQuery = apiClient.useQuery("get", "/media/overview/review");
	const continueQuery = apiClient.useQuery("get", "/media/overview/continue");
	const activityQuery = apiClient.useQuery("get", "/media/overview/activity");

	const invalidateUpNext = useCallback(() => {
		void queryClient.invalidateQueries({
			queryKey: apiClient.queryOptions("get", "/media/overview/up-next")
				.queryKey,
		});
	}, [apiClient, queryClient]);

	const invalidateReviews = useCallback(() => {
		void queryClient.invalidateQueries({
			queryKey: apiClient.queryOptions("get", "/media/overview/review")
				.queryKey,
		});
	}, [apiClient, queryClient]);

	const invalidateContinue = useCallback(() => {
		void queryClient.invalidateQueries({
			queryKey: apiClient.queryOptions("get", "/media/overview/continue")
				.queryKey,
		});
	}, [apiClient, queryClient]);

	const invalidateOverview = useCallback(() => {
		invalidateUpNext();
		invalidateReviews();
		invalidateContinue();
	}, [invalidateContinue, invalidateReviews, invalidateUpNext]);

	const entitySchemasQuery = useEntitySchemasQuery(props.tracker.id, true);

	const weekItems = weekQuery.data?.data.items ?? [];
	const upNextItems = upNextQuery.data?.data.items ?? [];
	const continueItems = continueQuery.data?.data.items ?? [];
	const activityItems = activityQuery.data?.data.items ?? [];
	const rateTheseItems = rateTheseQuery.data?.data.items ?? [];
	const typePickerModalId = `builtin-media-type-picker-${props.tracker.id}`;

	const allImageEntries = [
		...upNextItems,
		...continueItems,
		...rateTheseItems,
		...activityItems.map((item) => ({
			id: item.id,
			image: toAppEntityImage(item.entity.image),
		})),
	].map((item) => ({ id: item.id, image: toAppEntityImage(item.image) }));
	const imageUrls = useResolvedImageUrls(allImageEntries);

	const schemaBySlug = new Map(
		entitySchemasQuery.entitySchemas.map((s) => [s.slug, s]),
	);

	const searchableSchemas = entitySchemasQuery.entitySchemas.filter(
		(s) => s.providers.length > 0,
	);

	const openSearchModal = (
		schema: AppEntitySchema,
		intent: "log" | "backlog",
	) => {
		const searchModalId = `builtin-media-search-${props.tracker.id}-${schema.id}`;
		const actionVerb = intent === "log" ? "Start" : "Queue";

		modals.open({
			size: "lg",
			centered: true,
			modalId: searchModalId,
			overlayProps: { backgroundOpacity: 0.55, blur: 3 },
			children: (
				<SearchEntityModalContent
					entitySchema={schema}
					initialAction={intent}
					onActionCompleted={invalidateOverview}
				/>
			),
			title: (
				<SearchEntityModalTitle
					actionVerb={actionVerb}
					entitySchemaName={schema.name}
					onBack={() => modals.close(searchModalId)}
				/>
			),
		});
	};

	const openTypePickerModal = (intent: "log" | "backlog") => {
		const title = intent === "log" ? "Start something" : "Queue something";

		modals.open({
			size: "lg",
			centered: true,
			modalId: typePickerModalId,
			overlayProps: { backgroundOpacity: 0.55, blur: 3 },
			title: (
				<Text ff="var(--mantine-headings-font-family)" fw={600} fz="md">
					{title}
				</Text>
			),
			children: (
				<SimpleGrid cols={{ base: 3, sm: 4 }} spacing="sm">
					{searchableSchemas.map((schema) => {
						return (
							<UnstyledButton
								key={schema.id}
								onClick={() => openSearchModal(schema, intent)}
							>
								<Paper
									p="md"
									ta="center"
									radius="sm"
									style={{
										cursor: "pointer",
										background: t.surface,
										border: `1px solid ${t.border}`,
										transition: "border-color 0.15s ease",
									}}
								>
									<Stack gap={6} align="center">
										<TrackerIcon
											size={24}
											icon={schema.icon}
											color={schema.accentColor}
										/>
										<Text
											fz="xs"
											fw={600}
											c={t.textPrimary}
											ff="var(--mantine-headings-font-family)"
										>
											{schema.name}
										</Text>
										<Text fz={10} c={t.textMuted}>
											Find and track {schema.name.toLowerCase()}
										</Text>
									</Stack>
								</Paper>
							</UnstyledButton>
						);
					})}
				</SimpleGrid>
			),
		});
	};

	if (
		entitySchemasQuery.isLoading ||
		upNextQuery.isLoading ||
		continueQuery.isLoading ||
		rateTheseQuery.isLoading ||
		activityQuery.isLoading ||
		weekQuery.isLoading ||
		imageUrls.isLoading
	) {
		return (
			<Center h={400}>
				<Loader />
			</Center>
		);
	}

	if (
		entitySchemasQuery.isError ||
		upNextQuery.isError ||
		continueQuery.isError ||
		rateTheseQuery.isError ||
		activityQuery.isError ||
		weekQuery.isError ||
		imageUrls.isError
	) {
		return (
			<Paper p="lg" withBorder>
				<Text c="red">Failed to load media overview</Text>
			</Paper>
		);
	}

	const liveWeekActivity = buildWeekActivity(weekItems);
	const liveActivityEvents = activityItems.map((item) => {
		const occurredAt = new Date(item.occurredAt);
		return {
			id: item.id,
			date: getActivityDateLabel(occurredAt),
			time: getLastActivityLabel(occurredAt),
			title: item.entity.name,
			action: getActivityActionLabel(item),
			rating: item.rating,
			sub: undefined,
			entitySchemaSlug: item.entity.entitySchemaSlug,
			imageUrl: imageUrls.imageUrlByEntityId.get(item.id),
		};
	});
	const dateGroups = liveActivityEvents.reduce<
		Record<string, ActivityEventView[]>
	>((acc, event) => {
		if (!acc[event.date]) {
			acc[event.date] = [];
		}
		acc[event.date]?.push(event);
		return acc;
	}, {});
	const weekTotalEvents = liveWeekActivity.reduce(
		(total, day) => total + day.count,
		0,
	);

	return (
		<Stack gap="xl" ref={mainRef}>
			<Group justify="space-between" align="flex-end" gap="sm">
				<Stack gap={6} maw={640}>
					<Text
						lh={1}
						fz={30}
						fw={700}
						c={t.textPrimary}
						ff="var(--mantine-headings-font-family)"
					>
						Media
					</Text>
					<Group gap="xs" wrap="wrap">
						<Badge
							variant="light"
							style={{
								color: SECTION_ACCENTS.continue,
								backgroundColor: colorMix(SECTION_ACCENTS.continue, 0.12),
							}}
						>
							{continueItems.length} in progress
						</Badge>
						<Badge
							variant="light"
							style={{
								color: SECTION_ACCENTS.queue,
								backgroundColor: colorMix(SECTION_ACCENTS.queue, 0.12),
							}}
						>
							{upNextItems.length} queued next
						</Badge>
						<Badge
							variant="light"
							style={{
								color: SECTION_ACCENTS.review,
								backgroundColor: colorMix(SECTION_ACCENTS.review, 0.12),
							}}
						>
							{rateTheseItems.length} still unrated
						</Badge>
					</Group>
				</Stack>
				<Group gap="xs">
					<Button
						size="sm"
						variant="default"
						leftSection={<Bookmark size={14} />}
						onClick={() => openTypePickerModal("backlog")}
					>
						Add to watchlist
					</Button>
					<Button
						size="sm"
						leftSection={<Play size={14} />}
						style={{ backgroundColor: GOLD, color: "white" }}
						onClick={() => openTypePickerModal("log")}
					>
						Start tracking
					</Button>
				</Group>
			</Group>

			{continueItems.length > 0 && (
				<SectionFrame
					border={t.border}
					isDark={t.isDark}
					surface={t.surface}
					accentColor={SECTION_ACCENTS.continue}
				>
					<SectionHeader
						title="Continue"
						textMuted={t.textMuted}
						textPrimary={t.textPrimary}
						eyebrow="Continue where you left off"
						accentColor={SECTION_ACCENTS.continue}
						right={
							<Group gap={4}>
								<Clock size={12} color={t.textMuted} />
								<Text fz="xs" c={t.textMuted}>
									{continueItems.length} in progress
								</Text>
							</Group>
						}
					/>
					<SimpleGrid
						spacing="sm"
						ref={continueRef}
						cols={{ base: 1, sm: 2, lg: 3 }}
					>
						{continueItems.slice(0, 6).map((item) => (
							<ContinueCard
								item={item}
								key={item.id}
								border={t.border}
								surface={t.surface}
								textMuted={t.textMuted}
								textPrimary={t.textPrimary}
								schemaBySlug={schemaBySlug}
								surfaceHover={t.surfaceHover}
								imageUrl={imageUrls.imageUrlByEntityId.get(item.id)}
							/>
						))}
					</SimpleGrid>
				</SectionFrame>
			)}

			{upNextItems.length > 0 && (
				<SectionFrame
					border={t.border}
					isDark={t.isDark}
					surface={t.surface}
					accentColor={SECTION_ACCENTS.queue}
				>
					<SectionHeader
						title="Up Next"
						textMuted={t.textMuted}
						eyebrow="Your watchlist"
						textPrimary={t.textPrimary}
						accentColor={SECTION_ACCENTS.queue}
						right={
							<Text fz="xs" c={t.textMuted}>
								{upNextItems.length} queued
							</Text>
						}
					/>
					<ScrollArea scrollbarSize={4} type="hover">
						<Group gap="sm" wrap="nowrap" pb={4} ref={upNextRef}>
							{upNextItems.map((item, index) => (
								<BacklogCard
									item={item}
									rank={index}
									key={item.id}
									border={t.border}
									surface={t.surface}
									textMuted={t.textMuted}
									textPrimary={t.textPrimary}
									schemaBySlug={schemaBySlug}
									surfaceHover={t.surfaceHover}
									imageUrl={imageUrls.imageUrlByEntityId.get(item.id)}
								/>
							))}
						</Group>
					</ScrollArea>
				</SectionFrame>
			)}

			{rateTheseItems.length > 0 && (
				<SectionFrame
					border={t.border}
					isDark={t.isDark}
					surface={t.surface}
					accentColor={SECTION_ACCENTS.review}
				>
					<SectionHeader
						title="Rate and Review"
						textMuted={t.textMuted}
						textPrimary={t.textPrimary}
						eyebrow="Share your thoughts"
						accentColor={SECTION_ACCENTS.review}
						right={
							<Text fz="xs" c={t.textMuted}>
								{rateTheseItems.length} unrated
							</Text>
						}
					/>
					<SimpleGrid
						spacing="sm"
						ref={rateTheseRef}
						cols={{ base: 1, sm: 2, lg: 3 }}
					>
						{rateTheseItems.map((item) => (
							<RateCard
								item={item}
								key={item.id}
								border={t.border}
								surface={t.surface}
								textMuted={t.textMuted}
								textPrimary={t.textPrimary}
								schemaBySlug={schemaBySlug}
								onRated={invalidateReviews}
								surfaceHover={t.surfaceHover}
								imageUrl={imageUrls.imageUrlByEntityId.get(item.id)}
							/>
						))}
					</SimpleGrid>
				</SectionFrame>
			)}

			<SectionFrame
				border={t.border}
				isDark={t.isDark}
				surface={t.surface}
				accentColor={SECTION_ACCENTS.activity}
			>
				<SectionHeader
					eyebrow="This week"
					title="Recent Activity"
					textMuted={t.textMuted}
					textPrimary={t.textPrimary}
					accentColor={SECTION_ACCENTS.activity}
				/>
				<Paper
					p="md"
					radius="sm"
					style={{
						border: `1px solid ${t.border}`,
						background: `linear-gradient(180deg, ${colorMix(SECTION_ACCENTS.activity, 0.08)} 0%, ${t.surface} 18%, ${t.surface} 100%)`,
					}}
				>
					<WeekStrip
						border={t.border}
						days={liveWeekActivity}
						textMuted={t.textMuted}
						textPrimary={t.textPrimary}
						accentColor={SECTION_ACCENTS.activity}
					/>
					<Group gap="xs" mt="md" mb="sm">
						<Badge
							variant="light"
							style={{
								color: SECTION_ACCENTS.activity,
								backgroundColor: colorMix(SECTION_ACCENTS.activity, 0.12),
							}}
						>
							{weekTotalEvents} events this week
						</Badge>
					</Group>
					<Box pt="md" style={{ borderTop: `1px solid ${t.border}` }}>
						{Object.entries(dateGroups).map(([date, events]) => (
							<Box key={date}>
								<Text
									mb={6}
									fz={10}
									fw={700}
									tt="uppercase"
									c={t.textMuted}
									style={{ letterSpacing: "1px" }}
									ff="var(--mantine-headings-font-family)"
								>
									{date}
								</Text>
								<Box px="xs">
									{events.map((event, i) => (
										<EventRow
											event={event}
											key={event.id}
											border={t.border}
											schemaBySlug={schemaBySlug}
											textMuted={t.textMuted}
											textPrimary={t.textPrimary}
											isLast={i === events.length - 1}
										/>
									))}
								</Box>
							</Box>
						))}
					</Box>
				</Paper>
			</SectionFrame>

			<SectionFrame
				border={t.border}
				isDark={t.isDark}
				surface={t.surface}
				accentColor={SECTION_ACCENTS.library}
			>
				<SectionHeader
					title="Your Library"
					textMuted={t.textMuted}
					textPrimary={t.textPrimary}
					eyebrow="Collection overview"
					accentColor={SECTION_ACCENTS.library}
					right={
						<Text fz="xs" c={t.textMuted}>
							{LIBRARY_STATS.total} total entries
						</Text>
					}
				/>
				<Stack gap="sm">
					<SimpleGrid cols={{ base: 2, xs: 3, sm: 5 }} spacing="sm">
						<StatChip
							label="Total"
							border={t.border}
							surface={t.surface}
							textMuted={t.textMuted}
							value={LIBRARY_STATS.total}
							textPrimary={t.textPrimary}
						/>
						<StatChip
							label="Active"
							color="#5B7FFF"
							border={t.border}
							surface={t.surface}
							textMuted={t.textMuted}
							textPrimary={t.textPrimary}
							value={LIBRARY_STATS.active}
						/>
						<StatChip
							color="#5B8A5F"
							border={t.border}
							label="Completed"
							surface={t.surface}
							textMuted={t.textMuted}
							textPrimary={t.textPrimary}
							value={LIBRARY_STATS.completed}
						/>
						<StatChip
							color={GOLD}
							border={t.border}
							label="Avg Rating"
							surface={t.surface}
							textMuted={t.textMuted}
							textPrimary={t.textPrimary}
							value={LIBRARY_STATS.avgRating.toFixed(1)}
						/>
						<StatChip
							color="#E09840"
							label="On Hold"
							border={t.border}
							surface={t.surface}
							textMuted={t.textMuted}
							textPrimary={t.textPrimary}
							value={LIBRARY_STATS.onHold}
						/>
					</SimpleGrid>
					<Paper
						p="md"
						radius="sm"
						style={{
							border: `1px solid ${t.border}`,
							background: `linear-gradient(180deg, ${colorMix(SECTION_ACCENTS.library, 0.06)} 0%, ${t.surface} 100%)`,
						}}
					>
						<Text
							mb="xs"
							fz="xs"
							fw={600}
							c={t.textMuted}
							ff="var(--mantine-headings-font-family)"
						>
							Your collection
						</Text>
						<TypeBar
							border={t.border}
							types={TYPE_COUNTS}
							textMuted={t.textMuted}
							total={LIBRARY_STATS.total}
						/>
					</Paper>
				</Stack>
			</SectionFrame>
		</Stack>
	);
}
