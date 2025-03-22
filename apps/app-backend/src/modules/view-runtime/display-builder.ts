import { sql } from "drizzle-orm";
import { match } from "ts-pattern";
import type { GridConfig, ListConfig } from "../saved-views/schemas";
import { ViewRuntimeValidationError } from "./errors";
import {
	buildCoalescedExpression,
	getSchemaForReference,
	resolveRuntimeReference,
	type ViewRuntimeSchemaLike,
} from "./runtime-reference";
import { getPropertyType } from "./schema-introspection";
import type { ViewRuntimeRequest } from "./schemas";

const buildTopLevelDisplayExpression = (alias: string, column: string) =>
	match(column)
		.with("name", () => sql`to_jsonb(${sql.raw(alias)}.name)`)
		.with("image", () => sql`coalesce(${sql.raw(alias)}.image, 'null'::jsonb)`)
		.with("createdAt", () => sql`to_jsonb(${sql.raw(alias)}.created_at)`)
		.with("updatedAt", () => sql`to_jsonb(${sql.raw(alias)}.updated_at)`)
		.otherwise(() => {
			throw new ViewRuntimeValidationError(
				`Unsupported display column '@${column}'`,
			);
		});

const buildDisplayValueExpression = <
	TSchema extends ViewRuntimeSchemaLike,
>(input: {
	alias: string;
	reference: string | null;
	defaultSchemaSlug: string;
	schemaMap: Map<string, TSchema>;
}) => {
	if (!input.reference) {
		return sql`'null'::jsonb`;
	}

	const parsedReference = resolveRuntimeReference(
		input.reference,
		input.defaultSchemaSlug,
	);
	if (parsedReference.type === "top-level") {
		return buildTopLevelDisplayExpression(input.alias, parsedReference.column);
	}

	const foundSchema = getSchemaForReference(input.schemaMap, parsedReference);
	if (!getPropertyType(foundSchema, parsedReference.property)) {
		throw new ViewRuntimeValidationError(
			`Property '${parsedReference.property}' not found in schema '${parsedReference.slug}'`,
		);
	}

	const propertyValue = sql`${sql.raw(input.alias)}.properties -> ${parsedReference.property}`;
	if (
		input.schemaMap.size === 1 &&
		parsedReference.slug === input.defaultSchemaSlug
	) {
		return propertyValue;
	}

	return sql`case when ${sql.raw(input.alias)}.entity_schema_slug = ${parsedReference.slug} then ${propertyValue} else null end`;
};

const normalizeReferences = (references: string[] | null) => {
	if (!references?.length) {
		return [null];
	}

	return references;
};

const buildCoalescedDisplayExpression = <
	TSchema extends ViewRuntimeSchemaLike,
>(input: {
	alias: string;
	defaultSchemaSlug: string;
	references: string[] | null;
	schemaMap: Map<string, TSchema>;
}) => {
	const expressions = normalizeReferences(input.references).map((reference) => {
		return buildDisplayValueExpression({
			reference,
			alias: input.alias,
			schemaMap: input.schemaMap,
			defaultSchemaSlug: input.defaultSchemaSlug,
		});
	});

	return buildCoalescedExpression(expressions);
};

export const buildResolvedPropertiesExpression = <
	TSchema extends ViewRuntimeSchemaLike,
>(input: {
	alias: string;
	defaultSchemaSlug: string;
	request: ViewRuntimeRequest;
	schemaMap: Map<string, TSchema>;
}) => {
	if (input.request.layout === "table") {
		const columnExpressions = input.request.displayConfiguration.columns.map(
			(column, index) => {
				return sql`jsonb_build_object(
					${sql.raw(`'column_${index}'::text`)},
					${buildCoalescedDisplayExpression({
						alias: input.alias,
						schemaMap: input.schemaMap,
						references: column.property,
						defaultSchemaSlug: input.defaultSchemaSlug,
					})}
				)`;
			},
		);

		if (!columnExpressions.length) {
			return sql`'{}'::jsonb`;
		}

		return sql.join(columnExpressions, sql` || `);
	}

	const displayConfiguration: GridConfig | ListConfig =
		input.request.displayConfiguration;

	return sql`jsonb_build_object(
		'imageProperty', ${buildCoalescedDisplayExpression({
			alias: input.alias,
			schemaMap: input.schemaMap,
			defaultSchemaSlug: input.defaultSchemaSlug,
			references: displayConfiguration.imageProperty,
		})},
		'titleProperty', ${buildCoalescedDisplayExpression({
			alias: input.alias,
			schemaMap: input.schemaMap,
			defaultSchemaSlug: input.defaultSchemaSlug,
			references: displayConfiguration.titleProperty,
		})},
		'subtitleProperty', ${buildCoalescedDisplayExpression({
			alias: input.alias,
			schemaMap: input.schemaMap,
			defaultSchemaSlug: input.defaultSchemaSlug,
			references: displayConfiguration.subtitleProperty,
		})},
		'badgeProperty', ${buildCoalescedDisplayExpression({
			alias: input.alias,
			schemaMap: input.schemaMap,
			defaultSchemaSlug: input.defaultSchemaSlug,
			references: displayConfiguration.badgeProperty,
		})}
	)`;
};
