import { useRef } from "react";
import { useAppForm } from "~/hooks/forms";
import { createNameFieldListeners } from "~/lib/slug-sync";
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
	const form = useAppForm({
		defaultValues: buildPropertySchemaFormValues(),
		validators: { onChange: createPropertySchemaFormSchema },
		onSubmit: async ({ value }) => {
			await props.onSubmit(props.toPayload(value));
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
