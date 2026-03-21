import {
	Box,
	Button,
	Center,
	Container,
	Flex,
	Group,
	Loader,
	Paper,
	Stack,
	Text,
	Title,
} from "@mantine/core";
import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useState } from "react";
import type { CreateEntityPayload } from "#/features/entities/form";
import { useEntityMutations } from "#/features/entities/hooks";
import type { AppEntity } from "#/features/entities/model";
import { CreateEntityModal } from "#/features/entities/section";
import { EntitySchemaCreateModal } from "#/features/entity-schemas/create-modal";
import type { CreateEntitySchemaPayload } from "#/features/entity-schemas/form";
import {
	useEntitySchemaMutations,
	useEntitySchemasQuery,
} from "#/features/entity-schemas/hooks";
import { getTrackerEntitySchemaViewState } from "#/features/entity-schemas/model";
import type { CreateEventSchemaPayload } from "#/features/event-schemas/form";
import {
	useEventSchemaMutations,
	useEventSchemasQuery,
} from "#/features/event-schemas/hooks";
import { CreateEventSchemaModal } from "#/features/event-schemas/section";
import type { CreateEventPayload } from "#/features/events/form";
import { useEventMutations } from "#/features/events/hooks";
import { LogEventModal } from "#/features/events/section";
import { useTrackersQuery } from "#/features/trackers/hooks";
import { TrackerIcon } from "#/features/trackers/icons";
import type { AppTracker } from "#/features/trackers/model";
import { SetupGuidedFlow } from "#/features/trackers/setup-guided-flow";
import { TrackerOverview } from "#/features/trackers/tracker-overview";
import { getErrorMessage } from "#/lib/errors";

export const Route = createFileRoute("/_protected/$trackerSlug/")({
	component: RouteComponent,
});

function TrackerHeader(props: { tracker: AppTracker }) {
	return (
		<Box>
			<Flex gap="md" align="flex-start">
				{props.tracker.icon && (
					<Box w={48} h={48} style={{ display: "grid", placeItems: "center" }}>
						<TrackerIcon icon={props.tracker.icon} size={32} />
					</Box>
				)}
				<Stack gap="xs" flex={1}>
					<Title order={1}>{props.tracker.name}</Title>
					{props.tracker.description && (
						<Text c="dimmed" size="sm">
							{props.tracker.description}
						</Text>
					)}
				</Stack>
			</Flex>
		</Box>
	);
}

function TrackerMetadata(props: { tracker: AppTracker }) {
	return (
		<>
			{props.tracker.isBuiltin && (
				<Box>
					<Text size="sm" fw={500} c="dimmed" mb="xs">
						TYPE
					</Text>
					<Text>Built-in</Text>
				</Box>
			)}
		</>
	);
}

function BuiltinTrackerSchemaSection() {
	return (
		<Paper p="lg" withBorder radius="md" bg="gray.0">
			<Stack gap="xs">
				<Text fw={600}>
					Schema management is only available for custom trackers.
				</Text>
				<Text c="dimmed" size="sm">
					Built-in trackers use product-defined fields, so this page stays
					read-only.
				</Text>
			</Stack>
		</Paper>
	);
}

type CustomTrackerModalState =
	| null
	| { type: "entity-schema" }
	| { type: "event"; entity: AppEntity }
	| { type: "entity"; entitySchemaId: string }
	| { type: "event-schema"; entitySchemaId: string };

