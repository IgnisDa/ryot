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
import { useDisclosure } from "@mantine/hooks";
import { useCallback, useState } from "react";
import type { AppEntitySchema } from "#/features/entity-schemas/model";
import type { CreateEventSchemaPayload } from "./form";
import { useEventSchemaMutations, useEventSchemasQuery } from "./hooks";
import { getEntityEventSchemaViewState } from "./model";
import { EventSchemaPropertiesBuilder } from "./properties-builder";
import { useCreateEventSchemaForm } from "./use-form";

function getErrorMessage(error: unknown) {
	if (error instanceof Error && error.message) {
		return error.message;
	}

	const parsed = error as {
		message?: string;
		error?: { message?: string };
	};

	return (
		parsed?.error?.message ??
		parsed?.message ??
		"Failed to create event schema. Please try again."
	);
}

function EventSchemaList(props: {
	eventSchemas: ReturnType<typeof useEventSchemasQuery>["eventSchemas"];
}) {
	return (
		<Stack gap="xs">
			{props.eventSchemas.map((eventSchema) => {
				const propertyCount = Object.keys(eventSchema.propertiesSchema).length;

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
	const [opened, { close, open }] = useDisclosure(false);
	const [createErrorMessage, setCreateErrorMessage] = useState<string | null>(
		null,
	);
	const eventSchemasQuery = useEventSchemasQuery(props.entitySchema.id);
	const eventSchemaMutations = useEventSchemaMutations(props.entitySchema.id);
	const viewState = getEntityEventSchemaViewState(
		eventSchemasQuery.eventSchemas,
	);

	const openCreateModal = useCallback(() => {
		setCreateErrorMessage(null);
		open();
	}, [open]);

	const closeCreateModal = useCallback(() => {
		setCreateErrorMessage(null);
		close();
	}, [close]);

	const submitCreateSchema = useCallback(
		async (payload: CreateEventSchemaPayload) => {
			setCreateErrorMessage(null);

			try {
				await eventSchemaMutations.create.mutateAsync({ body: payload });
				closeCreateModal();
			} catch (error) {
				setCreateErrorMessage(getErrorMessage(error));
			}
		},
		[closeCreateModal, eventSchemaMutations.create],
	);

	return (
		<Stack gap="sm">
			<Group justify="space-between" align="flex-end">
				<Stack gap={2}>
					<Text size="sm" fw={500} c="dimmed">
						EVENT SCHEMAS
					</Text>
					<Text c="dimmed" size="sm">
						Define the events tracked for this schema.
					</Text>
				</Stack>
				<Button size="xs" variant="light" onClick={openCreateModal}>
					Add event schema
				</Button>
			</Group>

			{createErrorMessage && !opened && (
				<Text c="red" size="sm">
					{createErrorMessage}
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

			{opened && (
				<CreateEventSchemaModal
					opened={opened}
					onClose={closeCreateModal}
					onSubmit={submitCreateSchema}
					errorMessage={createErrorMessage}
					entitySchemaId={props.entitySchema.id}
					isLoading={eventSchemaMutations.create.isPending}
				/>
			)}
		</Stack>
	);
}
