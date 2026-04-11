import { useAutoAnimate } from "@formkit/auto-animate/react";
import {
	Badge,
	Box,
	Button,
	Center,
	Group,
	Loader,
	Paper,
	ScrollArea,
	SimpleGrid,
	Stack,
	Text,
} from "@mantine/core";
import { dayjs } from "@ryot/ts-utils";
import { useQueryClient } from "@tanstack/react-query";
import { Bookmark, Clock } from "lucide-react";
import { useCallback } from "react";
import { useResolvedImageUrls } from "~/features/entities/image";
import { toAppEntityImage } from "~/features/entities/model";
import { useEntitySchemasQuery } from "~/features/entity-schemas/hooks";
import type { AppTracker } from "~/features/trackers/model";
import { useApiClient } from "~/hooks/api";
import { useThemeTokens } from "~/hooks/theme";
import { EventRow, StatChip, TypeBar, WeekStrip } from "./components/activity";
import { BacklogCard, ContinueCard, RateCard } from "./components/cards";
import { useMediaOverviewModalHandlers } from "./components/modal-handlers";
import { SectionFrame, SectionHeader } from "./components/section";
import {
	type ActivityEventView,
	buildWeekActivity,
	GOLD,
	getActivityActionLabel,
	getActivityDateLabel,
	getLastActivityLabel,
	SECTION_ACCENTS,
	STONE,
} from "./shared";

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
	const libraryQuery = apiClient.useQuery("get", "/media/overview/library");
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

	const searchableSchemas = entitySchemasQuery.entitySchemas.filter(
		(s) => s.providers.length > 0,
	);

	const { handleStartItem, handleContinueItem, openTypePickerModal } =
		useMediaOverviewModalHandlers({
			searchableSchemas,
			invalidateOverview,
			trackerId: props.tracker.id,
		});

	const allImageEntries = [
		...upNextItems,
		...continueItems,
		...rateTheseItems,
		...activityItems.map((item) => ({
			id: item.entityId,
			image: item.entity.image,
		})),
	].map((item) => ({ id: item.id, image: toAppEntityImage(item.image) }));
	const imageUrls = useResolvedImageUrls(allImageEntries);

	const schemaBySlug = new Map(
		entitySchemasQuery.entitySchemas.map((s) => [s.slug, s]),
	);

	if (
		entitySchemasQuery.isLoading ||
		upNextQuery.isLoading ||
		continueQuery.isLoading ||
		rateTheseQuery.isLoading ||
		activityQuery.isLoading ||
		weekQuery.isLoading ||
		libraryQuery.isLoading ||
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
		libraryQuery.isError ||
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
		const occurredAt = dayjs(item.occurredAt);
		return {
			id: item.id,
			sub: undefined,
			rating: item.rating,
			title: item.entity.name,
			entityId: item.entityId,
			action: getActivityActionLabel(item),
			date: getActivityDateLabel(occurredAt),
			entitySchemaSlug: item.entity.entitySchemaSlug,
			time: getLastActivityLabel(occurredAt.toDate()),
			imageUrl: imageUrls.imageUrlByEntityId.get(item.entityId),
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

	const libraryData = libraryQuery.data?.data;
	const libraryTypeCounts = libraryData
		? Object.entries(libraryData.entityTypeCounts).map(([slug, count]) => ({
				slug,
				count,
				color: schemaBySlug.get(slug)?.accentColor ?? STONE,
			}))
		: [];

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
								backgroundColor: `color-mix(in srgb, ${SECTION_ACCENTS.continue} 12%, transparent)`,
							}}
						>
							{continueItems.length} in progress
						</Badge>
						<Badge
							variant="light"
							style={{
								color: SECTION_ACCENTS.queue,
								backgroundColor: `color-mix(in srgb, ${SECTION_ACCENTS.queue} 12%, transparent)`,
							}}
						>
							{upNextItems.length} queued next
						</Badge>
						<Badge
							variant="light"
							style={{
								color: SECTION_ACCENTS.review,
								backgroundColor: `color-mix(in srgb, ${SECTION_ACCENTS.review} 12%, transparent)`,
							}}
						>
							{rateTheseItems.length} still unrated
						</Badge>
					</Group>
				</Stack>
				<Button
					size="sm"
					variant="default"
					leftSection={<Bookmark size={14} />}
					onClick={() => openTypePickerModal()}
				>
					Add to watchlist
				</Button>
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
								onContinue={() => {
									const schema = schemaBySlug.get(item.entitySchemaSlug);
									handleContinueItem(
										item.id,
										schema?.accentColor ?? STONE,
										schema?.id ?? "",
										item.progress.progressPercent ?? null,
									);
								}}
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
									onStart={() => {
										const schema = schemaBySlug.get(item.entitySchemaSlug);
										handleStartItem(
											item.id,
											schema?.id ?? "",
											schema?.accentColor ?? STONE,
										);
									}}
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
						background: `linear-gradient(180deg, color-mix(in srgb, ${SECTION_ACCENTS.activity} 8%, transparent) 0%, ${t.surface} 18%, ${t.surface} 100%)`,
					}}
				>
					<WeekStrip
						border={t.border}
						days={liveWeekActivity}
						textMuted={t.textMuted}
						textPrimary={t.textPrimary}
						weekTotalEvents={weekTotalEvents}
						accentColor={SECTION_ACCENTS.activity}
					/>
					<Group gap="xs" mt="md" mb="sm">
						<Badge
							variant="light"
							style={{
								color: SECTION_ACCENTS.activity,
								backgroundColor: `color-mix(in srgb, ${SECTION_ACCENTS.activity} 12%, transparent)`,
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
							{libraryData?.total ?? 0} total entries
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
							value={libraryData?.total ?? 0}
							textPrimary={t.textPrimary}
						/>
						<StatChip
							label="In Progress"
							color="#5B7FFF"
							border={t.border}
							surface={t.surface}
							textMuted={t.textMuted}
							textPrimary={t.textPrimary}
							value={libraryData?.inProgress ?? 0}
						/>
						<StatChip
							color="#5B8A5F"
							border={t.border}
							label="Completed"
							surface={t.surface}
							textMuted={t.textMuted}
							textPrimary={t.textPrimary}
							value={libraryData?.completed ?? 0}
						/>
						<StatChip
							color={GOLD}
							border={t.border}
							label="Avg Rating"
							surface={t.surface}
							textMuted={t.textMuted}
							textPrimary={t.textPrimary}
							value={libraryData?.avgRating?.toFixed(1) ?? "-"}
						/>
						<StatChip
							color="#E09840"
							border={t.border}
							label="In Backlog"
							surface={t.surface}
							textMuted={t.textMuted}
							textPrimary={t.textPrimary}
							value={libraryData?.inBacklog ?? 0}
						/>
					</SimpleGrid>
					<Paper
						p="md"
						radius="sm"
						style={{
							border: `1px solid ${t.border}`,
							background: `linear-gradient(180deg, color-mix(in srgb, ${SECTION_ACCENTS.library} 6%, transparent) 0%, ${t.surface} 100%)`,
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
							textMuted={t.textMuted}
							types={libraryTypeCounts}
							total={libraryData?.total ?? 0}
						/>
					</Paper>
				</Stack>
			</SectionFrame>
		</Stack>
	);
}
