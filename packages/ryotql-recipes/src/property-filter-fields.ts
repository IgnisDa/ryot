import type { ValueFilterField } from "@ryot-app/contract/modules/filters/schemas";
import type {
	AppChoices,
	AppPropertyDefinition,
	AppSchema,
} from "@ryot-app/contract/schema/property-schema";
import { Result } from "effect";

type PropertyFilterFieldChoice = { readonly field: string; readonly property: string };

const unsupported = (property: string) =>
	Result.fail(new Error(`Property '${property}' cannot back a filter field`));

const staticChoices = (choices: AppChoices, property: string) => {
	if (choices.kind !== "static") {
		return Result.fail(new Error(`Property '${property}' has dynamic choices`));
	}
	const [first, ...rest] = choices.values.map(({ value, label }) => ({
		value,
		label: label ?? value,
	}));
	return first
		? Result.succeed([first, ...rest] as const)
		: Result.fail(new Error(`Property '${property}' has no choices`));
};

const valueFilterField = (
	property: string,
	definition: AppPropertyDefinition,
	field: string,
): Result.Result<ValueFilterField, Error> => {
	const base = { field, key: property, kind: "value", label: definition.label } as const;
	switch (definition.type) {
		case "enum":
		case "enum-array":
			return Result.map(staticChoices(definition.choices, property), (choices) => ({
				...base,
				choices,
				type: definition.type === "enum" ? "enum" : "enum-list",
			}));
		case "number":
		case "integer":
			return Result.succeed({ ...base, type: "number" });
		case "date":
		case "datetime":
			return Result.succeed({ ...base, type: "date" });
		case "boolean":
			return Result.succeed({ ...base, type: "boolean" });
		case "string":
			return Result.succeed({ ...base, type: "text" });
		case "array":
			return definition.items.type === "string"
				? Result.succeed({ ...base, type: "text-list" })
				: unsupported(property);
		case "object":
			break;
	}
	return unsupported(property);
};

export const propertyFilterFields = (
	schema: AppSchema,
	choices: readonly PropertyFilterFieldChoice[],
): Result.Result<readonly ValueFilterField[], Error> =>
	Result.all(
		choices.map(({ field, property }) => {
			const definition = schema.fields[property];
			return definition
				? valueFilterField(property, definition, field)
				: Result.fail(new Error(`Property '${property}' is not declared by the schema`));
		}),
	);
