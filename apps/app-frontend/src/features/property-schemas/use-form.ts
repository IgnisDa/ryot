import { useAppForm } from "#/hooks/forms";
import {
	buildPropertySchemaFormValues,
	type CreatePropertySchemaFormValues,
	createPropertySchemaFormSchema,
} from "./form";

export type UsePropertySchemaFormProps<TPayload> = {
	onSubmit: (payload: TPayload) => Promise<void>;
	toPayload: (input: CreatePropertySchemaFormValues) => TPayload;
};

export function usePropertySchemaForm<TPayload>(
	props: UsePropertySchemaFormProps<TPayload>,
) {
	return useAppForm({
		defaultValues: buildPropertySchemaFormValues(),
		validators: { onChange: createPropertySchemaFormSchema },
		onSubmit: async ({ value }) => {
			await props.onSubmit(props.toPayload(value));
		},
	});
}