function CustomTrackerSchemaSection(props: { tracker: AppTracker }) {
	const [openedModal, setOpenedModal] = useState<CustomTrackerModalState>(null);
	const [createErrorMessage, setCreateErrorMessage] = useState<string | null>(
		null,
	);

	const entitySchemasQuery = useEntitySchemasQuery(
		props.tracker.id,
		!props.tracker.isBuiltin,
	);
	const entitySchemaMutations = useEntitySchemaMutations(props.tracker.id);

	const primaryEntitySchema = entitySchemasQuery.entitySchemas[0];
	const selectedEntitySchema =
		openedModal?.type === "entity" || openedModal?.type === "event-schema"
			? entitySchemasQuery.entitySchemas.find(
					(schema) => schema.id === openedModal.entitySchemaId,
				)
			: undefined;
	const selectedEntity =
		openedModal?.type === "event" ? openedModal.entity : undefined;
	const eventSchemaMutations = useEventSchemaMutations(
		selectedEntitySchema?.id ?? "",
	);
	const entityMutations = useEntityMutations(selectedEntitySchema?.slug ?? "");
	const eventMutations = useEventMutations(selectedEntity?.id ?? "");
	const selectedEventSchemasQuery = useEventSchemasQuery(
		selectedEntity?.entitySchemaId ?? "",
		!!selectedEntity,
	);

	const viewState = getTrackerEntitySchemaViewState({
		tracker: props.tracker,
		entitySchemas: entitySchemasQuery.entitySchemas,
	});

	const openEntitySchemaModal = useCallback(() => {
		setCreateErrorMessage(null);
		setOpenedModal({ type: "entity-schema" });
	}, []);

	const closeEntitySchemaModal = useCallback(() => {
		setCreateErrorMessage(null);
		setOpenedModal(null);
	}, []);

	const openEventSchemaModal = useCallback(
		(entitySchemaId?: string) => {
			const nextEntitySchemaId = entitySchemaId ?? primaryEntitySchema?.id;
			if (!nextEntitySchemaId) {
				return;
			}
			setOpenedModal({
				type: "event-schema",
				entitySchemaId: nextEntitySchemaId,
			});
		},
		[primaryEntitySchema?.id],
	);

	const closeEventSchemaModal = useCallback(() => {
		setOpenedModal(null);
	}, []);

	const openEntityModal = useCallback(
		(entitySchemaId?: string) => {
			const nextEntitySchemaId = entitySchemaId ?? primaryEntitySchema?.id;
			if (!nextEntitySchemaId) {
				return;
			}
			setOpenedModal({ type: "entity", entitySchemaId: nextEntitySchemaId });
		},
		[primaryEntitySchema?.id],
	);

	const closeEntityModal = useCallback(() => {
		setOpenedModal(null);
	}, []);

	const openLogEventModal = useCallback((entity: AppEntity) => {
		setCreateErrorMessage(null);
		setOpenedModal({ type: "event", entity });
	}, []);

	const closeLogEventModal = useCallback(() => {
		setCreateErrorMessage(null);
		setOpenedModal(null);
	}, []);

	const submitCreateSchema = useCallback(
		async (payload: CreateEntitySchemaPayload) => {
			setCreateErrorMessage(null);

			try {
				await entitySchemaMutations.create.mutateAsync({ body: payload });
				closeEntitySchemaModal();
			} catch (error) {
				setCreateErrorMessage(getErrorMessage(error));
			}
		},
		[closeEntitySchemaModal, entitySchemaMutations.create],
	);

	const submitCreateEventSchema = useCallback(
		async (payload: CreateEventSchemaPayload) => {
			setCreateErrorMessage(null);

			try {
				await eventSchemaMutations.create.mutateAsync({ body: payload });
				closeEventSchemaModal();
			} catch (error) {
				setCreateErrorMessage(getErrorMessage(error));
			}
		},
		[closeEventSchemaModal, eventSchemaMutations.create],
	);

	const submitCreateEntity = useCallback(
		async (payload: CreateEntityPayload) => {
			setCreateErrorMessage(null);

			try {
				await entityMutations.create.mutateAsync({ body: payload });
				closeEntityModal();
			} catch (error) {
				setCreateErrorMessage(getErrorMessage(error));
			}
		},
		[closeEntityModal, entityMutations.create],
	);

	const submitCreateEvent = useCallback(
		async (payload: CreateEventPayload) => {
			setCreateErrorMessage(null);

			try {
				await eventMutations.create.mutateAsync({ body: payload });
				closeLogEventModal();
			} catch (error) {
				setCreateErrorMessage(getErrorMessage(error));
			}
		},
		[closeLogEventModal, eventMutations.create],
	);

	if (entitySchemasQuery.isLoading) {
		return (
			<Center py="xl">
				<Loader size="sm" />
			</Center>
		);
	}

	if (entitySchemasQuery.isError) {
		return (
			<Paper p="lg" withBorder radius="md">
				<Stack gap="sm">
					<Text c="red" size="sm">
						We couldn't load the schemas for this tracker. Please try again.
					</Text>
					<Group>
						<Button
							size="xs"
							variant="light"
							onClick={() => entitySchemasQuery.refetch()}
						>
							Retry
						</Button>
					</Group>
				</Stack>
			</Paper>
		);
	}

	return (
		<Stack gap="md">
			{createErrorMessage && openedModal === null && (
				<Text c="red" size="sm">
					{createErrorMessage}
				</Text>
			)}

			{viewState.type === "empty" && (
				<Stack gap="xl">
					<TrackerHeader tracker={props.tracker} />
					<SetupGuidedFlow
						tracker={props.tracker}
						entitySchemas={entitySchemasQuery.entitySchemas}
						onOpenCreateEntityModal={() => openEntityModal()}
						onOpenCreateEntitySchemaModal={openEntitySchemaModal}
						onOpenCreateEventSchemaModal={() => openEventSchemaModal()}
					/>
				</Stack>
			)}

			{viewState.type === "list" && (
				<TrackerOverview
					tracker={props.tracker}
					onAddEntity={openEntityModal}
					onLogEvent={openLogEventModal}
					onAddEventSchema={openEventSchemaModal}
					entitySchemas={viewState.entitySchemas}
					onAddEntitySchema={openEntitySchemaModal}
				/>
			)}

			{openedModal?.type === "entity-schema" && (
				<EntitySchemaCreateModal
					trackerId={props.tracker.id}
					onSubmit={submitCreateSchema}
					onClose={closeEntitySchemaModal}
					errorMessage={createErrorMessage}
					opened={openedModal?.type === "entity-schema"}
					isLoading={entitySchemaMutations.create.isPending}
				/>
			)}

			{openedModal?.type === "event-schema" && selectedEntitySchema && (
				<CreateEventSchemaModal
					onClose={closeEventSchemaModal}
					errorMessage={createErrorMessage}
					onSubmit={submitCreateEventSchema}
					entitySchemaId={selectedEntitySchema.id}
					opened={openedModal?.type === "event-schema"}
					isLoading={eventSchemaMutations.create.isPending}
				/>
			)}

			{openedModal?.type === "entity" && selectedEntitySchema && (
				<CreateEntityModal
					onClose={closeEntityModal}
					onSubmit={submitCreateEntity}
					errorMessage={createErrorMessage}
					entitySchema={selectedEntitySchema}
					opened={openedModal?.type === "entity"}
					isLoading={entityMutations.create.isPending}
				/>
			)}

			{openedModal?.type === "event" && selectedEntity && (
				<LogEventModal
					entity={selectedEntity}
					onClose={closeLogEventModal}
					onSubmit={submitCreateEvent}
					errorMessage={createErrorMessage}
					opened={openedModal?.type === "event"}
					isLoading={eventMutations.create.isPending}
					eventSchemas={selectedEventSchemasQuery.eventSchemas}
				/>
			)}
		</Stack>
	);
}

