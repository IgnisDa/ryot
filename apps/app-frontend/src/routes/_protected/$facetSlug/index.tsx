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
import { CreateEntityModal } from "#/features/entities/section";
import { EntitySchemaCreateModal } from "#/features/entity-schemas/create-modal";
import type { CreateEntitySchemaPayload } from "#/features/entity-schemas/form";
import {
	useEntitySchemaMutations,
	useEntitySchemasQuery,
} from "#/features/entity-schemas/hooks";
import { getFacetEntitySchemaViewState } from "#/features/entity-schemas/model";
import type { CreateEventSchemaPayload } from "#/features/event-schemas/form";
import { useEventSchemaMutations } from "#/features/event-schemas/hooks";
import { CreateEventSchemaModal } from "#/features/event-schemas/section";
import { useFacetsQuery } from "#/features/facets/hooks";
import { FacetIcon } from "#/features/facets/icons";
import type { AppFacet } from "#/features/facets/model";
import { SetupGuidedFlow } from "#/features/facets/setup-guided-flow";
import { TrackerOverview } from "#/features/facets/tracker-overview";

export const Route = createFileRoute("/_protected/$facetSlug/")({
	component: RouteComponent,
});

function getErrorMessage(error: unknown) {
	if (error instanceof Error && error.message) return error.message;

	const parsed = error as {
		message?: string;
		error?: { message?: string };
	};

	return (
		parsed?.error?.message ??
		parsed?.message ??
		"Failed to create schema. Please try again."
	);
}

function FacetHeader(props: { facet: AppFacet }) {
	return (
		<Box>
			<Flex gap="md" align="flex-start">
				{props.facet.icon && (
					<Box w={48} h={48} style={{ display: "grid", placeItems: "center" }}>
						<FacetIcon icon={props.facet.icon} size={32} />
					</Box>
				)}
				<Stack gap={4} flex={1}>
					<Title order={1}>{props.facet.name}</Title>
					{props.facet.description && (
						<Text c="dimmed" size="sm">
							{props.facet.description}
						</Text>
					)}
				</Stack>
			</Flex>
		</Box>
	);
}

function FacetMetadata(props: { facet: AppFacet }) {
	return (
		<>
			{props.facet.isBuiltin && (
				<Box>
					<Text size="sm" fw={500} c="dimmed" mb={8}>
						TYPE
					</Text>
					<Text>Built-in</Text>
				</Box>
			)}
		</>
	);
}

function BuiltinFacetSchemaSection() {
	return (
		<Paper
			p="lg"
			withBorder
			radius="md"
			style={{ backgroundColor: "var(--mantine-color-gray-0)" }}
		>
			<Stack gap="xs">
				<Text fw={600}>
					Schema management is only available for custom facets.
				</Text>
				<Text c="dimmed" size="sm">
					Built-in trackers use product-defined fields, so this page stays
					read-only.
				</Text>
			</Stack>
		</Paper>
	);
}

