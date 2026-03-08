import { PropertySchemasBuilder } from "../property-schemas/properties-builder";
import type { CreateEntitySchemaForm } from "./use-form";

type EntitySchemaPropertiesBuilderProps = {
	form: CreateEntitySchemaForm;
	isLoading: boolean;
};

export function EntitySchemaPropertiesBuilder(
	props: EntitySchemaPropertiesBuilderProps,
) {
	return (
		<PropertySchemasBuilder
			form={props.form}
			placeholder="title"
			isLoading={props.isLoading}
			description="Add each tracked property as a typed field."
		/>
	);
}
