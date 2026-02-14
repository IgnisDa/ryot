import type { paths } from "@ryot/generated/openapi/app-backend";
import {
	type EventAggregation,
	entityBuiltinColumns,
	eventJoinBuiltinColumns,
	type RuntimeRef,
} from "@ryot/ts-utils";

type CreateSavedViewBody = NonNullable<
	paths["/saved-views"]["post"]["requestBody"]
>["content"]["application/json"];

export type ViewExpression =
	CreateSavedViewBody["queryDefinition"]["sort"]["expression"];
export type ViewPredicate = NonNullable<
	CreateSavedViewBody["queryDefinition"]["filter"]
>;
export type ExpressionInput = ViewExpression | string[];

export const literalExpression = (value: unknown | null): ViewExpression => ({
	value,
	type: "literal",
});

export const parseFieldPath = (field: string): RuntimeRef => {
	const [namespace, segment, tail, ...rest] = field.split(".");

	if (namespace === "computed") {
		if (!segment || tail !== undefined || rest.length > 0) {
			throw new Error(`Invalid field path: ${field}`);
		}

		return { key: segment, type: "computed-field" };
	}

	if (namespace === "event") {
		if (!segment || !tail) {
			throw new Error(`Invalid field path: ${field}`);
		}

		if (tail === "properties") {
			if (rest.length === 0) {
				throw new Error(`Invalid field path: ${field}`);
			}

			return { joinKey: segment, path: [tail, ...rest], type: "event" };
		}

		if (rest.length > 0 || !eventJoinBuiltinColumns.has(tail)) {
			throw new Error(`Invalid field path: ${field}`);
		}

		return { joinKey: segment, path: [tail], type: "event" };
	}

	if (namespace !== "entity" || !segment || !tail) {
		throw new Error(`Invalid field path: ${field}`);
	}

	if (tail === "properties") {
		if (rest.length === 0) {
			throw new Error(`Invalid field path: ${field}`);
		}

		return { slug: segment, path: [tail, ...rest], type: "entity" };
	}

	if (rest.length > 0 || !entityBuiltinColumns.has(tail)) {
		throw new Error(`Invalid field path: ${field}`);
	}

	return { slug: segment, path: [tail], type: "entity" };
};

export const entityField = (schemaSlug: string, property: string) => {
	if (entityBuiltinColumns.has(property)) {
		return `entity.${schemaSlug}.${property}`;
	}

	return `entity.${schemaSlug}.properties.${property}`;
};

export const qualifyBuiltinFields = (
	schemaSlugs: string[],
	property: string,
) => {
	return schemaSlugs.map((schemaSlug) => entityField(schemaSlug, property));
};

export const toExpression = (
	input: ExpressionInput | null,
): ViewExpression | null => {
	if (input === null) {
		return null;
	}

	if (!Array.isArray(input)) {
		return input;
	}

	if (!input.length) {
		return literalExpression(null);
	}

	const values = input.map((reference) => ({
		type: "reference" as const,
		reference: parseFieldPath(reference),
	}));

	return values.length === 1
		? (values[0] ?? literalExpression(null))
		: { values, type: "coalesce" };
};

export const toRequiredExpression = (input: ExpressionInput | null) => {
	return toExpression(input) ?? literalExpression(null);
};
