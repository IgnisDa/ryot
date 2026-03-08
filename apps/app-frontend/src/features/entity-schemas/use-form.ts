import { usePropertySchemaForm } from "../property-schemas/use-form";
import {
	type CreateEntitySchemaPayload,
	toCreateEntitySchemaPayload,
} from "./form";

type UseCreateEntitySchemaFormProps = {
	facetId: string;
	onSubmit: (payload: CreateEntitySchemaPayload) => Promise<void>;
};

export function useCreateEntitySchemaForm(
	props: UseCreateEntitySchemaFormProps,
) {
	return usePropertySchemaForm({
		onSubmit: props.onSubmit,
		toPayload: (value) => toCreateEntitySchemaPayload(value, props.facetId),
	});
}

export type CreateEntitySchemaForm = ReturnType<
	typeof useCreateEntitySchemaForm
>;
