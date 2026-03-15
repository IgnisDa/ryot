import { PropertySchemasBuilder } from "../property-schemas/properties-builder";
import type { CreateEventSchemaForm } from "./use-form";

type EventSchemaPropertiesBuilderProps = {
	form: CreateEventSchemaForm;
	isLoading: boolean;
};

export function EventSchemaPropertiesBuilder(
	props: EventSchemaPropertiesBuilderProps,
) {
	return (
		<PropertySchemasBuilder
			form={props.form}
			placeholder="rating"
			isLoading={props.isLoading}
			description="Add each event property as a typed field."
		/>
	);
}
