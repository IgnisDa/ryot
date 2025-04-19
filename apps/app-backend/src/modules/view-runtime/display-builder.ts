import { sql } from "drizzle-orm";
import { match } from "ts-pattern";
import {
	buildComputedFieldMap,
	orderComputedFields,
} from "~/lib/views/computed-fields";
import { ViewRuntimeValidationError } from "~/lib/views/errors";
import type {
	RuntimeRef,
	ViewComputedField,
	ViewExpression,
} from "~/lib/views/expression";
import { getPropertyDisplayKind } from "~/lib/views/policy";
import {
	getEventJoinColumnPropertyType,
	getEventJoinForReference,
	getEventJoinPropertyType,
	getPropertyType,
	getSchemaForReference,
	type ViewRuntimeEventJoinLike,
	type ViewRuntimeReferenceContext,
	type ViewRuntimeSchemaLike,
} from "~/lib/views/reference";
import type { ResolvedDisplayValue, ViewRuntimeField } from "./schemas";

type SqlExpression = ReturnType<typeof sql>;

type DisplayValueCandidate = {
	value: SqlExpression;
	kind: ResolvedDisplayValue["kind"];
};

type DisplayExpressionResolverInput<
	TSchema extends ViewRuntimeSchemaLike,
	TJoin extends ViewRuntimeEventJoinLike,
> = {
	alias: string;
	computedFields?: ViewComputedField[];
	context: ViewRuntimeReferenceContext<TSchema, TJoin>;
};

const getEventJoinColumnName = (joinKey: string) => `event_join_${joinKey}`;

const buildEventJoinJsonColumnExpression = (alias: string, joinKey: string) => {
	return sql`${sql.raw(`${alias}.${getEventJoinColumnName(joinKey)}`)}`;
};

const wrapJsonbNull = (value: SqlExpression) =>
	sql`nullif(${value}, 'null'::jsonb)`;

const buildEntityColumnDisplayExpression = (alias: string, column: string) =>
	match(column)
		.with("id", () => sql`to_jsonb(${sql.raw(alias)}.id)`)
		.with("name", () => sql`to_jsonb(${sql.raw(alias)}.name)`)
		.with("createdAt", () => sql`to_jsonb(${sql.raw(alias)}.created_at)`)
		.with("updatedAt", () => sql`to_jsonb(${sql.raw(alias)}.updated_at)`)
		.with("image", () => wrapJsonbNull(sql`${sql.raw(alias)}.image`))
		.otherwise(() => {
			throw new ViewRuntimeValidationError(
				`Unsupported entity column '@${column}'`,
			);
		});

const getEntityColumnDisplayKind = (
	column: string,
): ResolvedDisplayValue["kind"] =>
	match(column)
		.with("id", () => "text" as const)
		.with("name", () => "text" as const)
		.with("image", () => "image" as const)
		.with("createdAt", "updatedAt", () => "date" as const)
		.otherwise(() => {
			throw new ViewRuntimeValidationError(
				`Unsupported entity column '@${column}'`,
			);
		});

const getEventJoinDisplayKind = (
	column: string,
): ResolvedDisplayValue["kind"] => {
	return match(column)
		.with("id", () => "text" as const)
		.with("createdAt", "updatedAt", () => "date" as const)
		.otherwise(() => {
			throw new ViewRuntimeValidationError(
				`Unsupported event join column '@${column}'`,
			);
		});
};

const buildResolvedDisplayValueObject = (candidate: DisplayValueCandidate) => {
	return sql`jsonb_build_object('value', ${candidate.value}, 'kind', ${sql.raw(`'${candidate.kind}'::text`)})`;
};

const buildNullResolvedDisplayValueObject = () => {
	return buildResolvedDisplayValueObject({ kind: "null", value: sql`null` });
};

const buildResolvedValuePresenceExpression = (value: SqlExpression) => {
	return sql`nullif(${value} -> 'value', 'null'::jsonb)`;
};

const getLiteralDisplayKind = (
	value: unknown | null,
): ResolvedDisplayValue["kind"] => {
	if (value === null) {
		return "null";
	}

	if (typeof value === "string") {
		return "text";
	}

	if (typeof value === "number") {
		return "number";
	}

	if (typeof value === "boolean") {
		return "boolean";
	}

	return "json";
};

const buildLiteralValueExpression = (value: unknown | null) => {
	if (value === null) {
		return sql`null`;
	}

	return sql`${JSON.stringify(value)}::jsonb`;
};

const buildDisplayValueCandidate = <
	TSchema extends ViewRuntimeSchemaLike,
	TJoin extends ViewRuntimeEventJoinLike,
