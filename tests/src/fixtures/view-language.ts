import type { paths } from "@ryot/generated/openapi/app-backend";

type CreateSavedViewBody = NonNullable<
	paths["/saved-views"]["post"]["requestBody"]
>["content"]["application/json"];

export type ViewExpression =
	CreateSavedViewBody["queryDefinition"]["sort"]["expression"];
export type ViewPredicate = NonNullable<
	CreateSavedViewBody["queryDefinition"]["filter"]
>;
export type RuntimeRef = Extract<
	ViewExpression,
	{ type: "reference" }
>["reference"];
export type ExpressionInput = ViewExpression | string[];

const entityBuiltinFields = new Set([
	"id",
	"name",
	"image",
	"createdAt",
	"updatedAt",
]);

export const literalExpression = (value: unknown | null): ViewExpression => ({
	value,
	type: "literal",
});

export const entityColumnExpression = (
	slug: string,
	column: string,
): ViewExpression => ({
	type: "reference",
	reference: { type: "entity-column", slug, column },
});

export const schemaPropertyExpression = (
	slug: string,
	property: string,
): ViewExpression => ({
	type: "reference",
	reference: { type: "schema-property", slug, property },
});

export const computedFieldExpression = (key: string): ViewExpression => ({
	type: "reference",
	reference: { type: "computed-field", key },
});

export const entityField = (schemaSlug: string, property: string) => {
	if (entityBuiltinFields.has(property) || property.startsWith("@")) {
		return `entity.${schemaSlug}.${property.startsWith("@") ? property : `@${property}`}`;
	}

	return `entity.${schemaSlug}.${property}`;
};

export const qualifyBuiltinFields = (
	schemaSlugs: string[],
	property: string,
) => {
	return schemaSlugs.map((schemaSlug) => entityField(schemaSlug, property));
};

export const parseReference = (reference: string): RuntimeRef => {
	const [namespace, segment, tail, ...rest] = reference.split(".");
	if (namespace === "computed") {
		if (!segment || tail || rest.length > 0) {
			throw new Error(`Invalid view reference '${reference}'`);
		}

		return { type: "computed-field", key: segment };
	}

	if (namespace === "event") {
		if (!segment || !tail || rest.length > 0) {
			throw new Error(`Invalid view reference '${reference}'`);
		}

		return tail.startsWith("@")
			? { type: "event-join-column", joinKey: segment, column: tail.slice(1) }
			: { type: "event-join-property", joinKey: segment, property: tail };
	}

	if (namespace !== "entity" || !segment || !tail || rest.length > 0) {
		throw new Error(`Invalid view reference '${reference}'`);
	}

	return tail.startsWith("@")
		? { type: "entity-column", slug: segment, column: tail.slice(1) }
		: { type: "schema-property", slug: segment, property: tail };
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
		reference: parseReference(reference),
	}));

	return values.length === 1
		? (values[0] ?? literalExpression(null))
		: { values, type: "coalesce" };
};

export const toRequiredExpression = (input: ExpressionInput | null) => {
	return toExpression(input) ?? literalExpression(null);
};
