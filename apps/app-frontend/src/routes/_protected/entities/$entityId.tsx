import { Box, Grid, Stack } from "@mantine/core";
import { createFileRoute } from "@tanstack/react-router";
import { ErrorState, LoadingState } from "~/components/PageStates";
import { getEntityDetailProperties } from "~/features/entities/detail";
import {
	EntityDetailEventTimeline,
	EntityDetailIdentityHeader,
	EntityDetailPropertiesSection,
	EntityDetailSidebar,
} from "~/features/entities/detail-page";
import { useEntityQuery } from "~/features/entities/hooks";
import { useEntitySchemaQuery } from "~/features/entity-schemas/hooks";
import { useEventSchemasQuery } from "~/features/event-schemas/hooks";
import type { CreateEventPayload } from "~/features/events/form";
import { useEventMutations, useEventsQuery } from "~/features/events/hooks";
import { LogEventModal } from "~/features/events/section";
import { useTrackersQuery } from "~/features/trackers/hooks";
import { useModalForm } from "~/hooks/modal-form";
import { useThemeTokens } from "~/hooks/theme";
import { getAccentMuted } from "~/lib/theme";

export const Route = createFileRoute("/_protected/entities/$entityId")({
	component: RouteComponent,
});

function RouteComponent() {
	const { entityId } = Route.useParams();
	const trackersQuery = useTrackersQuery();
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
	const logEventModal = useModalForm((payload: CreateEventPayload) =>
		eventMutations.create.mutateAsync({ body: payload }),
	);

	const { border, surfaceHover } = useThemeTokens();

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
		muted: getAccentMuted(entitySchema.entitySchema.accentColor, 12),
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
								onLogEvent={logEventModal.open}
								entitySchemaColor={entitySchemaColor}
							/>
						</Stack>
					</Grid.Col>

					<Grid.Col span={{ base: 12, md: 4 }}>
						<EntityDetailSidebar
							entity={entityQuery.entity}
							onLogEvent={logEventModal.open}
							eventCount={eventsQuery.events.length}
							schemaName={entitySchema.entitySchema.name}
						/>
					</Grid.Col>
				</Grid>

				{logEventModal.opened && entityQuery.entity && (
					<LogEventModal
						entity={entityQuery.entity}
						opened={logEventModal.opened}
						onClose={logEventModal.close}
						onSubmit={logEventModal.submit}
						errorMessage={logEventModal.errorMessage}
						isLoading={eventMutations.create.isPending}
						eventSchemas={eventSchemasQuery.eventSchemas}
					/>
				)}
			</Box>
		</Box>
	);
}
