import { isEqual } from "@ryot/ts-utils";
import { useEffect } from "react";
import { useAppForm } from "#/hooks/forms";
import type { AppEventSchema } from "../event-schemas/model";
import {
	buildCreateEventFormSchema,
	buildDefaultEventFormValues,
	type CreateEventPayload,
	getSelectedEventSchema,
	reconcileEventProperties,
	toCreateEventPayload,
} from "./form";

type UseCreateEventFormProps = {
	entityId: string;
	eventSchemas: AppEventSchema[];
	selectedEventSchemaId?: string;
	onSubmit: (payload: CreateEventPayload) => Promise<void>;
};

export function useCreateEventForm(props: UseCreateEventFormProps) {
	const form = useAppForm({
		defaultValues: buildDefaultEventFormValues(
			props.eventSchemas,
			new Date(),
			props.selectedEventSchemaId,
		),
		validators: {
			onChange: buildCreateEventFormSchema(props.eventSchemas),
		},
		onSubmit: async ({ value }) => {
			await props.onSubmit(
				toCreateEventPayload(value, props.entityId, props.eventSchemas),
			);
		},
	});

	useEffect(() => {
		const selectedEventSchema = getSelectedEventSchema(
			props.eventSchemas,
			props.selectedEventSchemaId,
		);
		const nextEventSchemaId = selectedEventSchema?.id ?? "";
		const nextProperties = reconcileEventProperties(
			selectedEventSchema?.propertiesSchema ?? {},
			form.state.values.properties,
		);

		if (form.state.values.eventSchemaId !== nextEventSchemaId)
			form.setFieldValue("eventSchemaId", nextEventSchemaId);

		if (!isEqual(form.state.values.properties, nextProperties))
			form.setFieldValue("properties", nextProperties);
	}, [form, props.eventSchemas, props.selectedEventSchemaId]);

	return form;
}

export type CreateEventForm = ReturnType<typeof useCreateEventForm>;
