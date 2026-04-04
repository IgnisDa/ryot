import {
	Anchor,
	Button,
	Center,
	Group,
	Loader,
	Modal,
	Paper,
	Stack,
	Text,
} from "@mantine/core";
import { Link } from "@tanstack/react-router";
import { SectionHeader } from "#/components/SectionHeader";
import type { AppEntitySchema } from "#/features/entity-schemas/model";
import { useEventSchemasQuery } from "#/features/event-schemas/hooks";
import { EntityEventsSection } from "#/features/events/section";
import { GeneratedPropertyField } from "#/features/generated-property-fields";
import { useModalForm } from "#/hooks/modal-form";
import type { CreateEntityPayload } from "./form";
import { useEntitiesQuery, useEntityMutations } from "./hooks";
import { getEntityListViewState } from "./model";
import { useCreateEntityForm } from "./use-form";

function EntityList(props: {
	entities: ReturnType<typeof useEntitiesQuery>["entities"];
	trackerSlug: string;
	eventSchemas: ReturnType<typeof useEventSchemasQuery>["eventSchemas"];
	eventSchemasError: boolean;
	eventSchemasLoading: boolean;
}) {
	return (
		<Stack gap="xs">
			{props.entities.map((entity) => (
				<Paper p="sm" withBorder radius="md" key={entity.id}>
					<Stack gap="md">
						<Group justify="space-between" align="flex-start">
							<Stack gap={2}>
								<Text fw={500}>{entity.name}</Text>
								<Text c="dimmed" size="xs">
									{new Date(entity.createdAt).toLocaleDateString()}
								</Text>
							</Stack>
							<Link to="/entities/$entityId" params={{ entityId: entity.id }}>
								<Anchor component="span" size="sm">
									View details
								</Anchor>
							</Link>
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

export function CreateEntityModal(props: {
	opened: boolean;
	isLoading: boolean;
	onClose: () => void;
	entitySchema: AppEntitySchema;
	errorMessage: string | null;
	onSubmit: (payload: CreateEntityPayload) => Promise<void>;
}) {
	const entityForm = useCreateEntityForm({
		onSubmit: props.onSubmit,
		entitySchemaId: props.entitySchema.id,
		propertiesSchema: props.entitySchema.propertiesSchema,
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

						<entityForm.AppField name="image">
							{(field) => (
								<field.ImageField label="Image" disabled={props.isLoading} />
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

export function EntitiesSection(props: {
	entitySchema: AppEntitySchema;
	trackerSlug: string;
}) {
	const entitiesQuery = useEntitiesQuery(props.entitySchema.slug);
	const eventSchemasQuery = useEventSchemasQuery(props.entitySchema.id);
	const entityMutations = useEntityMutations(props.entitySchema.slug);
	const viewState = getEntityListViewState(entitiesQuery.entities);
	const createModal = useModalForm((payload: CreateEntityPayload) =>
		entityMutations.create.mutateAsync({ body: payload }),
	);

	return (
		<Stack gap="sm">
			<SectionHeader
				title="ENTITIES"
				description="Tracked instances of this schema."
				action={{
					onClick: createModal.open,
					label: `Add ${props.entitySchema.name.toLowerCase()}`,
				}}
			/>

			{createModal.errorMessage && !createModal.opened && (
				<Text c="red" size="sm">
					{createModal.errorMessage}
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
					<Paper p="sm" withBorder radius="md">
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
						trackerSlug={props.trackerSlug}
						eventSchemas={eventSchemasQuery.eventSchemas}
						eventSchemasError={eventSchemasQuery.isError}
						eventSchemasLoading={eventSchemasQuery.isLoading}
					/>
				))}

			{createModal.opened && (
				<CreateEntityModal
					opened={createModal.opened}
					onClose={createModal.close}
					onSubmit={createModal.submit}
					entitySchema={props.entitySchema}
					errorMessage={createModal.errorMessage}
					isLoading={entityMutations.create.isPending}
				/>
			)}
		</Stack>
	);
}
