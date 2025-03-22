import { Box, Grid, Stack } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { createFileRoute } from "@tanstack/react-router";
import color from "color";
import { useCallback, useState } from "react";
import { ErrorState, LoadingState } from "#/components/PageStates";
import { getEntityDetailProperties } from "#/features/entities/detail";
import {
	EntityDetailEventTimeline,
	EntityDetailIdentityHeader,
	EntityDetailPropertiesSection,
	EntityDetailSidebar,
} from "#/features/entities/detail-page";
import { useEntityQuery } from "#/features/entities/hooks";
import { useEntitySchemaQuery } from "#/features/entity-schemas/hooks";
import { useEventSchemasQuery } from "#/features/event-schemas/hooks";
import type { CreateEventPayload } from "#/features/events/form";
import { useEventMutations, useEventsQuery } from "#/features/events/hooks";
import { LogEventModal } from "#/features/events/section";
import { useTrackersQuery } from "#/features/trackers/hooks";
import { useColorScheme } from "#/hooks/theme";

export const Route = createFileRoute("/_protected/entities/$entityId")({
	component: RouteComponent,
});

function RouteComponent() {
	const { entityId } = Route.useParams();
	const trackersQuery = useTrackersQuery();
	const computedColorScheme = useColorScheme();
	const entityQuery = useEntityQuery(entityId);
	const entitySchema = useEntitySchemaQuery(
		entityQuery.entity?.entitySchemaId ?? "",
		!!entityQuery.entity,
	);
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

	if (trackersQuery.isLoading || entityQuery.isLoading) {
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

	if (!entityQuery.entity || !entitySchema.entitySchema) {
		return (
			<ErrorState
				title="Entity not found"
				description="This entity does not exist in the selected custom tracker."
			/>
		);
	}

	const properties = getEntityDetailProperties(
		entitySchema.entitySchema.propertiesSchema,
		entityQuery.entity.properties,
	);

	const entitySchemaColor = {
		base: entitySchema.entitySchema.accentColor,
		muted: color(entitySchema.entitySchema.accentColor).lighten(0.12).hex(),
	};

	return (
		<Box py={{ base: "lg", md: "xl" }} px={{ base: "md", md: "xl" }}>
			<Box maw={1200} mx="auto">
				<EntityDetailIdentityHeader
					border={border}
					entity={entityQuery.entity}
					entitySchemaColor={entitySchemaColor}
					schemaName={entitySchema.entitySchema.name}
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
								onLogEvent={openLogEventModal}
								entitySchemaColor={entitySchemaColor}
							/>
						</Stack>
					</Grid.Col>

					<Grid.Col span={{ base: 12, md: 4 }}>
						<EntityDetailSidebar
							entity={entityQuery.entity}
							onLogEvent={openLogEventModal}
							eventCount={eventsQuery.events.length}
							schemaName={entitySchema.entitySchema.name}
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
