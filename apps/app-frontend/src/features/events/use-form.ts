import { isEqual } from "@ryot/ts-utils";
import { useEffect, useMemo } from "react";
import { useAppForm } from "#/hooks/forms";
import type { AppEventSchema } from "../event-schemas/model";
import {
	buildCreateEventFormSchema,
	buildDefaultEventFormValues,
	type CreateEventPayload,
	getEventFormReconciliationState,
	syncCreateEventFormValues,
	toCreateEventPayload,
} from "./form";

type UseCreateEventFormProps = {
	entityId: string;
	eventSchemas: AppEventSchema[];
	onSubmit: (payload: CreateEventPayload) => Promise<void>;
};

export function useCreateEventForm(props: UseCreateEventFormProps) {
	const form = useAppForm({
		defaultValues: buildDefaultEventFormValues(props.eventSchemas),
		validators: {
			onChange: buildCreateEventFormSchema(props.eventSchemas),
		},
		onSubmit: async ({ value }) => {
			await props.onSubmit(
				toCreateEventPayload(value, props.entityId, props.eventSchemas),
			);
		},
	});
	const reconciliationState = useMemo(
		() =>
			getEventFormReconciliationState(
				props.eventSchemas,
				form.state.values.eventSchemaId,
			),
		[props.eventSchemas, form.state.values.eventSchemaId],
	);

	useEffect(() => {
		const nextValues = syncCreateEventFormValues(
			props.eventSchemas,
			form.state.values,
		);

		if (form.state.values.eventSchemaId !== nextValues.eventSchemaId)
			form.setFieldValue("eventSchemaId", nextValues.eventSchemaId);

		if (!isEqual(form.state.values.properties, nextValues.properties))
			form.setFieldValue("properties", nextValues.properties);
	}, [form, props.eventSchemas, reconciliationState]);

	return form;
}

export type CreateEventForm = ReturnType<typeof useCreateEventForm>;
