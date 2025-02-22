import {
	Anchor,
	Badge,
	Box,
	Button,
	Center,
	Code,
	Grid,
	Group,
	Loader,
	Paper,
	Stack,
	Text,
	Title,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Calendar, ExternalLink, Hash } from "lucide-react";
import { useCallback, useState } from "react";
import { getEntityDetailProperties } from "#/features/entities/detail";
import { useEntityQuery } from "#/features/entities/hooks";
import type { AppEntity } from "#/features/entities/model";
import { useEntitySchemasQuery } from "#/features/entity-schemas/hooks";
import { useEventSchemasQuery } from "#/features/event-schemas/hooks";
import type { AppEventSchema } from "#/features/event-schemas/model";
import type { CreateEventPayload } from "#/features/events/form";
import { useEventMutations, useEventsQuery } from "#/features/events/hooks";
import { LogEventModal } from "#/features/events/section";
import { useTrackersQuery } from "#/features/trackers/hooks";
import { useColorScheme } from "#/hooks/theme";

export const Route = createFileRoute("/_protected/$trackerSlug/$entityId")({
	component: RouteComponent,
});

const TRACKER_COLORS: Record<string, { base: string; muted: string }> = {
	media: { base: "#5B7FFF", muted: "rgba(91, 127, 255, 0.12)" },
	fitness: { base: "#2DD4BF", muted: "rgba(45, 212, 191, 0.12)" },
};

const DEFAULT_TRACKER_COLOR = {
	base: "#D4A574",
	muted: "rgba(212, 165, 116, 0.12)",
};

function getTrackerColor(trackerSlug: string) {
	return TRACKER_COLORS[trackerSlug] ?? DEFAULT_TRACKER_COLOR;
}

function LoadingState() {
	return (
		<Center h="100vh">
			<Loader size="lg" />
		</Center>
	);
}

function ErrorState(props: {
	title: string;
	description: string;
	onRetry?: () => void;
}) {
	return (
		<Box py={80} px="xl">
			<Stack align="center" gap="lg" maw={600} mx="auto">
				<Title order={1} ta="center">
					{props.title}
				</Title>
				<Text c="dimmed" size="lg" ta="center">
					{props.description}
				</Text>
				{props.onRetry ? (
					<Button variant="light" onClick={props.onRetry}>
						Retry
					</Button>
				) : null}
			</Stack>
		</Box>
	);
}

function IdentityHeader(props: {
	border: string;
	entity: AppEntity;
	trackerName: string;
	trackerSlug: string;
	schemaName: string;
	trackerColor: { base: string; muted: string };
}) {
	const hasImage =
		props.entity.image &&
		(props.entity.image.kind === "remote" || props.entity.image.kind === "s3");

	return (
		<Box mb="xl">
			<Link to="/$trackerSlug" params={{ trackerSlug: props.trackerSlug }}>
				<Anchor component="span" size="sm" c="accent.5" fw={500}>
					← Back to {props.trackerName}
				</Anchor>
			</Link>

			<Grid mt="lg">
				<Grid.Col span={{ base: 12, md: 8 }}>
					<Stack gap="md">
						<Group gap="sm" wrap="wrap">
							<Badge
								size="md"
								variant="light"
								styles={{
									root: {
										color: props.trackerColor.base,
										borderColor: `${props.trackerColor.base}33`,
										backgroundColor: props.trackerColor.muted,
										fontFamily: '"Space Grotesk", sans-serif',
										fontWeight: 600,
									},
								}}
							>
								{props.trackerName}
							</Badge>
							<Badge
								size="md"
								variant="outline"
								styles={{
									root: {
										fontFamily: '"Space Grotesk", sans-serif',
										fontWeight: 500,
									},
								}}
							>
								{props.schemaName}
							</Badge>
						</Group>

						<Title
							order={1}
							fw={600}
							style={{
								fontSize: "clamp(1.75rem, 4vw, 2.5rem)",
								fontFamily: '"Space Grotesk", sans-serif',
								lineHeight: 1.2,
							}}
						>
							{props.entity.name}
						</Title>

						<Group gap="lg" wrap="wrap">
							<Group gap={6}>
								<Calendar size={16} strokeWidth={2} />
								<Text size="sm" c="dimmed">
									Created{" "}
									{props.entity.createdAt.toLocaleDateString(undefined, {
										year: "numeric",
										month: "short",
										day: "numeric",
									})}
								</Text>
							</Group>
							{props.entity.externalId && (
								<Group gap={6}>
									<ExternalLink size={16} strokeWidth={2} />
									<Text
										size="sm"
										c="dimmed"
										style={{ fontFamily: "monospace" }}
									>
										{props.entity.externalId}
									</Text>
								</Group>
							)}
						</Group>
					</Stack>
				</Grid.Col>

				{hasImage && (
					<Grid.Col span={{ base: 12, md: 4 }}>
						<Box
							style={{
								borderRadius: "var(--mantine-radius-sm)",
								overflow: "hidden",
								aspectRatio: "3 / 4",
								border: `1px solid ${props.border}`,
							}}
						>
							<Box
								style={{
									width: "100%",
									height: "100%",
									backgroundSize: "cover",
									backgroundPosition: "center",
									backgroundImage:
										props.entity.image && props.entity.image.kind === "remote"
											? `url(${props.entity.image.url})`
											: undefined,
								}}
							/>
						</Box>
					</Grid.Col>
				)}

				{!hasImage && (
					<Grid.Col span={{ base: 12, md: 4 }}>
						<Paper
							p="xl"
							radius="sm"
							withBorder
							style={{
								aspectRatio: "3 / 4",
								display: "grid",
								placeItems: "center",
								borderColor: props.trackerColor.base,
								backgroundColor: props.trackerColor.muted,
							}}
						>
							<Text c="dimmed" size="sm" fw={500} ta="center">
								No image available
							</Text>
						</Paper>
					</Grid.Col>
				)}
			</Grid>
		</Box>
	);
}

