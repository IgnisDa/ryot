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
} from "@mantine/core";
import { useMemo } from "react";

import { FormError } from "~/components/PageStates";
import { SectionHeader } from "~/components/SectionHeader";
import type { AppEntity } from "~/features/entities/model";
import { GeneratedPropertyField } from "~/features/generated-property-fields";
import { createFormSubmitHandler } from "~/hooks/forms";
import { useModalForm } from "~/hooks/modal-form";

import type { AppEventSchema } from "../event-schemas/model";
import {
	buildEventSchemaSelectionPatch,
	type CreateEventPayload,
	getSelectedEventSchema,
	getUnsupportedRequiredEventProperties,
	getUnsupportedRequiredPropertiesMessage,
} from "./form";
import { useEventMutations, useEventsQuery } from "./hooks";
import { getEventListViewState } from "./model";
import { useCreateEventForm } from "./use-form";

function formatEventPropertyValue(value: unknown) {
	if (typeof value === "boolean") {
		return value ? "Yes" : "No";
	}
	if (typeof value === "number") {
		return value.toString();
	}
	if (typeof value === "string") {
		return value;
	}
	return null;
}

function EventList(props: {
	eventLimit?: number;
	events: ReturnType<typeof useEventsQuery>["events"];
}) {
	const eventLimit = props.eventLimit ?? 3;
	const recentEvents = props.events.slice(0, eventLimit);
	const hasMoreEvents = props.events.length > recentEvents.length;

	return (
		<Stack gap="xs">
			{recentEvents.map((event) => {
				const properties = Object.entries(event.properties)
					.map(([key, value]) => {
						const formattedValue = formatEventPropertyValue(value);
						if (formattedValue === null) {
							return null;
						}
						return `${key}: ${formattedValue}`;
					})
					.filter((value): value is string => !!value);

				return (
					<Paper p="xs" withBorder radius="md" bg="gray.0" key={event.id}>
						<Stack gap={4}>
							<Group justify="space-between" align="flex-start">
								<Text fw={500} size="sm">
									{event.eventSchemaName}
								</Text>
								<Text c="dimmed" size="xs">
									{event.createdAt.toLocaleString()}
								</Text>
							</Group>
							{properties.length > 0 && <Code block>{properties.join("\n")}</Code>}
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
	const eventSchemaOptions = props.eventSchemas.map((eventSchema) => ({
		value: eventSchema.id,
		label: eventSchema.name,
	}));

	return (
		<eventForm.Subscribe selector={(state) => state.values.eventSchemaId}>
			{(eventSchemaId) => {
				const selectedEventSchema = getSelectedEventSchema(props.eventSchemas, eventSchemaId);
				const unsupportedRequiredProperties = getUnsupportedRequiredEventProperties(
					selectedEventSchema?.propertiesSchema ?? { fields: {} },
				);
				const hasUnsupportedRequiredProperties = unsupportedRequiredProperties.length > 0;

				if (!selectedEventSchema) {
					return (
						<Paper p="sm" withBorder radius="md">
							<Text c="dimmed" size="sm">
								No event schemas available for this entity.
							</Text>
						</Paper>
					);
				}

				const propertyFields = Object.entries(selectedEventSchema.propertiesSchema.fields)
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
					<form onSubmit={createFormSubmitHandler(eventForm.handleSubmit)}>
						<eventForm.AppForm>
							<Stack gap="md">
								<FormError message={props.errorMessage} />

								{hasUnsupportedRequiredProperties && (
									<FormError
										message={getUnsupportedRequiredPropertiesMessage(unsupportedRequiredProperties)}
									/>
								)}

								<eventForm.AppField
									name="eventSchemaId"
									listeners={{
										onChange: ({ value }) => {
											const nextValues = buildEventSchemaSelectionPatch(
												props.eventSchemas,
												eventForm.state.values,
												value,
											);
											eventForm.setFieldValue("properties", nextValues.properties);
											if (nextValues.eventSchemaId !== value) {
												eventForm.setFieldValue("eventSchemaId", nextValues.eventSchemaId);
											}
										},
									}}
								>
									{(field) => (
										<Select
											required
											label="Event schema"
											data={eventSchemaOptions}
											onBlur={field.handleBlur}
											disabled={props.isLoading}
											value={field.state.value || null}
											onChange={(value) =>
												field.handleChange(value ?? props.eventSchemas[0]?.id ?? "")
											}
										/>
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
			}}
		</eventForm.Subscribe>
	);
}

export function LogEventModal(props: {
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
	title?: string;
	entity: AppEntity;
	eventLimit?: number;
	description?: string;
	eventSchemasError: boolean;
	eventSchemasLoading: boolean;
	eventSchemas: AppEventSchema[];
}) {
	const eventsQuery = useEventsQuery(props.entity.id);
	const eventMutations = useEventMutations(props.entity.id);
	const viewState = getEventListViewState(eventsQuery.events);
	const canLogEvent =
		!props.eventSchemasError && !props.eventSchemasLoading && props.eventSchemas.length > 0;
	const logEventButtonLabel = props.eventSchemasLoading
		? "Loading schemas..."
		: props.eventSchemas.length > 0
			? "Log event"
			: "Add event schema first";

	const eventAvailabilityMessage = useMemo(() => {
		if (props.eventSchemasLoading) {
			return null;
		}
		if (props.eventSchemasError) {
			return "Event schemas failed to load.";
		}
		if (props.eventSchemas.length === 0) {
			return "Add an event schema to start logging.";
		}
		return null;
	}, [props.eventSchemas.length, props.eventSchemasError, props.eventSchemasLoading]);

	const logEventModal = useModalForm((payload: CreateEventPayload) =>
		eventMutations.create.mutateAsync({ body: payload }),
	);

	return (
		<Stack gap="sm">
			<SectionHeader
				title={props.title ?? "EVENTS"}
				description={props.description ?? "Recent logged events for this entity."}
				action={{
					disabled: !canLogEvent,
					label: logEventButtonLabel,
					onClick: logEventModal.open,
				}}
			/>

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
						<FormError message="Failed to load events." />
						<Group>
							<Button size="xs" variant="light" onClick={() => eventsQuery.refetch()}>
								Retry
							</Button>
						</Group>
					</Stack>
				</Paper>
			)}

			{!eventsQuery.isLoading &&
				!eventsQuery.isError &&
				(viewState.type === "empty" ? (
					<Paper p="sm" withBorder radius="md" bg="gray.0">
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
					<EventList events={viewState.events} eventLimit={props.eventLimit} />
				))}

			{logEventModal.opened && (
				<LogEventModal
					entity={props.entity}
					opened={logEventModal.opened}
					onClose={logEventModal.close}
					onSubmit={logEventModal.submit}
					eventSchemas={props.eventSchemas}
					errorMessage={logEventModal.errorMessage}
					isLoading={eventMutations.create.isPending}
				/>
			)}
		</Stack>
	);
}