function RouteComponent() {
	const trackersQuery = useTrackersQuery();
	const { trackerSlug } = Route.useParams();

	const tracker = trackersQuery.trackerBySlug(trackerSlug);

	if (trackersQuery.isLoading) {
		return (
			<Center h="100vh">
				<Loader size="lg" />
			</Center>
		);
	}

	if (trackersQuery.isError) {
		return (
			<Container size="md" py={80}>
				<Stack align="center" gap="lg">
					<Title order={1}>Unable to load tracker</Title>
					<Text c="dimmed" size="lg">
						We couldn't load your trackers right now. Please try again.
					</Text>
					<Button variant="light" onClick={() => trackersQuery.refetch()}>
						Retry
					</Button>
				</Stack>
			</Container>
		);
	}

	if (!tracker) {
		return (
			<Container size="md" py={80}>
				<Stack align="center" gap="lg">
					<Title order={1}>Tracker not found</Title>
					<Text c="dimmed" size="lg">
						The tracker "{trackerSlug}" doesn't exist or isn't enabled yet.
					</Text>
				</Stack>
			</Container>
		);
	}

	if (tracker.isBuiltin) {
		return (
			<Container size="md" py={56}>
				<Stack gap="xl">
					<TrackerHeader tracker={tracker} />
					<TrackerMetadata tracker={tracker} />
					<BuiltinTrackerSchemaSection />
				</Stack>
			</Container>
		);
	}

	return (
		<Container size="xl" py={56}>
			<CustomTrackerSchemaSection tracker={tracker} />
		</Container>
	);
}
