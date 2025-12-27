import { Autocomplete } from "@mantine/core";
import type { AppEntitySchema } from "#/features/entity-schemas/model";

const BUILTIN_PATHS_WITH_IMAGE = [
	"@name",
	"@image",
	"@createdAt",
	"@updatedAt",
];
const BUILTIN_PATHS_WITHOUT_IMAGE = ["@name", "@createdAt", "@updatedAt"];

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

	const builtinPaths = props.excludeImage
		? BUILTIN_PATHS_WITHOUT_IMAGE
		: BUILTIN_PATHS_WITH_IMAGE;

	const schemaGroups = props.schemas
		.map((schema) => {
			const items = Object.keys(schema.propertiesSchema.fields).map(
				(key) => `${schema.slug}.${key}`,
			);
			return { group: schema.slug, items };
		})
		.filter((group) => group.items.length > 0);

	const data = [...schemaGroups, { group: "Built-in", items: builtinPaths }];

	return (
		<Autocomplete
			data={data}
			label={props.label}
			error={props.error}
			onBlur={props.onBlur}
			value={props.value ?? ""}
			required={props.required}
			disabled={props.disabled || isEmpty}
			onChange={props.onChange}
			placeholder={
				isEmpty ? "Add entity schemas first" : (props.placeholder ?? "")
			}
		/>
	);
}