function PropertiesSection(props: {
	border: string;
	properties: ReturnType<typeof getEntityDetailProperties>;
}) {
	if (props.properties.length === 0) {
		return (
			<Paper p="lg" withBorder radius="sm">
				<Stack gap="xs">
					<Text fw={600} size="sm">
						No properties defined
					</Text>
					<Text c="dimmed" size="sm">
						This entity schema has no properties configured yet.
					</Text>
				</Stack>
			</Paper>
		);
	}

	return (
		<Paper p="lg" withBorder radius="sm">
			<Stack gap="md">
				<Box pb="sm" style={{ borderBottom: `1px solid ${props.border}` }}>
					<Text
						fw={600}
						size="md"
						style={{ fontFamily: '"Space Grotesk", sans-serif' }}
					>
						Properties
					</Text>
					<Text c="dimmed" size="sm">
						Schema-defined values for this entity
					</Text>
				</Box>

				<Grid>
					{props.properties.map((property) => (
						<Grid.Col key={property.key} span={{ base: 12, sm: 6 }}>
							<Stack gap={4}>
								<Text
									size="xs"
									tt="uppercase"
									c="dimmed"
									fw={600}
									style={{
										fontFamily: '"Space Grotesk", sans-serif',
										letterSpacing: "0.5px",
									}}
								>
									{property.label}
								</Text>
								<Text
									size="sm"
									style={{
										wordBreak: "break-word",
										fontFamily:
											property.type === "number" || property.type === "integer"
												? '"IBM Plex Mono", monospace'
												: undefined,
									}}
								>
									{property.value}
								</Text>
							</Stack>
						</Grid.Col>
					))}
				</Grid>
			</Stack>
		</Paper>
	);
}

