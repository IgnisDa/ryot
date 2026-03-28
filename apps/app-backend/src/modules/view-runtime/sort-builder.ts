import { sql } from "drizzle-orm";
import { match } from "ts-pattern";
import { ViewRuntimeValidationError } from "~/lib/views/errors";
import type { RuntimeRef } from "~/lib/views/expression";
import { getCommonSortPropertyType } from "~/lib/views/policy";
import {
	getEventJoinColumnPropertyType,
	getEventJoinForReference,
	getEventJoinPropertyType,
	getPropertyType,
	getSchemaForReference,
	type PropertyType,
	resolveRuntimeReference,
	type ViewRuntimeEventJoinLike,
	type ViewRuntimeReferenceContext,
	type ViewRuntimeSchemaLike,
} from "~/lib/views/reference";
import {
	buildCastedValueExpression,
	buildCoalescedExpression,
} from "./sql-expression-policy";

const getEventJoinColumnName = (joinKey: string) => `event_join_${joinKey}`;

const buildEventJoinJsonColumnExpression = (alias: string, joinKey: string) => {
	return sql`${sql.raw(`${alias}.${getEventJoinColumnName(joinKey)}`)}`;
};

const getTopLevelSortType = (column: string): PropertyType =>
	match(column)
		.with("id", () => "string" as const)
		.with("name", () => "string" as const)
		.with("createdAt", "updatedAt", () => "date" as const)
		.otherwise(() => {
			throw new ViewRuntimeValidationError(
				`Unsupported entity column '@${column}'`,
			);
		});

const buildPropertySortExpression = <
	TSchema extends ViewRuntimeSchemaLike,
	TJoin extends ViewRuntimeEventJoinLike,
>(input: {
	alias: string;
	targetType: PropertyType;
	context: ViewRuntimeReferenceContext<TSchema, TJoin>;
	reference: Extract<RuntimeRef, { type: "schema-property" }>;
}) => {
	const foundSchema = getSchemaForReference(
		input.context.schemaMap,
		input.reference,
	);
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

	if (
		input.context.schemaMap.size === 1 &&
		input.reference.slug === foundSchema.slug
	) {
		return valueExpression;
	}

	return sql`case when ${sql.raw(input.alias)}.entity_schema_slug = ${input.reference.slug} then ${valueExpression} else null end`;
};

const buildEventJoinPropertySortExpression = <
	TSchema extends ViewRuntimeSchemaLike,
	TJoin extends ViewRuntimeEventJoinLike,
>(input: {
	alias: string;
	targetType: PropertyType;
	context: ViewRuntimeReferenceContext<TSchema, TJoin>;
	reference: Extract<RuntimeRef, { type: "event-join-property" }>;
}) => {
	const join = getEventJoinForReference(
		input.context.eventJoinMap,
		input.reference,
	);
	const propertyType = getEventJoinPropertyType(join, input.reference.property);
	if (!propertyType) {
		throw new ViewRuntimeValidationError(
			`Property '${input.reference.property}' not found for event join '${join.key}'`,
		);
	}

	const joinColumn = buildEventJoinJsonColumnExpression(
		input.alias,
		input.reference.joinKey,
	);
	return buildCastedValueExpression(input.targetType, {
		propertyJson: sql`${joinColumn} -> 'properties' -> ${input.reference.property}`,
		propertyText: sql`${joinColumn} -> 'properties' ->> ${input.reference.property}`,
	});
};

const buildEntityColumnSortExpression = <
	TSchema extends ViewRuntimeSchemaLike,
	TJoin extends ViewRuntimeEventJoinLike,
>(input: {
	alias: string;
	column: string;
	targetType: PropertyType;
	context: ViewRuntimeReferenceContext<TSchema, TJoin>;
	reference: Extract<RuntimeRef, { type: "entity-column" }>;
}) => {
	const expression = match(input.column)
		.with("id", () => sql`${sql.raw(input.alias)}.id`)
		.with("name", () => sql`${sql.raw(input.alias)}.name`)
		.with("createdAt", () => sql`${sql.raw(input.alias)}.created_at`)
		.with("updatedAt", () => sql`${sql.raw(input.alias)}.updated_at`)
		.otherwise(() => {
			throw new ViewRuntimeValidationError(
				`Unsupported entity column '@${input.column}'`,
			);
		});

	const valueExpression = match(input.targetType)
		.with("date", () => sql`(${expression})::timestamp`)
		.with("number", () => sql`(${expression})::numeric`)
		.with("integer", () => sql`(${expression})::integer`)
		.with("boolean", () => sql`(${expression})::boolean`)
		.with("array", "object", () => sql`to_jsonb(${expression})`)
		.otherwise(() => sql`(${expression})::text`);

	if (
		input.context.schemaMap.size === 1 &&
		input.context.schemaMap.has(input.reference.slug)
	) {
		return valueExpression;
	}

	return sql`case when ${sql.raw(input.alias)}.entity_schema_slug = ${input.reference.slug} then ${valueExpression} else null end`;
};

