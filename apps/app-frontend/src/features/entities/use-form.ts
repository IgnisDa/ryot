import type { AppSchema } from "@ryot/ts-utils";

import { useAppForm } from "~/hooks/forms";

import {
	buildCreateEntityFormSchema,
	buildDefaultEntityFormValues,
	type CreateEntityPayload,
	toCreateEntityPayload,
} from "./form";

type UseCreateEntityFormProps = {
	entitySchemaId: string;
	propertiesSchema: AppSchema;
	onSubmit: (payload: CreateEntityPayload) => Promise<void>;
};

export function useCreateEntityForm(props: UseCreateEntityFormProps) {
	return useAppForm({
		defaultValues: buildDefaultEntityFormValues(props.propertiesSchema),
		validators: {
			onChange: buildCreateEntityFormSchema(props.propertiesSchema) as never,
		},
		onSubmit: async ({ value }) => {
			await props.onSubmit(
				toCreateEntityPayload(value, props.entitySchemaId, props.propertiesSchema),
			);
		},
	});
}

export type CreateEntityForm = ReturnType<typeof useCreateEntityForm>;
