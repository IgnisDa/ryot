import {
	Box,
	Button,
	Center,
	Code,
	Container,
	Flex,
	Group,
	Loader,
	Modal,
	Paper,
	Stack,
	Text,
	Title,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useState } from "react";
import { EntitiesSection } from "#/features/entities/section";
import type { CreateEntitySchemaPayload } from "#/features/entity-schemas/form";
import {
	useEntitySchemaMutations,
	useEntitySchemasQuery,
} from "#/features/entity-schemas/hooks";
import type { AppEntitySchema } from "#/features/entity-schemas/model";
import { getFacetEntitySchemaViewState } from "#/features/entity-schemas/model";
import { EntitySchemaPropertiesBuilder } from "#/features/entity-schemas/properties-builder";
import { useCreateEntitySchemaForm } from "#/features/entity-schemas/use-form";
import { EventSchemasSection } from "#/features/event-schemas/section";
import { useFacetsQuery } from "#/features/facets/hooks";
import { FacetIcon } from "#/features/facets/icons";
import type { AppFacet } from "#/features/facets/model";

export const Route = createFileRoute("/_protected/tracking/$facetSlug/")({
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
			{props.facet.mode && (
				<Box>
					<Text size="sm" fw={500} c="dimmed" mb={8}>
						MODE
					</Text>
					<Text>{props.facet.mode}</Text>
				</Box>
			)}

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

function EntitySchemaList(props: {
	facet: AppFacet;
	entitySchemas: AppEntitySchema[];
}) {
	return (
		<Stack gap="md">
			{props.entitySchemas.map((entitySchema) => {
				const propertyCount = Object.keys(entitySchema.propertiesSchema).length;

				return (
					<Paper key={entitySchema.id} p="lg" withBorder radius="md">
						<Stack gap="md">
							<Group justify="space-between" align="flex-start">
								<Stack gap={2}>
									<Text fw={600}>{entitySchema.name}</Text>
									<Code>{entitySchema.slug}</Code>
								</Stack>
								<Text c="dimmed" size="sm">
									{propertyCount}{" "}
									{propertyCount === 1 ? "property" : "properties"}
								</Text>
							</Group>

							<EntitiesSection
								entitySchema={entitySchema}
								facetSlug={props.facet.slug}
							/>

							<EventSchemasSection entitySchema={entitySchema} />
						</Stack>
					</Paper>
				);
			})}
		</Stack>
	);
}

function EntitySchemaCreateModal(props: {
	facetId: string;
	opened: boolean;
	isLoading: boolean;
	onClose: () => void;
	errorMessage: string | null;
	onSubmit: (payload: CreateEntitySchemaPayload) => Promise<void>;
}) {
	const entitySchemaForm = useCreateEntitySchemaForm({
		facetId: props.facetId,
		onSubmit: props.onSubmit,
	});

	return (
		<Modal
			centered
			size="lg"
			title="Add schema"
			opened={props.opened}
			onClose={props.onClose}
			overlayProps={{ backgroundOpacity: 0.55, blur: 3 }}
		>
			<form
				onSubmit={(event) => {
					event.preventDefault();
					event.stopPropagation();
					void entitySchemaForm.handleSubmit();
				}}
			>
				<entitySchemaForm.AppForm>
					<Stack gap="md">
						{props.errorMessage && (
							<Text c="red" size="sm">
								{props.errorMessage}
							</Text>
						)}

						<entitySchemaForm.AppField
							name="name"
							listeners={entitySchemaForm.nameFieldListeners}
						>
							{(field) => (
								<field.TextField
									required
									label="Name"
									disabled={props.isLoading}
									placeholder="Custom schema"
								/>
							)}
						</entitySchemaForm.AppField>

						<entitySchemaForm.AppField name="slug">
							{(field) => (
								<field.TextField
									label="Slug"
									disabled={props.isLoading}
									placeholder="custom-schema"
								/>
							)}
						</entitySchemaForm.AppField>

						<EntitySchemaPropertiesBuilder
							form={entitySchemaForm}
							isLoading={props.isLoading}
						/>

						<Group justify="flex-end" gap="md">
							<Button
								type="button"
								variant="subtle"
								onClick={props.onClose}
								disabled={props.isLoading}
							>
								Cancel
							</Button>
							<entitySchemaForm.SubmitButton
								label="Create schema"
								disabled={props.isLoading}
								pendingLabel="Creating..."
							/>
						</Group>
					</Stack>
				</entitySchemaForm.AppForm>
			</form>
		</Modal>
	);
}

function CustomFacetSchemaSection(props: { facet: AppFacet }) {
	const [opened, { close, open }] = useDisclosure(false);
	const [createErrorMessage, setCreateErrorMessage] = useState<string | null>(
		null,
	);
	const entitySchemasQuery = useEntitySchemasQuery(
		props.facet.id,
		!props.facet.isBuiltin,
	);
	const entitySchemaMutations = useEntitySchemaMutations(props.facet.id);

	const openCreateModal = useCallback(() => {
		setCreateErrorMessage(null);
		open();
	}, [open]);

	const closeCreateModal = useCallback(() => {
		setCreateErrorMessage(null);
		close();
	}, [close]);

	const submitCreateSchema = useCallback(
		async (payload: CreateEntitySchemaPayload) => {
			setCreateErrorMessage(null);

			try {
				await entitySchemaMutations.create.mutateAsync({ body: payload });
				closeCreateModal();
			} catch (error) {
				setCreateErrorMessage(getErrorMessage(error));
			}
		},
		[closeCreateModal, entitySchemaMutations.create],
	);

	const viewState = getFacetEntitySchemaViewState({
		facet: props.facet,
		entitySchemas: entitySchemasQuery.entitySchemas,
	});

	return (
		<Stack gap="md">
			<Group justify="space-between" align="flex-end">
				<Stack gap={2}>
					<Text size="sm" fw={500} c="dimmed">
						SCHEMAS
					</Text>
					<Text c="dimmed" size="sm">
						Create schemas to describe the fields tracked for this custom facet.
					</Text>
				</Stack>
				<Button onClick={openCreateModal}>Add schema</Button>
			</Group>

			{createErrorMessage && !opened && (
				<Text c="red" size="sm">
					{createErrorMessage}
				</Text>
			)}

			{entitySchemasQuery.isLoading && (
				<Center py="xl">
					<Loader size="sm" />
				</Center>
			)}

			{entitySchemasQuery.isError && (
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
			)}

			{!entitySchemasQuery.isLoading &&
				!entitySchemasQuery.isError &&
				viewState.type === "empty" && (
					<Paper
						p="xl"
						withBorder
						radius="md"
						style={{ backgroundColor: "var(--mantine-color-gray-0)" }}
					>
						<Stack gap="xs">
							<Text fw={600}>No schemas yet</Text>
							<Text c="dimmed" size="sm">
								Add a schema to define the fields this tracker should capture.
							</Text>
						</Stack>
					</Paper>
				)}

			{!entitySchemasQuery.isLoading &&
				!entitySchemasQuery.isError &&
				viewState.type === "list" && (
					<EntitySchemaList
						facet={props.facet}
						entitySchemas={viewState.entitySchemas}
					/>
				)}

			{opened && (
				<EntitySchemaCreateModal
					opened={opened}
					facetId={props.facet.id}
					onClose={closeCreateModal}
					onSubmit={submitCreateSchema}
					errorMessage={createErrorMessage}
					isLoading={entitySchemaMutations.create.isPending}
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