const buildEventJoinColumnSortExpression = (input: {
	alias: string;
	column: string;
	joinKey: string;
	targetType: PropertyType;
}) => {
	const propertyType = getEventJoinColumnPropertyType(input.column);
	if (!propertyType) {
		throw new ViewRuntimeValidationError(
			`Unsupported event join column 'event.${input.joinKey}.@${input.column}'`,
		);
	}

	const joinColumn = buildEventJoinJsonColumnExpression(
		input.alias,
		input.joinKey,
	);
	return buildCastedValueExpression(input.targetType, {
		propertyJson: sql`${joinColumn} -> ${input.column}`,
		propertyText: sql`${joinColumn} ->> ${input.column}`,
	});
};

const getSortExpressionType = <
	TSchema extends ViewRuntimeSchemaLike,
	TJoin extends ViewRuntimeEventJoinLike,
>(input: {
	reference: string;
	context: ViewRuntimeReferenceContext<TSchema, TJoin>;
}) => {
	const parsedReference = resolveRuntimeReference(input.reference);

	if (parsedReference.type === "entity-column") {
		getSchemaForReference(input.context.schemaMap, parsedReference);
		return {
			parsedReference,
			propertyType: getTopLevelSortType(parsedReference.column),
		};
	}

	if (parsedReference.type === "event-join-column") {
		getEventJoinForReference(input.context.eventJoinMap, parsedReference);
		const propertyType = getEventJoinColumnPropertyType(parsedReference.column);
		if (!propertyType) {
			throw new ViewRuntimeValidationError(
				`Unsupported event join column 'event.${parsedReference.joinKey}.@${parsedReference.column}'`,
			);
		}

		return { parsedReference, propertyType };
	}

	if (parsedReference.type === "event-join-property") {
		const join = getEventJoinForReference(
			input.context.eventJoinMap,
			parsedReference,
		);
		const propertyType = getEventJoinPropertyType(
			join,
			parsedReference.property,
		);
		if (!propertyType) {
			throw new ViewRuntimeValidationError(
				`Property '${parsedReference.property}' not found for event join '${join.key}'`,
			);
		}

		return { parsedReference, propertyType };
	}

	if (parsedReference.type === "computed-field") {
		throw new ViewRuntimeValidationError(
			"Computed field references are not supported in sort fields",
		);
	}

	const foundSchema = getSchemaForReference(
		input.context.schemaMap,
		parsedReference,
	);
	const propertyType = getPropertyType(foundSchema, parsedReference.property);
	if (!propertyType) {
		throw new ViewRuntimeValidationError(
			`Property '${parsedReference.property}' not found in schema '${parsedReference.slug}'`,
		);
	}

	return { parsedReference, propertyType };
};

const requireEntityQualifiedSortFields = (field: string[]) => {
	for (const reference of field) {
		if (
			reference.startsWith("event.") ||
			reference.startsWith("entity.") ||
			reference.startsWith("computed.")
		) {
			continue;
		}

		throw new ViewRuntimeValidationError(
			"Explicit field references are required",
		);
	}
};

export const buildSortExpression = <
	TSchema extends ViewRuntimeSchemaLike,
	TJoin extends ViewRuntimeEventJoinLike,
>(input: {
	alias: string;
	field: string[];
	context: ViewRuntimeReferenceContext<TSchema, TJoin>;
}) => {
	requireEntityQualifiedSortFields(input.field);

	const resolvedFields = input.field.map((reference) => {
		return getSortExpressionType({
			reference,
			context: input.context,
		});
	});
	const targetType = getCommonSortPropertyType(
		resolvedFields.map((field) => field.propertyType),
	);
	const expressions = resolvedFields.map((field) => {
		if (field.parsedReference.type === "entity-column") {
			return buildEntityColumnSortExpression({
				targetType,
				alias: input.alias,
				context: input.context,
				reference: field.parsedReference,
				column: field.parsedReference.column,
			});
		}

		if (field.parsedReference.type === "event-join-column") {
			return buildEventJoinColumnSortExpression({
				targetType,
				alias: input.alias,
				column: field.parsedReference.column,
				joinKey: field.parsedReference.joinKey,
			});
		}

		if (field.parsedReference.type === "event-join-property") {
			return buildEventJoinPropertySortExpression({
				targetType,
				alias: input.alias,
				context: input.context,
				reference: field.parsedReference,
			});
		}

		return buildPropertySortExpression({
			targetType,
			alias: input.alias,
			context: input.context,
			reference: field.parsedReference,
		});
	});

	return buildCoalescedExpression(expressions);
};
