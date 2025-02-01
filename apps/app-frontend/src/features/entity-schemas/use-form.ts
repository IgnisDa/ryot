import { useAppForm } from "#/hooks/forms";
import {
	buildEntitySchemaFormValues,
	type CreateEntitySchemaPayload,
	createEntitySchemaFormSchema,
	toCreateEntitySchemaPayload,
} from "./form";

type UseCreateEntitySchemaFormProps = {
	facetId: string;
	onSubmit: (payload: CreateEntitySchemaPayload) => Promise<void>;
};

export function useCreateEntitySchemaForm(
	props: UseCreateEntitySchemaFormProps,
) {
	return useAppForm({
		defaultValues: buildEntitySchemaFormValues(),
		validators: { onChange: createEntitySchemaFormSchema },
		onSubmit: async ({ value }) => {
			await props.onSubmit(toCreateEntitySchemaPayload(value, props.facetId));
		},
	});
}

export type CreateEntitySchemaForm = ReturnType<
	typeof useCreateEntitySchemaForm
>;
