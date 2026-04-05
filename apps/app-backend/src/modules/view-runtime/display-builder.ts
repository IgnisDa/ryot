import { sql } from "drizzle-orm";
import { match } from "ts-pattern";
import type { GridConfig, ListConfig } from "../saved-views/schemas";
import { ViewRuntimeValidationError } from "./errors";
import {
	getSchemaForReference,
	resolveRuntimeReference,
	type ViewRuntimeSchemaLike,
} from "./runtime-reference";
import { getPropertyType, type PropertyType } from "./schema-introspection";
import type { ResolvedDisplayValue, ViewRuntimeRequest } from "./schemas";

type SqlExpression = ReturnType<typeof sql>;

type DisplayValueCandidate = {
	value: SqlExpression;
	kind: ResolvedDisplayValue["kind"];
};

const wrapJsonbNull = (value: SqlExpression) =>
	sql`nullif(${value}, 'null'::jsonb)`;

const buildTopLevelDisplayExpression = (alias: string, column: string) =>
	match(column)
		.with("name", () => sql`to_jsonb(${sql.raw(alias)}.name)`)
		.with("createdAt", () => sql`to_jsonb(${sql.raw(alias)}.created_at)`)
		.with("updatedAt", () => sql`to_jsonb(${sql.raw(alias)}.updated_at)`)
		.with("image", () => wrapJsonbNull(sql`${sql.raw(alias)}.image`))
		.otherwise(() => {
			throw new ViewRuntimeValidationError(
				`Unsupported display column '@${column}'`,
			);
		});

const getTopLevelDisplayKind = (column: string): ResolvedDisplayValue["kind"] =>
	match(column)
		.with("name", () => "text" as const)
		.with("image", () => "image" as const)
		.with("createdAt", "updatedAt", () => "date" as const)
		.otherwise(() => {
			throw new ViewRuntimeValidationError(
				`Unsupported display column '@${column}'`,
			);
		});

const getPropertyDisplayKind = (
	propertyType: PropertyType,
): ResolvedDisplayValue["kind"] =>
	match(propertyType)
		.with("date", () => "date" as const)
		.with("boolean", () => "boolean" as const)
		.with("array", "object", () => "json" as const)
		.with("integer", "number", () => "number" as const)
		.otherwise(() => "text" as const);

const buildDisplayValueCandidate = <
	TSchema extends ViewRuntimeSchemaLike,
>(input: {
	alias: string;
	reference: string | null;
	schemaMap: Map<string, TSchema>;
}): DisplayValueCandidate => {
	if (!input.reference) {
		return { kind: "null", value: sql`null` };
	}

	const parsedReference = resolveRuntimeReference(input.reference);
	if (parsedReference.type === "top-level") {
		return {
			value: buildTopLevelDisplayExpression(
				input.alias,
				parsedReference.column,
			),
			kind: getTopLevelDisplayKind(parsedReference.column),
		};
	}

	const foundSchema = getSchemaForReference(input.schemaMap, parsedReference);
	const propertyType = getPropertyType(foundSchema, parsedReference.property);
	if (!propertyType) {
		throw new ViewRuntimeValidationError(
			`Property '${parsedReference.property}' not found in schema '${parsedReference.slug}'`,
		);
	}

	const propertyValue = wrapJsonbNull(
		sql`${sql.raw(input.alias)}.properties -> ${parsedReference.property}`,
	);
	const kind = getPropertyDisplayKind(propertyType);
	if (input.schemaMap.size === 1) {
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
>(input: {
	alias: string;
	references: string[] | null;
	schemaMap: Map<string, TSchema>;
}) => {
	const candidates = normalizeReferences(input.references).map((reference) => {
		return buildDisplayValueCandidate({
			reference,
			alias: input.alias,
			schemaMap: input.schemaMap,
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
>(input: {
	alias: string;
	request: ViewRuntimeRequest;
	schemaMap: Map<string, TSchema>;
}) => {
	if (input.request.layout === "table") {
		return sql`'{}'::jsonb`;
	}

	const displayConfiguration: GridConfig | ListConfig =
		input.request.displayConfiguration;

	return sql`jsonb_build_object(
		'imageProperty', ${buildResolvedDisplayValueExpression({
			alias: input.alias,
			schemaMap: input.schemaMap,
			references: displayConfiguration.imageProperty,
		})},
		'titleProperty', ${buildResolvedDisplayValueExpression({
			alias: input.alias,
			schemaMap: input.schemaMap,
			references: displayConfiguration.titleProperty,
		})},
		'subtitleProperty', ${buildResolvedDisplayValueExpression({
			alias: input.alias,
			schemaMap: input.schemaMap,
			references: displayConfiguration.subtitleProperty,
		})},
		'badgeProperty', ${buildResolvedDisplayValueExpression({
			alias: input.alias,
			schemaMap: input.schemaMap,
			references: displayConfiguration.badgeProperty,
		})}
	)`;
};

export const buildTableCellsExpression = <
	TSchema extends ViewRuntimeSchemaLike,
>(input: {
	alias: string;
	request: Extract<ViewRuntimeRequest, { layout: "table" }>;
	schemaMap: Map<string, TSchema>;
}) => {
	const cellExpressions = input.request.displayConfiguration.columns.map(
		(column, index) => {
			const key = `column_${index}`;
			const resolvedValue = buildResolvedDisplayValueExpression({
				alias: input.alias,
				schemaMap: input.schemaMap,
				references: column.property,
			});

			return sql`jsonb_build_object(
				'key', ${sql.raw(`'${key}'::text`)},
				'value', ${resolvedValue} -> 'value',
				'kind', ${resolvedValue} ->> 'kind'
			)`;
		},
	);

	if (!cellExpressions.length) {
		return sql`'[]'::jsonb`;
	}

	return sql`jsonb_build_array(${sql.join(cellExpressions, sql`, `)})`;
};
