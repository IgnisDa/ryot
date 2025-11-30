import {
	Box,
	Button,
	Center,
	Grid,
	Loader,
	Stack,
	Text,
	Title,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useState } from "react";
import { getEntityDetailProperties } from "#/features/entities/detail";
import {
	EntityDetailEventTimeline,
	EntityDetailIdentityHeader,
	EntityDetailPropertiesSection,
	EntityDetailSidebar,
} from "#/features/entities/detail-page";
import { useEntityQuery } from "#/features/entities/hooks";
import { useEntitySchemasQuery } from "#/features/entity-schemas/hooks";
import { useEventSchemasQuery } from "#/features/event-schemas/hooks";
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
	) {
		return <LoadingState />;
	}

	if (trackersQuery.isError) {
		return (
			<ErrorState
				title="Failed to load tracker"
				onRetry={() => trackersQuery.refetch()}
				description="We could not load tracking trackers right now."
			/>
		);
	}

	if (entityQuery.isError) {
		return (
			<ErrorState
				title="Failed to load entity"
				onRetry={() => entityQuery.refetch()}
				description="We could not load this tracked entity right now."
			/>
		);
	}

	if (!tracker || tracker.isBuiltin) {
		return (
			<ErrorState
				title="Entity not found"
				description={`The custom tracker "${trackerSlug}" is not available.`}
			/>
		);
	}

	if (entitySchemasQuery.isError) {
		return (
			<ErrorState
				title="Failed to load schema"
				onRetry={() => entitySchemasQuery.refetch()}
				description="We could not load the schema for this tracked entity."
			/>
		);
	}

	if (!entityQuery.entity || !entitySchema) {
		return (
			<ErrorState
				title="Entity not found"
				description="This entity does not exist in the selected custom tracker."
			/>
		);
	}

	const properties = getEntityDetailProperties(
		entitySchema.propertiesSchema,
		entityQuery.entity.properties,
	);
	const trackerColor = getTrackerColor(trackerSlug);

	return (
		<Box py={{ base: "lg", md: "xl" }} px={{ base: "md", md: "xl" }}>
			<Box maw={1200} mx="auto">
				<EntityDetailIdentityHeader
					border={border}
					trackerSlug={trackerSlug}
					trackerName={tracker.name}
					entity={entityQuery.entity}
					trackerColor={trackerColor}
					schemaName={entitySchema.name}
				/>

				<Grid>
					<Grid.Col span={{ base: 12, md: 8 }}>
						<Stack gap="lg">
							<EntityDetailPropertiesSection
								border={border}
								properties={properties}
							/>

							<EntityDetailEventTimeline
								border={border}
								entity={entityQuery.entity}
								surfaceHover={surfaceHover}
								trackerColor={trackerColor}
								onLogEvent={openLogEventModal}
							/>
						</Stack>
					</Grid.Col>

					<Grid.Col span={{ base: 12, md: 4 }}>
						<EntityDetailSidebar
							entity={entityQuery.entity}
							schemaName={entitySchema.name}
							onLogEvent={openLogEventModal}
							eventCount={eventsQuery.events.length}
						/>
					</Grid.Col>
				</Grid>

				{opened && entityQuery.entity && (
					<LogEventModal
						opened={opened}
						entity={entityQuery.entity}
						onSubmit={submitCreateEvent}
						onClose={closeLogEventModal}
						errorMessage={createErrorMessage}
						isLoading={eventMutations.create.isPending}
						eventSchemas={eventSchemasQuery.eventSchemas}
					/>
				)}
			</Box>
		</Box>
	);
}
