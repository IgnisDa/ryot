import {
	Button,
	Center,
	Grid,
	Group,
	Loader,
	Paper,
	SimpleGrid,
	Stack,
	Text,
} from "@mantine/core";
import { Link } from "@tanstack/react-router";
import { EntityCard } from "#/components/EntityCard";
import { StatsCard } from "#/components/StatsCard";
import { useResolvedEntityImageUrls } from "#/features/entities/image";
import type { AppEntity } from "#/features/entities/model";
import type { AppEntitySchema } from "#/features/entity-schemas/model";
import type { AppTracker } from "#/features/trackers/model";
import { useColorScheme } from "#/hooks/theme";
import {
	getActivityTimeLabel,
	getLastActivityLabel,
	useTrackerOverviewData,
} from "./tracker-overview-data";
import {
	getTrackerOverviewTokens,
	TrackerOverviewActivityItem,
	TrackerOverviewEmptyPanel,
	TrackerOverviewHeader,
	TrackerOverviewQuickActions,
	TrackerOverviewSavedViews,
} from "./tracker-overview-sections";

export interface TrackerOverviewProps {
	tracker: AppTracker;
	onAddEntitySchema: () => void;
	entitySchemas: AppEntitySchema[];
	onLogEvent: (entity: AppEntity) => void;
	onAddEntity: (entitySchemaId: string) => void;
	onAddEventSchema: (entitySchemaId: string) => void;
}

