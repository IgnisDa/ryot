import { usePropertySchemaForm } from "../property-schemas/use-form";
import {
	type CreateEventSchemaPayload,
	toCreateEventSchemaPayload,
} from "./form";

type UseCreateEventSchemaFormProps = {
	entitySchemaId: string;
	onSubmit: (payload: CreateEventSchemaPayload) => Promise<void>;
};

export function useCreateEventSchemaForm(props: UseCreateEventSchemaFormProps) {
	return usePropertySchemaForm({
		onSubmit: props.onSubmit,
		toPayload: (value) =>
			toCreateEventSchemaPayload(value, props.entitySchemaId),
	});
}

export type CreateEventSchemaForm = ReturnType<typeof useCreateEventSchemaForm>;
