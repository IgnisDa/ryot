import { sql } from "drizzle-orm";
import { match } from "ts-pattern";
import type { EntitySchemaPropertiesShape } from "../entity-schemas/service";
import { ViewRuntimeValidationError } from "./errors";
import { type PropertyType, parseFieldPath } from "./schema-introspection";

export type SqlExpression = ReturnType<typeof sql>;

export type ViewRuntimeSchemaLike = {
	slug: string;
	propertiesSchema: EntitySchemaPropertiesShape;
};

export type RuntimeRef =
	| { type: "top-level"; column: string }
	| { type: "schema-property"; slug: string; property: string };

export const resolveRuntimeReference = (
	reference: string,
	defaultSchemaSlug: string,
): RuntimeRef => {
	try {
		if (reference.startsWith("@")) {
			return parseFieldPath(reference);
		}
		if (reference.includes(".")) {
			return parseFieldPath(reference);
		}
	} catch (error) {
		throw new ViewRuntimeValidationError(
			error instanceof Error ? error.message : "Invalid field reference",
		);
	}

	return {
		property: reference,
		type: "schema-property",
		slug: defaultSchemaSlug,
	};
};

export const getSchemaForReference = <TSchema extends ViewRuntimeSchemaLike>(
	schemaMap: Map<string, TSchema>,
	reference: Extract<RuntimeRef, { type: "schema-property" }>,
) => {
	const foundSchema = schemaMap.get(reference.slug);
	if (!foundSchema) {
		throw new ViewRuntimeValidationError(
			`Schema '${reference.slug}' is not part of this runtime request`,
		);
	}

	return foundSchema;
};

export const buildCastedValueExpression = (
	propertyType: PropertyType,
	input: {
		propertyText: SqlExpression;
		propertyJson: SqlExpression;
	},
) =>
	match(propertyType)
		.with("integer", () => sql`(${input.propertyText})::integer`)
		.with("number", () => sql`(${input.propertyText})::numeric`)
		.with("boolean", () => sql`(${input.propertyText})::boolean`)
		.with("date", () => sql`(${input.propertyText})::timestamp`)
		.with("array", "object", () => input.propertyJson)
		.otherwise(() => input.propertyText);

export const buildCoalescedExpression = (expressions: SqlExpression[]) => {
	if (expressions.length === 1) {
		return expressions[0] ?? sql`null`;
	}

	return sql`coalesce(${sql.join(expressions, sql`, `)})`;
};
