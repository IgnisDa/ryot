import { useRef } from "react";

import { useAppForm } from "~/hooks/forms";
import { createNameFieldListeners } from "~/lib/slug-sync";

import {
	buildEntitySchemaFormValues,
	type CreateEntitySchemaPayload,
	createEntitySchemaFormSchema,
	toCreateEntitySchemaPayload,
} from "./form";

type UseCreateEntitySchemaFormProps = {
	trackerId: string;
	onSubmit: (payload: CreateEntitySchemaPayload) => Promise<void>;
};

export function useCreateEntitySchemaForm(props: UseCreateEntitySchemaFormProps) {
	const form = useAppForm({
		defaultValues: buildEntitySchemaFormValues(),
		validators: { onChange: createEntitySchemaFormSchema },
		onSubmit: async ({ value }) => {
			await props.onSubmit(toCreateEntitySchemaPayload(value, props.trackerId));
		},
	});
	const previousDerivedSlug = useRef("");

	return Object.assign(form, {
		nameFieldListeners: createNameFieldListeners({
			form,
			previousDerivedSlug,
		}),
	});
}

export type CreateEntitySchemaForm = ReturnType<typeof useCreateEntitySchemaForm>;