>(input: {
	alias: string;
	context: ViewRuntimeReferenceContext<TSchema, TJoin>;
	reference: Exclude<RuntimeRef, { type: "computed-field" }>;
}): DisplayValueCandidate => {
	const parsedReference = input.reference;

	if (parsedReference.type === "entity-column") {
		getSchemaForReference(input.context.schemaMap, parsedReference);
		const value = buildEntityColumnDisplayExpression(
			input.alias,
			parsedReference.column,
		);
		if (
			input.context.schemaMap.size === 1 &&
			input.context.schemaMap.has(parsedReference.slug)
		) {
			return {
				value,
				kind: getEntityColumnDisplayKind(parsedReference.column),
			};
		}

		return {
			kind: getEntityColumnDisplayKind(parsedReference.column),
			value: sql`case when ${sql.raw(input.alias)}.entity_schema_slug = ${parsedReference.slug} then ${value} else null end`,
		};
	}

	if (parsedReference.type === "event-join-column") {
		getEventJoinForReference(input.context.eventJoinMap, parsedReference);
		if (!getEventJoinColumnPropertyType(parsedReference.column)) {
			throw new ViewRuntimeValidationError(
				`Unsupported event join column 'event.${parsedReference.joinKey}.@${parsedReference.column}'`,
			);
		}

		const joinColumn = buildEventJoinJsonColumnExpression(
			input.alias,
			parsedReference.joinKey,
		);
		return {
			kind: getEventJoinDisplayKind(parsedReference.column),
			value: wrapJsonbNull(sql`${joinColumn} -> ${parsedReference.column}`),
		};
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

		const joinColumn = buildEventJoinJsonColumnExpression(
			input.alias,
			parsedReference.joinKey,
		);
		return {
			kind: getPropertyDisplayKind(propertyType),
			value: wrapJsonbNull(
				sql`${joinColumn} -> 'properties' -> ${parsedReference.property}`,
			),
		};
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

	const propertyValue = wrapJsonbNull(
		sql`${sql.raw(input.alias)}.properties -> ${parsedReference.property}`,
	);
	const kind: ResolvedDisplayValue["kind"] =
		getPropertyDisplayKind(propertyType);
	if (
		input.context.schemaMap.size === 1 &&
		parsedReference.slug === foundSchema.slug
	) {
		return { kind, value: propertyValue };
	}

	return {
		kind,
		value: sql`case when ${sql.raw(input.alias)}.entity_schema_slug = ${parsedReference.slug} then ${propertyValue} else null end`,
	};
};

const createDisplayExpressionResolver = <
	TSchema extends ViewRuntimeSchemaLike,
	TJoin extends ViewRuntimeEventJoinLike,
>(
	input: DisplayExpressionResolverInput<TSchema, TJoin>,
) => {
	const computedFieldCache = new Map<string, SqlExpression>();
	const computedFieldMap = buildComputedFieldMap(input.computedFields);
	const orderedComputedFields = orderComputedFields(input.computedFields);

	const buildResolvedDisplayValueExpression = (
		expression: ViewExpression,
	): SqlExpression => {
		if (expression.type === "literal") {
			return buildResolvedDisplayValueObject({
				kind: getLiteralDisplayKind(expression.value),
				value: buildLiteralValueExpression(expression.value),
			});
		}

		if (expression.type === "reference") {
			if (expression.reference.type === "computed-field") {
				const computedField = computedFieldMap.get(expression.reference.key);
				if (!computedField) {
					throw new ViewRuntimeValidationError(
						`Computed field '${expression.reference.key}' is not part of this runtime request`,
					);
				}

				const cached = computedFieldCache.get(expression.reference.key);
				if (cached) {
					return cached;
				}

				const resolved = buildResolvedDisplayValueExpression(
					computedField.expression,
				);
				computedFieldCache.set(expression.reference.key, resolved);
				return resolved;
			}

			const candidate = buildDisplayValueCandidate({
				alias: input.alias,
				context: input.context,
				reference: expression.reference,
			});

			return sql`case when ${candidate.value} is not null then ${buildResolvedDisplayValueObject(candidate)} else ${buildNullResolvedDisplayValueObject()} end`;
		}

		const values: SqlExpression[] = expression.values.map((value) => {
			return buildResolvedDisplayValueExpression(value);
		});
		const whenClauses: SqlExpression[] = values.map((value) => {
			return sql`when ${buildResolvedValuePresenceExpression(value)} is not null then ${value}`;
		});

		return sql`case ${sql.join(whenClauses, sql` `)} else ${buildNullResolvedDisplayValueObject()} end`;
	};

	for (const computedField of orderedComputedFields) {
		if (!computedFieldCache.has(computedField.key)) {
			computedFieldCache.set(
				computedField.key,
				buildResolvedDisplayValueExpression(computedField.expression),
			);
		}
	}

	return buildResolvedDisplayValueExpression;
};

export const buildResolvedFieldsExpression = <
	TSchema extends ViewRuntimeSchemaLike,
	TJoin extends ViewRuntimeEventJoinLike,
>(input: {
	alias: string;
	fields: ViewRuntimeField[];
	computedFields?: ViewComputedField[];
	context: ViewRuntimeReferenceContext<TSchema, TJoin>;
}) => {
	const resolveExpression = createDisplayExpressionResolver({
		alias: input.alias,
		context: input.context,
		computedFields: input.computedFields,
	});

	const fieldExpressions = input.fields.map((field) => {
		const resolvedValue = resolveExpression(field.expression);

		return sql`jsonb_build_object(
			'key', cast(${field.key} as text),
			'kind', ${resolvedValue} ->> 'kind',
			'value', ${resolvedValue} -> 'value'
		)`;
	});

	if (!fieldExpressions.length) {
		return sql`'[]'::jsonb`;
	}

	return sql`jsonb_build_array(${sql.join(fieldExpressions, sql`, `)})`;
};
