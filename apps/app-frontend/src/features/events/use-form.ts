import { useAppForm } from "~/hooks/forms";
import type { AppEventSchema } from "../event-schemas/model";
import {
	buildCreateEventFormSchema,
	buildDefaultEventFormValues,
	type CreateEventPayload,
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

	return form;
}

export type CreateEventForm = ReturnType<typeof useCreateEventForm>;