function EventTimeline(props: {
	border: string;
	entity: AppEntity;
	trackerSlug: string;
	surfaceHover: string;
	trackerColor: { base: string; muted: string };
	eventSchemas: AppEventSchema[];
	onLogEvent: () => void;
}) {
	const eventsQuery = useEventsQuery(props.entity.id);
	const events = eventsQuery.events;

	if (eventsQuery.isLoading) {
		return (
			<Paper p="lg" withBorder radius="sm">
				<Center py="xl">
					<Loader size="md" />
				</Center>
			</Paper>
		);
	}

	if (eventsQuery.isError) {
		return (
			<Paper p="lg" withBorder radius="sm">
				<Stack gap="md">
					<Text c="red" size="sm">
						Failed to load activity timeline.
					</Text>
					<Button
						size="xs"
						variant="light"
						onClick={() => eventsQuery.refetch()}
					>
						Retry
					</Button>
				</Stack>
			</Paper>
		);
	}

	return (
		<Paper p="lg" withBorder radius="sm">
			<Stack gap="md">
				<Group justify="space-between" align="flex-start">
					<Box>
						<Text
							fw={600}
							size="md"
							style={{ fontFamily: '"Space Grotesk", sans-serif' }}
						>
							Activity Timeline
						</Text>
						<Text c="dimmed" size="sm">
							{events.length}{" "}
							{events.length === 1 ? "event logged" : "events logged"}
						</Text>
					</Box>
					<Button size="xs" variant="light" onClick={props.onLogEvent}>
						Log Event
					</Button>
				</Group>

				{events.length === 0 ? (
					<Paper p="xl" withBorder radius="sm">
						<Stack gap="xs" align="center">
							<Text fw={600} size="sm">
								No events yet
							</Text>
							<Text c="dimmed" size="sm" ta="center">
								Start tracking by logging your first event for this entity.
							</Text>
							<Button
								size="sm"
								mt="sm"
								variant="light"
								color="accent"
								onClick={props.onLogEvent}
							>
								Log First Event
							</Button>
						</Stack>
					</Paper>
				) : (
					<Stack gap={0}>
						{events.map((event, idx) => (
							<Box
								key={event.id}
								p="md"
								onMouseEnter={(e) => {
									e.currentTarget.style.backgroundColor = props.surfaceHover;
								}}
								onMouseLeave={(e) => {
									e.currentTarget.style.backgroundColor = "";
								}}
								style={{
									borderLeft: `3px solid ${props.trackerColor.base}`,
									borderBottom:
										idx < events.length - 1
											? `1px solid ${props.border}`
											: "none",
									transition: "background-color 0.15s ease",
								}}
							>
								<Stack gap={6}>
									<Group
										justify="space-between"
										align="flex-start"
										wrap="nowrap"
									>
										<Text
											fw={600}
											size="sm"
											style={{ fontFamily: '"Space Grotesk", sans-serif' }}
										>
											{event.eventSchemaName}
										</Text>
										<Text size="xs" c="dimmed" style={{ whiteSpace: "nowrap" }}>
											{event.occurredAt.toLocaleDateString(undefined, {
												year: "numeric",
												month: "short",
												day: "numeric",
											})}
										</Text>
									</Group>

									{Object.keys(event.properties).length > 0 && (
										<Code block style={{ fontSize: "0.75rem" }}>
											{Object.entries(event.properties)
												.map(([key, value]) => {
													if (typeof value === "boolean")
														return `${key}: ${value ? "Yes" : "No"}`;
													if (typeof value === "number")
														return `${key}: ${value}`;
													if (typeof value === "string")
														return `${key}: ${value}`;
													return null;
												})
												.filter((v): v is string => v !== null)
												.join("\n")}
										</Code>
									)}
								</Stack>
							</Box>
						))}
					</Stack>
				)}
			</Stack>
		</Paper>
	);
}

function Sidebar(props: {
	entity: AppEntity;
	schemaName: string;
	eventCount: number;
	onLogEvent: () => void;
}) {
	return (
		<Stack gap="md">
			<Paper p="md" withBorder radius="sm">
				<Stack gap="md">
					<Text
						fw={600}
						size="sm"
						style={{ fontFamily: '"Space Grotesk", sans-serif' }}
					>
						Quick Facts
					</Text>

					<Stack gap="sm">
						<Group gap="xs">
							<Hash size={14} strokeWidth={2} />
							<Text size="xs" c="dimmed">
								Entity ID
							</Text>
						</Group>
						<Text
							size="xs"
							style={{
								fontFamily: '"IBM Plex Mono", monospace',
								wordBreak: "break-all",
							}}
						>
							{props.entity.id}
						</Text>
					</Stack>

					<Box
						h={1}
						style={{
							backgroundColor: "var(--mantine-color-default-border)",
						}}
					/>

					<Stack gap="xs">
						<Text size="xs" c="dimmed">
							Schema
						</Text>
						<Text size="sm" fw={500}>
							{props.schemaName}
						</Text>
					</Stack>

					<Stack gap="xs">
						<Text size="xs" c="dimmed">
							Events Logged
						</Text>
						<Text
							size="lg"
							fw={600}
							style={{ fontFamily: '"Space Grotesk", sans-serif' }}
						>
							{props.eventCount}
						</Text>
					</Stack>

					<Stack gap="xs">
						<Text size="xs" c="dimmed">
							Last Updated
						</Text>
						<Text size="sm">
							{props.entity.updatedAt.toLocaleDateString(undefined, {
								year: "numeric",
								month: "short",
								day: "numeric",
							})}
						</Text>
					</Stack>
				</Stack>
			</Paper>

			<Button
				fullWidth
				variant="light"
				color="accent"
				onClick={props.onLogEvent}
			>
				Log Event
			</Button>
		</Stack>
	);
}

