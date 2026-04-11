import { sql } from "drizzle-orm";
import { match } from "ts-pattern";
import { ViewRuntimeValidationError } from "~/lib/views/errors";
import { getCommonSortPropertyType } from "~/lib/views/policy";
import {
	getPropertyType,
	getSchemaForReference,
	type PropertyType,
	type RuntimeRef,
	resolveRuntimeReference,
	type ViewRuntimeSchemaLike,
} from "~/lib/views/reference";
import {
	buildCastedValueExpression,
	buildCoalescedExpression,
} from "./runtime-reference";

const getTopLevelSortType = (column: string): PropertyType =>
	match(column)
		.with("name", () => "string" as const)
		.with("createdAt", "updatedAt", () => "date" as const)
		.otherwise(() => {
			throw new ViewRuntimeValidationError(
				`Unsupported sort column '@${column}'`,
			);
		});

const buildPropertySortExpression = <
	TSchema extends ViewRuntimeSchemaLike,
>(input: {
	alias: string;
	targetType: PropertyType;
	schemaMap: Map<string, TSchema>;
	reference: Extract<RuntimeRef, { type: "schema-property" }>;
}) => {
	const foundSchema = getSchemaForReference(input.schemaMap, input.reference);
	const propertyType = getPropertyType(foundSchema, input.reference.property);
	if (!propertyType) {
		throw new ViewRuntimeValidationError(
			`Property '${input.reference.property}' not found in schema '${input.reference.slug}'`,
		);
	}

	const propertyText = sql`${sql.raw(input.alias)}.properties ->> ${input.reference.property}`;
	const propertyJson = sql`${sql.raw(input.alias)}.properties -> ${input.reference.property}`;
	const valueExpression = buildCastedValueExpression(input.targetType, {
		propertyJson,
		propertyText,
	});

	if (input.schemaMap.size === 1 && input.reference.slug === foundSchema.slug) {
		return valueExpression;
	}

	return sql`case when ${sql.raw(input.alias)}.entity_schema_slug = ${input.reference.slug} then ${valueExpression} else null end`;
};

const buildTopLevelSortExpression = (input: {
	alias: string;
	column: string;
	targetType: PropertyType;
}) => {
	const expression = match(input.column)
		.with("name", () => sql`${sql.raw(input.alias)}.name`)
		.with("createdAt", () => sql`${sql.raw(input.alias)}.created_at`)
		.with("updatedAt", () => sql`${sql.raw(input.alias)}.updated_at`)
		.otherwise(() => {
			throw new ViewRuntimeValidationError(
				`Unsupported sort column '@${input.column}'`,
			);
		});

	return match(input.targetType)
		.with("date", () => sql`(${expression})::timestamp`)
		.with("number", () => sql`(${expression})::numeric`)
		.with("integer", () => sql`(${expression})::integer`)
		.with("boolean", () => sql`(${expression})::boolean`)
		.with("array", "object", () => sql`to_jsonb(${expression})`)
		.otherwise(() => sql`(${expression})::text`);
};

const getSortExpressionType = <TSchema extends ViewRuntimeSchemaLike>(input: {
	reference: string;
	schemaMap: Map<string, TSchema>;
}) => {
	const parsedReference = resolveRuntimeReference(input.reference);

	if (parsedReference.type === "top-level") {
		return {
			parsedReference,
			propertyType: getTopLevelSortType(parsedReference.column),
		};
	}

	const foundSchema = getSchemaForReference(input.schemaMap, parsedReference);
	const propertyType = getPropertyType(foundSchema, parsedReference.property);
	if (!propertyType) {
		throw new ViewRuntimeValidationError(
			`Property '${parsedReference.property}' not found in schema '${parsedReference.slug}'`,
		);
	}

	return { parsedReference, propertyType };
};

const requireSchemaQualifiedSortFields = (field: string[]) => {
	for (const reference of field) {
		if (reference.startsWith("@") || reference.includes(".")) {
			continue;
		}

		throw new ViewRuntimeValidationError(
			"Schema-qualified property references are required",
		);
	}
};

export const buildSortExpression = <
	TSchema extends ViewRuntimeSchemaLike,
>(input: {
	alias: string;
	field: string[];
	schemaMap: Map<string, TSchema>;
}) => {
	requireSchemaQualifiedSortFields(input.field);

	const resolvedFields = input.field.map((reference) => {
		return getSortExpressionType({
			reference,
			schemaMap: input.schemaMap,
		});
	});
	const targetType = getCommonSortPropertyType(
		resolvedFields.map((field) => field.propertyType),
	);
	const expressions = resolvedFields.map((field) => {
		if (field.parsedReference.type === "top-level") {
			return buildTopLevelSortExpression({
				targetType,
				alias: input.alias,
				column: field.parsedReference.column,
			});
		}

		return buildPropertySortExpression({
			targetType,
			alias: input.alias,
			schemaMap: input.schemaMap,
			reference: field.parsedReference,
		});
	});

	return buildCoalescedExpression(expressions);
};