export function TrackerOverview(props: TrackerOverviewProps) {
	const colorScheme = useColorScheme();
	const isDark = colorScheme === "dark";
	const accentColor =
		props.tracker.accentColor ||
		props.entitySchemas[0]?.accentColor ||
		"#D4A574";
	const { textLink } = getTrackerOverviewTokens(isDark);
	const overview = useTrackerOverviewData({
		tracker: props.tracker,
		entitySchemas: props.entitySchemas,
	});
	const imageUrls = useResolvedEntityImageUrls(
		overview.recentEntities.map((item) => item.entity),
	);

	if (overview.isLoading) {
		return (
			<Center py="xl">
				<Loader size="sm" />
			</Center>
		);
	}

	if (overview.isError) {
		return (
			<Stack gap="md">
				<TrackerOverviewHeader
					tracker={props.tracker}
					accentColor={accentColor}
				/>
				<TrackerOverviewEmptyPanel
					isDark={isDark}
					title="Overview unavailable"
					description="We could not load overview data for this tracker right now."
				/>
			</Stack>
		);
	}

	const primarySchema = overview.primaryEntitySchema;
	const entityActionLabel = primarySchema
		? `Add ${primarySchema.name}`
		: "Add entity schema";
	const eventActionLabel = overview.primaryEventSchemas.length
		? "Log event"
		: primarySchema
			? "Add event schema"
			: "Create schema first";

	return (
		<Stack gap="xl">
			<TrackerOverviewHeader
				tracker={props.tracker}
				accentColor={accentColor}
			/>

			<SimpleGrid cols={{ base: 1, xs: 2, sm: 4 }} spacing="sm">
				<StatsCard
					isDark={isDark}
					color={accentColor}
					label="Total Entries"
					value={overview.totalEntities}
				/>
				<StatsCard
					isDark={isDark}
					color={accentColor}
					label="Logged Events"
					value={overview.totalEvents}
				/>
				<StatsCard
					label="Schemas"
					isDark={isDark}
					color={accentColor}
					value={props.entitySchemas.length}
					change={`${overview.totalEventSchemas} event schemas`}
				/>
				<StatsCard
					isDark={isDark}
					color={accentColor}
					label="Last Active"
					value={getLastActivityLabel(overview.lastActivityAt)}
				/>
			</SimpleGrid>

			<Grid>
				<Grid.Col span={{ base: 12, md: 8 }}>
					<Stack gap="md">
						<Paper p="md" withBorder radius="md">
							<Stack gap="md">
								<Text
									fw={600}
									size="xs"
									c="dimmed"
									tt="uppercase"
									style={{ letterSpacing: "0.8px" }}
								>
									Recent Activity
								</Text>
								{overview.recentActivities.length === 0 ? (
									<Text c="dimmed" size="sm">
										This tracker has no activity yet. Add your first entity or
										log the first event to bring it to life.
									</Text>
								) : (
									<Stack gap="sm">
										{overview.recentActivities.map((activity) => (
											<TrackerOverviewActivityItem
												kind={activity.kind}
												action={activity.label}
												accentColor={accentColor}
												entityId={activity.entityId}
												time={getActivityTimeLabel(activity)}
												key={`${activity.kind}-${activity.entityId}-${activity.label}`}
											/>
										))}
									</Stack>
								)}
							</Stack>
						</Paper>

						<Stack gap="sm">
							<Text
								fw={600}
								size="xs"
								tt="uppercase"
								c="dimmed"
								style={{ letterSpacing: "0.8px" }}
							>
								Recently Added
							</Text>
							{overview.recentEntities.length === 0 ? (
								<TrackerOverviewEmptyPanel
									isDark={isDark}
									title="No tracked items yet"
									description="Create the first entity in this tracker to start building your overview."
								/>
							) : (
								<SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
									{overview.recentEntities.map((item) => (
										<Link
											key={item.entity.id}
											to="/entities/$entityId"
											params={{ entityId: item.entity.id }}
										>
											<EntityCard
												isDark={isDark}
												name={item.entity.name}
												schemaName={item.schema.name}
												image={imageUrls.imageUrlByEntityId.get(item.entity.id)}
												trackerColor={{
													base: item.schema.accentColor,
													muted: `color-mix(in srgb, ${item.schema.accentColor} 15%, transparent)`,
												}}
												lastEvent={
													item.latestEvent
														? `${item.latestEvent.eventSchemaName} ${getLastActivityLabel(item.latestEvent.occurredAt)}`
														: `Added ${getLastActivityLabel(item.entity.createdAt)}`
												}
											/>
										</Link>
									))}
								</SimpleGrid>
							)}
						</Stack>
					</Stack>
				</Grid.Col>

				<Grid.Col span={{ base: 12, md: 4 }}>
					<Stack gap="md">
						<TrackerOverviewQuickActions
							isDark={isDark}
							accentColor={accentColor}
							canLogEvent={!!primarySchema}
							canCreateEntity={!!primarySchema}
							eventActionLabel={eventActionLabel}
							entityActionLabel={entityActionLabel}
							onAddSchema={props.onAddEntitySchema}
							onCreateEntity={() =>
								primarySchema
									? props.onAddEntity(primarySchema.id)
									: props.onAddEntitySchema()
							}
							onLogEvent={() => {
								if (
									overview.primaryEventSchemas.length &&
									overview.primaryEntity
								) {
									props.onLogEvent(overview.primaryEntity);
									return;
								}

								if (primarySchema) {
									props.onAddEventSchema(primarySchema.id);
								}
							}}
						/>

						<TrackerOverviewSavedViews
							isDark={isDark}
							textLink={textLink}
							views={overview.savedViews}
						/>
					</Stack>
				</Grid.Col>
			</Grid>

			<Stack gap="md">
				<Text
					fw={600}
					size="xs"
					c="dimmed"
					tt="uppercase"
					style={{ letterSpacing: "0.8px" }}
				>
					Your Schemas
				</Text>
				{overview.schemaSummaries.map((summary) => (
					<Paper p="md" key={summary.schema.id} withBorder radius="md">
						<Group justify="space-between" align="flex-start">
							<Stack gap={2}>
								<Text fw={600}>{summary.schema.name}</Text>
								<Text size="sm" c="dimmed">
									{summary.count} tracked · {summary.eventSchemaCount} event
									schemas ·{" "}
									{Object.keys(summary.schema.propertiesSchema).length}{" "}
									properties
								</Text>
								{summary.latestEntity && (
									<Text size="xs" c="dimmed">
										Latest: {summary.latestEntity.name}
									</Text>
								)}
							</Stack>
							<Group gap="xs">
								{summary.savedView && (
									<Link
										to="/views/$viewId"
										params={{ viewId: summary.savedView.id }}
									>
										<Button component="span" size="xs" variant="light">
											Open all
										</Button>
									</Link>
								)}
								<Button
									size="xs"
									variant="light"
									onClick={() => props.onAddEntity(summary.schema.id)}
								>
									Add {summary.schema.name}
								</Button>
								<Button
									size="xs"
									variant="subtle"
									onClick={() => props.onAddEventSchema(summary.schema.id)}
								>
									Add event schema
								</Button>
							</Group>
						</Group>
					</Paper>
				))}

				<Paper p="md" withBorder radius="md" ta="center">
					<Stack gap="sm" align="center">
						<Text c="dimmed" size="sm">
							Need to track another type of entity?
						</Text>
						<Button size="sm" variant="light" onClick={props.onAddEntitySchema}>
							Add another entity schema
						</Button>
					</Stack>
				</Paper>
			</Stack>
		</Stack>
	);
}
