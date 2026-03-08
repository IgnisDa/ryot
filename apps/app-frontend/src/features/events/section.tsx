import {
	Button,
	Center,
	Code,
	Group,
	Loader,
	Modal,
	Paper,
	Select,
	Stack,
	Text,
	TextInput,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { useCallback, useMemo, useState } from "react";
import type { AppEntity } from "#/features/entities/model";
import { GeneratedPropertyField } from "#/features/generated-property-fields";
import type { AppEventSchema } from "../event-schemas/model";
import {
	type CreateEventPayload,
	getSelectedEventSchema,
	getUnsupportedRequiredEventProperties,
	getUnsupportedRequiredPropertiesMessage,
} from "./form";
import { useEventMutations, useEventsQuery } from "./hooks";
import { getEventListViewState } from "./model";
import { useCreateEventForm } from "./use-form";

function getErrorMessage(error: unknown) {
	if (error instanceof Error && error.message) return error.message;

	const parsed = error as {
		message?: string;
		error?: { message?: string };
	};

	return (
		parsed?.error?.message ??
		parsed?.message ??
		"Failed to log event. Please try again."
	);
}

function formatEventPropertyValue(value: unknown) {
	if (typeof value === "boolean") return value ? "Yes" : "No";
	if (typeof value === "number") return value.toString();
	if (typeof value === "string") return value;
	return null;
}

function EventList(props: {
	events: ReturnType<typeof useEventsQuery>["events"];
}) {
	const recentEvents = props.events.slice(0, 3);
	const hasMoreEvents = props.events.length > recentEvents.length;

	return (
		<Stack gap="xs">
			{recentEvents.map((event) => {
				const properties = Object.entries(event.properties)
					.map(([key, value]) => {
						const formattedValue = formatEventPropertyValue(value);
						if (formattedValue === null) return null;
						return `${key}: ${formattedValue}`;
					})
					.filter((value): value is string => !!value);

				return (
					<Paper
						p="xs"
						withBorder
						radius="md"
						key={event.id}
						style={{ backgroundColor: "var(--mantine-color-gray-0)" }}
					>
						<Stack gap={4}>
							<Group justify="space-between" align="flex-start">
								<Text fw={500} size="sm">
									{event.eventSchemaName}
								</Text>
								<Text c="dimmed" size="xs">
									{event.occurredAt.toLocaleString()}
								</Text>
							</Group>
							{properties.length > 0 && (
								<Code block>{properties.join("\n")}</Code>
							)}
						</Stack>
					</Paper>
				);
			})}

			{hasMoreEvents && (
				<Text c="dimmed" size="xs">
					Showing {recentEvents.length} of {props.events.length} logged events.
				</Text>
			)}
		</Stack>
	);
}

function LogEventForm(props: {
	entityId: string;
	isLoading: boolean;
	onClose: () => void;
	errorMessage: string | null;
	eventSchemas: AppEventSchema[];
	onSubmit: (payload: CreateEventPayload) => Promise<void>;
}) {
	const eventForm = useCreateEventForm({
		onSubmit: props.onSubmit,
		entityId: props.entityId,
		eventSchemas: props.eventSchemas,
	});
	const selectedEventSchema = getSelectedEventSchema(
		props.eventSchemas,
		eventForm.state.values.eventSchemaId,
	);
	const eventSchemaOptions = props.eventSchemas.map((eventSchema) => ({
		value: eventSchema.id,
		label: eventSchema.name,
	}));
	const unsupportedRequiredProperties = getUnsupportedRequiredEventProperties(
		selectedEventSchema?.propertiesSchema ?? {},
	);
	const hasUnsupportedRequiredProperties =
		unsupportedRequiredProperties.length > 0;

	if (!selectedEventSchema)
		return (
			<Paper p="sm" withBorder radius="md">
				<Text c="dimmed" size="sm">
					No event schemas available for this entity.
				</Text>
			</Paper>
		);

	const propertyFields = Object.entries(selectedEventSchema.propertiesSchema)
		.map(([propertyKey, propertyDef]) => (
			<GeneratedPropertyField
				form={eventForm}
				key={propertyKey}
				propertyKey={propertyKey}
				propertyDef={propertyDef}
				disabled={props.isLoading}
			/>
		))
		.filter(Boolean);

	return (
		<form
			onSubmit={(event) => {
				event.preventDefault();
				event.stopPropagation();
				void eventForm.handleSubmit();
			}}
		>
			<eventForm.AppForm>
				<Stack gap="md">
					{props.errorMessage && (
						<Text c="red" size="sm">
							{props.errorMessage}
						</Text>
					)}

					{hasUnsupportedRequiredProperties && (
						<Text c="red" size="sm">
							{getUnsupportedRequiredPropertiesMessage(
								unsupportedRequiredProperties,
							)}
						</Text>
					)}

					<eventForm.AppField name="eventSchemaId">
						{(field) => (
							<Select
								required
								label="Event schema"
								data={eventSchemaOptions}
								onBlur={field.handleBlur}
								disabled={props.isLoading}
								value={field.state.value || null}
								onChange={(value) => {
									const nextValue = value ?? props.eventSchemas[0]?.id ?? "";
									field.handleChange(nextValue);
								}}
							/>
						)}
					</eventForm.AppField>

					<eventForm.AppField name="occurredAt">
						{(field) => (
							<div>
								<Text component="label" size="sm" fw={500}>
									Occurred at
								</Text>
								<TextInput
									required
									type="datetime-local"
									value={field.state.value}
									onBlur={field.handleBlur}
									disabled={props.isLoading}
									error={!field.state.meta.isValid}
									onChange={(event) =>
										field.handleChange(event.currentTarget.value)
									}
								/>
								{!field.state.meta.isValid && (
									<Text c="red" size="xs">
										{field.state.meta.errors.map((e) => e?.message).join(", ")}
									</Text>
								)}
							</div>
						)}
					</eventForm.AppField>

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
						<eventForm.SubmitButton
							label="Log event"
							pendingLabel="Logging..."
							disabled={props.isLoading || hasUnsupportedRequiredProperties}
						/>
					</Group>
				</Stack>
			</eventForm.AppForm>
		</form>
	);
}

function LogEventModal(props: {
	opened: boolean;
	entity: AppEntity;
	eventSchemas: AppEventSchema[];
	isLoading: boolean;
	onClose: () => void;
	errorMessage: string | null;
	onSubmit: (payload: CreateEventPayload) => Promise<void>;
}) {
	return (
		<Modal
			centered
			size="lg"
			opened={props.opened}
			onClose={props.onClose}
			title={`Log event for ${props.entity.name}`}
			overlayProps={{ backgroundOpacity: 0.55, blur: 3 }}
		>
			<LogEventForm
				onClose={props.onClose}
				onSubmit={props.onSubmit}
				entityId={props.entity.id}
				isLoading={props.isLoading}
				eventSchemas={props.eventSchemas}
				errorMessage={props.errorMessage}
			/>
		</Modal>
	);
}

export function EntityEventsSection(props: {
	entity: AppEntity;
	eventSchemasError: boolean;
	eventSchemasLoading: boolean;
	eventSchemas: AppEventSchema[];
}) {
	const [opened, { close, open }] = useDisclosure(false);
	const [createErrorMessage, setCreateErrorMessage] = useState<string | null>(
		null,
	);
	const eventsQuery = useEventsQuery(props.entity.id);
	const eventMutations = useEventMutations(props.entity.id);
	const viewState = getEventListViewState(eventsQuery.events);
	const canLogEvent =
		!props.eventSchemasError &&
		!props.eventSchemasLoading &&
		props.eventSchemas.length > 0;
	const logEventButtonLabel = props.eventSchemasLoading
		? "Loading schemas..."
		: props.eventSchemas.length > 0
			? "Log event"
			: "Add event schema first";

	const eventAvailabilityMessage = useMemo(() => {
		if (props.eventSchemasLoading) return null;
		if (props.eventSchemasError) return "Event schemas failed to load.";
		if (props.eventSchemas.length === 0)
			return "Add an event schema to start logging.";
		return null;
	}, [
		props.eventSchemas.length,
		props.eventSchemasError,
		props.eventSchemasLoading,
	]);

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
				setCreateErrorMessage(getErrorMessage(error));
			}
		},
		[closeLogEventModal, eventMutations.create],
	);

	return (
		<Stack gap="sm">
			<Group justify="space-between" align="flex-start">
				<Stack gap={2}>
					<Text size="sm" fw={500} c="dimmed">
						EVENTS
					</Text>
					<Text c="dimmed" size="sm">
						Recent logged events for this entity.
					</Text>
				</Stack>
				<Button
					size="xs"
					variant="light"
					disabled={!canLogEvent}
					onClick={openLogEventModal}
				>
					{logEventButtonLabel}
				</Button>
			</Group>

			{eventAvailabilityMessage && (
				<Text c="dimmed" size="xs">
					{eventAvailabilityMessage}
				</Text>
			)}

			{eventsQuery.isLoading && (
				<Center py="sm">
					<Loader size="sm" />
				</Center>
			)}

			{eventsQuery.isError && (
				<Paper p="sm" withBorder radius="md">
					<Stack gap="xs">
						<Text c="red" size="sm">
							Failed to load events.
						</Text>
						<Group>
							<Button
								size="xs"
								variant="light"
								onClick={() => eventsQuery.refetch()}
							>
								Retry
							</Button>
						</Group>
					</Stack>
				</Paper>
			)}

			{!eventsQuery.isLoading &&
				!eventsQuery.isError &&
				(viewState.type === "empty" ? (
					<Paper
						p="sm"
						withBorder
						radius="md"
						style={{ backgroundColor: "var(--mantine-color-gray-0)" }}
					>
						<Stack gap={2}>
							<Text fw={500} size="sm">
								No events yet
							</Text>
							<Text c="dimmed" size="sm">
								Log the first event for this entity.
							</Text>
						</Stack>
					</Paper>
				) : (
					<EventList events={viewState.events} />
				))}

			{opened && (
				<LogEventModal
					opened={opened}
					entity={props.entity}
					onSubmit={submitCreateEvent}
					onClose={closeLogEventModal}
					eventSchemas={props.eventSchemas}
					errorMessage={createErrorMessage}
					isLoading={eventMutations.create.isPending}
				/>
			)}
		</Stack>
	);
}