function CustomFacetSchemaSection(props: { facet: AppFacet }) {
	const [openedModal, setOpenedModal] = useState<
		"entity-schema" | "event-schema" | "entity" | null
	>(null);
	const [createErrorMessage, setCreateErrorMessage] = useState<string | null>(
		null,
	);

	const entitySchemasQuery = useEntitySchemasQuery(
		props.facet.id,
		!props.facet.isBuiltin,
	);
	const entitySchemaMutations = useEntitySchemaMutations(props.facet.id);

	const primaryEntitySchema = entitySchemasQuery.entitySchemas[0];
	const eventSchemaMutations = useEventSchemaMutations(
		primaryEntitySchema?.id ?? "",
	);
	const entityMutations = useEntityMutations(primaryEntitySchema?.id ?? "");

	const viewState = getFacetEntitySchemaViewState({
		facet: props.facet,
		entitySchemas: entitySchemasQuery.entitySchemas,
	});

	const openEntitySchemaModal = useCallback(() => {
		setCreateErrorMessage(null);
		setOpenedModal("entity-schema");
	}, []);

	const closeEntitySchemaModal = useCallback(() => {
		setCreateErrorMessage(null);
		setOpenedModal(null);
	}, []);

	const openEventSchemaModal = useCallback(() => {
		setOpenedModal("event-schema");
	}, []);

	const closeEventSchemaModal = useCallback(() => {
		setOpenedModal(null);
	}, []);

	const openEntityModal = useCallback(() => {
		setOpenedModal("entity");
	}, []);

	const closeEntityModal = useCallback(() => {
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

	if (entitySchemasQuery.isLoading)
		return (
			<Center py="xl">
				<Loader size="sm" />
			</Center>
		);

	if (entitySchemasQuery.isError)
		return (
			<Paper p="lg" withBorder radius="md">
				<Stack gap="sm">
					<Text c="red" size="sm">
						Failed to load schemas for this facet.
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

	return (
		<Stack gap="md">
			{createErrorMessage && openedModal === null && (
				<Text c="red" size="sm">
					{createErrorMessage}
				</Text>
			)}

			{viewState.type === "empty" && (
				<SetupGuidedFlow
					facet={props.facet}
					onOpenCreateEntityModal={openEntityModal}
					entitySchemas={entitySchemasQuery.entitySchemas}
					onOpenCreateEventSchemaModal={openEventSchemaModal}
					onOpenCreateEntitySchemaModal={openEntitySchemaModal}
				/>
			)}

			{viewState.type === "list" && (
				<TrackerOverview
					facetSlug={props.facet.slug}
					entitySchemas={viewState.entitySchemas}
					onAddEntitySchema={openEntitySchemaModal}
				/>
			)}

			{openedModal === "entity-schema" && (
				<EntitySchemaCreateModal
					facetId={props.facet.id}
					onSubmit={submitCreateSchema}
					onClose={closeEntitySchemaModal}
					errorMessage={createErrorMessage}
					opened={openedModal === "entity-schema"}
					isLoading={entitySchemaMutations.create.isPending}
				/>
			)}

			{openedModal === "event-schema" && primaryEntitySchema && (
				<CreateEventSchemaModal
					onClose={closeEventSchemaModal}
					errorMessage={createErrorMessage}
					onSubmit={submitCreateEventSchema}
					opened={openedModal === "event-schema"}
					entitySchemaId={primaryEntitySchema.id}
					isLoading={eventSchemaMutations.create.isPending}
				/>
			)}

			{openedModal === "entity" && primaryEntitySchema && (
				<CreateEntityModal
					onClose={closeEntityModal}
					onSubmit={submitCreateEntity}
					opened={openedModal === "entity"}
					errorMessage={createErrorMessage}
					entitySchema={primaryEntitySchema}
					isLoading={entityMutations.create.isPending}
				/>
			)}
		</Stack>
	);
}

function RouteComponent() {
	const facetsQuery = useFacetsQuery();
	const { facetSlug } = Route.useParams();

	const facet = facetsQuery.facetBySlug(facetSlug);

	if (facetsQuery.isLoading)
		return (
			<Center h="100vh">
				<Loader size="lg" />
			</Center>
		);

	if (facetsQuery.isError)
		return (
			<Container size="md" py={80}>
				<Stack align="center" gap="lg">
					<Title order={1}>Failed to load facet</Title>
					<Text c="dimmed" size="lg">
						We could not load tracking facets right now.
					</Text>
					<Button variant="light" onClick={() => facetsQuery.refetch()}>
						Retry
					</Button>
				</Stack>
			</Container>
		);

	if (!facet)
		return (
			<Container size="md" py={80}>
				<Stack align="center" gap="lg">
					<Title order={1}>Facet not found</Title>
					<Text c="dimmed" size="lg">
						The facet "{facetSlug}" does not exist or is not enabled.
					</Text>
				</Stack>
			</Container>
		);

	return (
		<Container size="md" py={56}>
			<Stack gap="xl">
				<FacetHeader facet={facet} />
				<FacetMetadata facet={facet} />

				{facet.isBuiltin ? (
					<BuiltinFacetSchemaSection />
				) : (
					<CustomFacetSchemaSection facet={facet} />
				)}
			</Stack>
		</Container>
	);
}