function RouteComponent() {
	const { entityId, trackerSlug } = Route.useParams();
	const computedColorScheme = useColorScheme();
	const trackersQuery = useTrackersQuery();
	const entityQuery = useEntityQuery(entityId);
	const tracker = trackersQuery.trackerBySlug(trackerSlug);
	const entitySchemasQuery = useEntitySchemasQuery(
		tracker?.id ?? "",
		!!tracker && !tracker.isBuiltin,
	);
	const entitySchema = entityQuery.entity
		? entitySchemasQuery.entitySchemas.find(
				(schema) => schema.id === entityQuery.entity?.entitySchemaId,
			)
		: undefined;
	const eventSchemasQuery = useEventSchemasQuery(
		entityQuery.entity?.entitySchemaId ?? "",
		!!entityQuery.entity,
	);
	const eventsQuery = useEventsQuery(
		entityQuery.entity?.id ?? "",
		!!entityQuery.entity,
	);
	const eventMutations = useEventMutations(entityQuery.entity?.id ?? "");
	const [opened, { close, open }] = useDisclosure(false);
	const [createErrorMessage, setCreateErrorMessage] = useState<string | null>(
		null,
	);

	const isDark = computedColorScheme === "dark";
	const border = isDark
		? "var(--mantine-color-dark-6)"
		: "var(--mantine-color-stone-3)";
	const surfaceHover = isDark
		? "var(--mantine-color-dark-7)"
		: "var(--mantine-color-stone-1)";

	const openLogEventModal = useCallback(() => {
		setCreateErrorMessage(null);
		open();
	}, [open]);

	const closeLogEventModal = useCallback(() => {
		setCreateErrorMessage(null);
		close();
	}, [close]);

	const submitCreateEvent = useCallback(
		async (payload: CreateEventPayload) => {
			setCreateErrorMessage(null);
			try {
				await eventMutations.create.mutateAsync({ body: payload });
				closeLogEventModal();
			} catch (error) {
				const message =
					error instanceof Error
						? error.message
						: "Failed to log event. Please try again.";
				setCreateErrorMessage(message);
			}
		},
		[closeLogEventModal, eventMutations.create],
	);

	if (
		trackersQuery.isLoading ||
		entityQuery.isLoading ||
		(!!tracker && !tracker.isBuiltin && entitySchemasQuery.isLoading)
	)
		return <LoadingState />;

	if (trackersQuery.isError)
		return (
			<ErrorState
				title="Failed to load tracker"
				onRetry={() => trackersQuery.refetch()}
				description="We could not load tracking trackers right now."
			/>
		);

	if (entityQuery.isError)
		return (
			<ErrorState
				title="Failed to load entity"
				onRetry={() => entityQuery.refetch()}
				description="We could not load this tracked entity right now."
			/>
		);

	if (!tracker || tracker.isBuiltin)
		return (
			<ErrorState
				title="Entity not found"
				description={`The custom tracker "${trackerSlug}" is not available.`}
			/>
		);

	if (entitySchemasQuery.isError)
		return (
			<ErrorState
				title="Failed to load schema"
				onRetry={() => entitySchemasQuery.refetch()}
				description="We could not load the schema for this tracked entity."
			/>
		);

	if (!entityQuery.entity || !entitySchema)
		return (
			<ErrorState
				title="Entity not found"
				description="This entity does not exist in the selected custom tracker."
			/>
		);

	const properties = getEntityDetailProperties(
		entitySchema.propertiesSchema,
		entityQuery.entity.properties,
	);
	const trackerColor = getTrackerColor(trackerSlug);

	return (
		<Box py={{ base: "lg", md: "xl" }} px={{ base: "md", md: "xl" }}>
			<Box maw={1200} mx="auto">
				<IdentityHeader
					border={border}
					entity={entityQuery.entity}
					trackerName={tracker.name}
					trackerSlug={trackerSlug}
					schemaName={entitySchema.name}
					trackerColor={trackerColor}
				/>

				<Grid>
					<Grid.Col span={{ base: 12, md: 8 }}>
						<Stack gap="lg">
							<PropertiesSection border={border} properties={properties} />

							<EventTimeline
								border={border}
								entity={entityQuery.entity}
								trackerSlug={trackerSlug}
								surfaceHover={surfaceHover}
								trackerColor={trackerColor}
								eventSchemas={eventSchemasQuery.eventSchemas}
								onLogEvent={openLogEventModal}
							/>
						</Stack>
					</Grid.Col>

					<Grid.Col span={{ base: 12, md: 4 }}>
						<Sidebar
							entity={entityQuery.entity}
							schemaName={entitySchema.name}
							eventCount={eventsQuery.events.length}
							onLogEvent={openLogEventModal}
						/>
					</Grid.Col>
				</Grid>

				{opened && entityQuery.entity && (
					<LogEventModal
						opened={opened}
						entity={entityQuery.entity}
						onSubmit={submitCreateEvent}
						onClose={closeLogEventModal}
						eventSchemas={eventSchemasQuery.eventSchemas}
						errorMessage={createErrorMessage}
						isLoading={eventMutations.create.isPending}
					/>
				)}
			</Box>
		</Box>
	);
}
