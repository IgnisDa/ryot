import { Autocomplete } from "@mantine/core";
import type { AppEntitySchema } from "#/features/entity-schemas/model";

const buildEntityBuiltinPaths = (schemaSlug: string, excludeImage: boolean) => {
	const paths = [
		`entity.${schemaSlug}.@name`,
		`entity.${schemaSlug}.@createdAt`,
		`entity.${schemaSlug}.@updatedAt`,
	];

	if (!excludeImage) {
		paths.splice(1, 0, `entity.${schemaSlug}.@image`);
	}

	return paths;
};

type PropertyPathAutocompleteProps = {
	label?: string;
	value?: string;
	required?: boolean;
	disabled?: boolean;
	onBlur?: () => void;
	placeholder?: string;
	excludeImage: boolean;
	error?: boolean | string;
	schemas: AppEntitySchema[];
	onChange?: (value: string) => void;
};

export function PropertyPathAutocomplete(props: PropertyPathAutocompleteProps) {
	const isEmpty = props.schemas.length === 0;

	const schemaGroups = props.schemas
		.map((schema) => {
			const items = [
				...buildEntityBuiltinPaths(schema.slug, props.excludeImage),
				...Object.keys(schema.propertiesSchema.fields).map(
					(key) => `entity.${schema.slug}.${key}`,
				),
			];
			return { group: schema.slug, items };
		})
		.filter((group) => group.items.length > 0);

	const data = schemaGroups;

	return (
		<Autocomplete
			data={data}
			label={props.label}
			error={props.error}
			onBlur={props.onBlur}
			value={props.value ?? ""}
			required={props.required}
			onChange={props.onChange}
			disabled={props.disabled || isEmpty}
			placeholder={
				isEmpty ? "Add entity schemas first" : (props.placeholder ?? "")
			}
		/>
	);
}
