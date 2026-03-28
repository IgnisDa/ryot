import { sql } from "drizzle-orm";
import { match } from "ts-pattern";
import { ViewRuntimeValidationError } from "~/lib/views/errors";
import { getPropertyDisplayKind } from "~/lib/views/policy";
import {
	getEventJoinColumnPropertyType,
	getEventJoinForReference,
	getEventJoinPropertyType,
	getPropertyType,
	getSchemaForReference,
	resolveRuntimeReference,
	type ViewRuntimeEventJoinLike,
	type ViewRuntimeReferenceContext,
	type ViewRuntimeSchemaLike,
} from "~/lib/views/reference";
import type { GridConfig, ListConfig } from "../saved-views/schemas";
import type { ResolvedDisplayValue, ViewRuntimeRequest } from "./schemas";

type SqlExpression = ReturnType<typeof sql>;

type DisplayValueCandidate = {
	value: SqlExpression;
	kind: ResolvedDisplayValue["kind"];
};

const getEventJoinColumnName = (joinKey: string) => `event_join_${joinKey}`;

const buildEventJoinJsonColumnExpression = (alias: string, joinKey: string) => {
	return sql`${sql.raw(`${alias}.${getEventJoinColumnName(joinKey)}`)}`;
};

const wrapJsonbNull = (value: SqlExpression) =>
	sql`nullif(${value}, 'null'::jsonb)`;

const buildEntityColumnDisplayExpression = (alias: string, column: string) =>
	match(column)
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

const buildDisplayValueCandidate = <
	TSchema extends ViewRuntimeSchemaLike,
	TJoin extends ViewRuntimeEventJoinLike,
>(input: {
	alias: string;
	reference: string | null;
	context: ViewRuntimeReferenceContext<TSchema, TJoin>;
}): DisplayValueCandidate => {
	if (!input.reference) {
		return { kind: "null", value: sql`null` };
	}

	const parsedReference = resolveRuntimeReference(input.reference);
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

const normalizeReferences = (references: string[] | null) => {
	if (!references?.length) {
		return [null];
	}

	return references;
};

const buildResolvedDisplayValueObject = (candidate: DisplayValueCandidate) => {
	return sql`jsonb_build_object('value', ${candidate.value}, 'kind', ${sql.raw(`'${candidate.kind}'::text`)})`;
};

const buildResolvedDisplayValueExpression = <
	TSchema extends ViewRuntimeSchemaLike,
	TJoin extends ViewRuntimeEventJoinLike,
>(input: {
	alias: string;
	references: string[] | null;
	context: ViewRuntimeReferenceContext<TSchema, TJoin>;
}) => {
	const candidates = normalizeReferences(input.references).map((reference) => {
		return buildDisplayValueCandidate({
			reference,
			alias: input.alias,
			context: input.context,
		});
	});

	const whenClauses = candidates
		.filter((candidate) => candidate.kind !== "null")
		.map((candidate) => {
			return sql`when ${candidate.value} is not null then ${buildResolvedDisplayValueObject(candidate)}`;
		});

	if (!whenClauses.length) {
		return buildResolvedDisplayValueObject({ kind: "null", value: sql`null` });
	}

	return sql`case ${sql.join(whenClauses, sql` `)} else ${buildResolvedDisplayValueObject({ kind: "null", value: sql`null` })} end`;
};

export const buildResolvedPropertiesExpression = <
	TSchema extends ViewRuntimeSchemaLike,
	TJoin extends ViewRuntimeEventJoinLike,
>(input: {
	alias: string;
	request: ViewRuntimeRequest;
	context: ViewRuntimeReferenceContext<TSchema, TJoin>;
}) => {
	if (input.request.layout === "table") {
		return sql`'{}'::jsonb`;
	}

	const displayConfiguration: GridConfig | ListConfig =
		input.request.displayConfiguration;

	return sql`jsonb_build_object(
		'imageProperty', ${buildResolvedDisplayValueExpression({
			alias: input.alias,
			context: input.context,
			references: displayConfiguration.imageProperty,
		})},
		'titleProperty', ${buildResolvedDisplayValueExpression({
			alias: input.alias,
			context: input.context,
			references: displayConfiguration.titleProperty,
		})},
		'subtitleProperty', ${buildResolvedDisplayValueExpression({
			alias: input.alias,
			context: input.context,
			references: displayConfiguration.subtitleProperty,
		})},
		'badgeProperty', ${buildResolvedDisplayValueExpression({
			alias: input.alias,
			context: input.context,
			references: displayConfiguration.badgeProperty,
		})}
	)`;
};

export const buildTableCellsExpression = <
	TSchema extends ViewRuntimeSchemaLike,
	TJoin extends ViewRuntimeEventJoinLike,
>(input: {
	alias: string;
	context: ViewRuntimeReferenceContext<TSchema, TJoin>;
	request: Extract<ViewRuntimeRequest, { layout: "table" }>;
}) => {
	const cellExpressions = input.request.displayConfiguration.columns.map(
		(column, index) => {
			const key = `column_${index}`;
			const resolvedValue = buildResolvedDisplayValueExpression({
				alias: input.alias,
				context: input.context,
				references: column.property,
			});

			return sql`jsonb_build_object(
				'kind', ${resolvedValue} ->> 'kind',
				'value', ${resolvedValue} -> 'value',
				'key', ${sql.raw(`'${key}'::text`)}
			)`;
		},
	);

	if (!cellExpressions.length) {
		return sql`'[]'::jsonb`;
	}

	return sql`jsonb_build_array(${sql.join(cellExpressions, sql`, `)})`;
};
