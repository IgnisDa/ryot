import {
	Button,
	Center,
	Code,
	Group,
	Loader,
	Modal,
	Paper,
	Stack,
	Text,
} from "@mantine/core";
import { SectionHeader } from "#/components/SectionHeader";
import type { AppEntitySchema } from "#/features/entity-schemas/model";
import { useModalForm } from "#/hooks/modal-form";
import type { CreateEventSchemaPayload } from "./form";
import { useEventSchemaMutations, useEventSchemasQuery } from "./hooks";
import { getEntityEventSchemaViewState } from "./model";
import { EventSchemaPropertiesBuilder } from "./properties-builder";
import { useCreateEventSchemaForm } from "./use-form";

function EventSchemaList(props: {
	eventSchemas: ReturnType<typeof useEventSchemasQuery>["eventSchemas"];
}) {
	return (
		<Stack gap="xs">
			{props.eventSchemas.map((eventSchema) => {
				const propertyCount = Object.keys(
					eventSchema.propertiesSchema.fields,
				).length;

				return (
					<Paper p="sm" withBorder radius="md" key={eventSchema.id}>
						<Group justify="space-between" align="flex-start">
							<Stack gap={2}>
								<Text fw={500}>{eventSchema.name}</Text>
								<Code>{eventSchema.slug}</Code>
							</Stack>
							<Text c="dimmed" size="sm">
								{propertyCount}{" "}
								{propertyCount === 1 ? "property" : "properties"}
							</Text>
						</Group>
					</Paper>
				);
			})}
		</Stack>
	);
}

export function CreateEventSchemaModal(props: {
	opened: boolean;
	isLoading: boolean;
	onClose: () => void;
	entitySchemaId: string;
	errorMessage: string | null;
	onSubmit: (payload: CreateEventSchemaPayload) => Promise<void>;
}) {
	const eventSchemaForm = useCreateEventSchemaForm({
		entitySchemaId: props.entitySchemaId,
		onSubmit: props.onSubmit,
	});

	return (
		<Modal
			centered
			size="lg"
			opened={props.opened}
			onClose={props.onClose}
			title="Add event schema"
			overlayProps={{ backgroundOpacity: 0.55, blur: 3 }}
		>
			<form
				onSubmit={(event) => {
					event.preventDefault();
					event.stopPropagation();
					void eventSchemaForm.handleSubmit();
				}}
			>
				<eventSchemaForm.AppForm>
					<Stack gap="md">
						{props.errorMessage && (
							<Text c="red" size="sm">
								{props.errorMessage}
							</Text>
						)}

						<eventSchemaForm.AppField
							name="name"
							listeners={eventSchemaForm.nameFieldListeners}
						>
							{(field) => (
								<field.TextField
									required
									label="Name"
									disabled={props.isLoading}
									placeholder="Custom event"
								/>
							)}
						</eventSchemaForm.AppField>

						<eventSchemaForm.AppField name="slug">
							{(field) => (
								<field.TextField
									label="Slug"
									disabled={props.isLoading}
									placeholder="custom-event"
								/>
							)}
						</eventSchemaForm.AppField>

						<EventSchemaPropertiesBuilder
							form={eventSchemaForm}
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
							<eventSchemaForm.SubmitButton
								disabled={props.isLoading}
								pendingLabel="Creating..."
								label="Create event schema"
							/>
						</Group>
					</Stack>
				</eventSchemaForm.AppForm>
			</form>
		</Modal>
	);
}

export function EventSchemasSection(props: { entitySchema: AppEntitySchema }) {
	const eventSchemasQuery = useEventSchemasQuery(props.entitySchema.id);
	const eventSchemaMutations = useEventSchemaMutations(props.entitySchema.id);
	const viewState = getEntityEventSchemaViewState(
		eventSchemasQuery.eventSchemas,
	);
	const createModal = useModalForm((payload: CreateEventSchemaPayload) =>
		eventSchemaMutations.create.mutateAsync({ body: payload }),
	);

	return (
		<Stack gap="sm">
			<SectionHeader
				title="EVENT SCHEMAS"
				description="Define the events tracked for this schema."
				action={{ label: "Add event schema", onClick: createModal.open }}
			/>

			{createModal.errorMessage && !createModal.opened && (
				<Text c="red" size="sm">
					{createModal.errorMessage}
				</Text>
			)}

			{eventSchemasQuery.isLoading && (
				<Center py="sm">
					<Loader size="sm" />
				</Center>
			)}

			{eventSchemasQuery.isError && (
				<Paper p="sm" withBorder radius="md">
					<Stack gap="xs">
						<Text c="red" size="sm">
							Failed to load event schemas.
						</Text>
						<Group>
							<Button
								size="xs"
								variant="light"
								onClick={() => eventSchemasQuery.refetch()}
							>
								Retry
							</Button>
						</Group>
					</Stack>
				</Paper>
			)}

			{!eventSchemasQuery.isLoading &&
				!eventSchemasQuery.isError &&
				(viewState.type === "empty" ? (
					<Paper p="sm" withBorder radius="md">
						<Stack gap={2}>
							<Text fw={500} size="sm">
								No event schemas yet
							</Text>
							<Text c="dimmed" size="sm">
								Add one to describe the events recorded for this entity schema.
							</Text>
						</Stack>
					</Paper>
				) : (
					<EventSchemaList eventSchemas={viewState.eventSchemas} />
				))}

			{createModal.opened && (
				<CreateEventSchemaModal
					opened={createModal.opened}
					onClose={createModal.close}
					onSubmit={createModal.submit}
					entitySchemaId={props.entitySchema.id}
					errorMessage={createModal.errorMessage}
					isLoading={eventSchemaMutations.create.isPending}
				/>
			)}
		</Stack>
	);
}
