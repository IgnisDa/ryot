import {
	Button,
	Center,
	Group,
	Loader,
	Modal,
	Paper,
	Stack,
	Text,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { useCallback, useState } from "react";
import type { AppEntitySchema } from "#/features/entity-schemas/model";
import { useEventSchemasQuery } from "#/features/event-schemas/hooks";
import { EntityEventsSection } from "#/features/events/section";
import { GeneratedPropertyField } from "#/features/generated-property-fields";
import type { CreateEntityPayload } from "./form";
import { useEntitiesQuery, useEntityMutations } from "./hooks";
import { getEntityListViewState } from "./model";
import { useCreateEntityForm } from "./use-form";

function getErrorMessage(error: unknown) {
	if (error instanceof Error && error.message) return error.message;

	const parsed = error as {
		message?: string;
		error?: { message?: string };
	};

	return (
		parsed?.error?.message ??
		parsed?.message ??
		"Failed to create entity. Please try again."
	);
}

function EntityList(props: {
	entities: ReturnType<typeof useEntitiesQuery>["entities"];
	eventSchemas: ReturnType<typeof useEventSchemasQuery>["eventSchemas"];
	eventSchemasError: boolean;
	eventSchemasLoading: boolean;
}) {
	return (
		<Stack gap="xs">
			{props.entities.map((entity) => (
				<Paper
					p="sm"
					withBorder
					radius="md"
					key={entity.id}
					style={{ backgroundColor: "var(--mantine-color-gray-0)" }}
				>
					<Stack gap="md">
						<Group justify="space-between" align="flex-start">
							<Stack gap={2}>
								<Text fw={500}>{entity.name}</Text>
								<Text c="dimmed" size="xs">
									{new Date(entity.createdAt).toLocaleDateString()}
								</Text>
							</Stack>
						</Group>

						<EntityEventsSection
							entity={entity}
							eventSchemas={props.eventSchemas}
							eventSchemasError={props.eventSchemasError}
							eventSchemasLoading={props.eventSchemasLoading}
						/>
					</Stack>
				</Paper>
			))}
		</Stack>
	);
}
function CreateEntityModal(props: {
	opened: boolean;
	isLoading: boolean;
	onClose: () => void;
	entitySchema: AppEntitySchema;
	errorMessage: string | null;
	onSubmit: (payload: CreateEntityPayload) => Promise<void>;
}) {
	const entityForm = useCreateEntityForm({
		entitySchemaId: props.entitySchema.id,
		propertiesSchema: props.entitySchema.propertiesSchema,
		onSubmit: props.onSubmit,
	});

	const propertyFields = Object.entries(
		props.entitySchema.propertiesSchema,
	).map(([propertyKey, propertyDef]) => (
		<GeneratedPropertyField
			form={entityForm}
			key={propertyKey}
			propertyKey={propertyKey}
			propertyDef={propertyDef}
			disabled={props.isLoading}
			options={{ fallback: "text" }}
		/>
	));

	return (
		<Modal
			centered
			size="lg"
			opened={props.opened}
			onClose={props.onClose}
			title={`Add ${props.entitySchema.name}`}
			overlayProps={{ backgroundOpacity: 0.55, blur: 3 }}
		>
			<form
				onSubmit={(event) => {
					event.preventDefault();
					event.stopPropagation();
					void entityForm.handleSubmit();
				}}
			>
				<entityForm.AppForm>
					<Stack gap="md">
						{props.errorMessage && (
							<Text c="red" size="sm">
								{props.errorMessage}
							</Text>
						)}

						<entityForm.AppField name="name">
							{(field) => (
								<field.TextField
									required
									label="Name"
									disabled={props.isLoading}
									placeholder={`Enter ${props.entitySchema.name.toLowerCase()} name`}
								/>
							)}
						</entityForm.AppField>

						{propertyFields}

						<Group justify="flex-end" gap="md">
							<Button
								type="button"
								variant="subtle"
								onClick={props.onClose}
								disabled={props.isLoading}
							>
								Cancel
							</Button>
							<entityForm.SubmitButton
								disabled={props.isLoading}
								pendingLabel="Creating..."
								label={`Create ${props.entitySchema.name.toLowerCase()}`}
							/>
						</Group>
					</Stack>
				</entityForm.AppForm>
			</form>
		</Modal>
	);
}

export function EntitiesSection(props: { entitySchema: AppEntitySchema }) {
	const [opened, { close, open }] = useDisclosure(false);
	const [createErrorMessage, setCreateErrorMessage] = useState<string | null>(
		null,
	);
	const entitiesQuery = useEntitiesQuery(props.entitySchema.id);
	const eventSchemasQuery = useEventSchemasQuery(props.entitySchema.id);
	const entityMutations = useEntityMutations(props.entitySchema.id);
	const viewState = getEntityListViewState(entitiesQuery.entities);

	const openCreateModal = useCallback(() => {
		setCreateErrorMessage(null);
		open();
	}, [open]);

	const closeCreateModal = useCallback(() => {
		setCreateErrorMessage(null);
		close();
	}, [close]);

	const submitCreateEntity = useCallback(
		async (payload: CreateEntityPayload) => {
			setCreateErrorMessage(null);

			try {
				await entityMutations.create.mutateAsync({ body: payload });
				closeCreateModal();
			} catch (error) {
				setCreateErrorMessage(getErrorMessage(error));
			}
		},
		[closeCreateModal, entityMutations.create],
	);

	return (
		<Stack gap="sm">
			<Group justify="space-between" align="flex-end">
				<Stack gap={2}>
					<Text size="sm" fw={500} c="dimmed">
						ENTITIES
					</Text>
					<Text c="dimmed" size="sm">
						Tracked instances of this schema.
					</Text>
				</Stack>
				<Button size="xs" variant="light" onClick={openCreateModal}>
					Add {props.entitySchema.name.toLowerCase()}
				</Button>
			</Group>

			{createErrorMessage && !opened && (
				<Text c="red" size="sm">
					{createErrorMessage}
				</Text>
			)}

			{entitiesQuery.isLoading && (
				<Center py="sm">
					<Loader size="sm" />
				</Center>
			)}

			{entitiesQuery.isError && (
				<Paper p="sm" withBorder radius="md">
					<Stack gap="xs">
						<Text c="red" size="sm">
							Failed to load entities.
						</Text>
						<Group>
							<Button
								size="xs"
								variant="light"
								onClick={() => entitiesQuery.refetch()}
							>
								Retry
							</Button>
						</Group>
					</Stack>
				</Paper>
			)}

			{!entitiesQuery.isLoading &&
				!entitiesQuery.isError &&
				(viewState.type === "empty" ? (
					<Paper
						p="sm"
						withBorder
						radius="md"
						style={{ backgroundColor: "var(--mantine-color-gray-0)" }}
					>
						<Stack gap={2}>
							<Text fw={500} size="sm">
								No {props.entitySchema.name.toLowerCase()}s yet
							</Text>
							<Text c="dimmed" size="sm">
								Add one to start tracking.
							</Text>
						</Stack>
					</Paper>
				) : (
					<EntityList
						entities={viewState.entities}
						eventSchemas={eventSchemasQuery.eventSchemas}
						eventSchemasError={eventSchemasQuery.isError}
						eventSchemasLoading={eventSchemasQuery.isLoading}
					/>
				))}

			{opened && (
				<CreateEntityModal
					opened={opened}
					onClose={closeCreateModal}
					onSubmit={submitCreateEntity}
					entitySchema={props.entitySchema}
					errorMessage={createErrorMessage}
					isLoading={entityMutations.create.isPending}
				/>
			)}
		</Stack>
	);
}
