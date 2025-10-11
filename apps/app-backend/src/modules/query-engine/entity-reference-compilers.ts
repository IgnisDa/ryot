import { sql } from "drizzle-orm";
import { Match } from "effect";

import type { QueryExpression } from "~/lib/query-language";
import { QueryEngineValidationError } from "~/lib/views/errors";
import { normalizeExpressionPropertyType } from "~/lib/views/expression-analysis";
import type { EntityColumnOverrides, PropertyType } from "~/lib/views/reference";
import {
	getEntityColumnPropertyType,
	getEntitySchemaColumnPropertyType,
	getPropertyType,
	getSchemaForReference,
} from "~/lib/views/reference";

import type { QueryEngineContext } from "./context";
import { buildSchemaReferenceExpression } from "./reference-compiler-shared";
import {
	buildJsonColumnPropertyExpression,
	castExpressionToType,
	sanitizeIdentifier,
} from "./sql-expression-helpers";

const resolveEntityColumn = (
	column: string,
	overrides: EntityColumnOverrides | undefined,
): string | null => {
	if (column === "id") {
		return overrides?.id ?? "id";
	}
	if (column === "createdAt") {
		return overrides?.created_at ?? "created_at";
	}
	if (column === "updatedAt") {
		return overrides?.updated_at ?? "updated_at";
	}
	return null;
};

export const buildEntityExpression = (input: {
	alias: string;
	targetType?: PropertyType;
	context: QueryEngineContext;
	reference: Extract<QueryExpression, { type: "reference" }>["reference"] & { type: "entity" };
}) => {
	const safeAlias = sanitizeIdentifier(input.alias, "table alias");
	const schema = getSchemaForReference(input.context.schemaMap, input.reference);
	const overrides = input.context.entityColumnOverrides;

	if (input.reference.path[0] === "properties") {
		const propertyPath = input.reference.path.slice(1);
		const propertyType = getPropertyType(schema, propertyPath);
		if (!propertyType) {
			throw new QueryEngineValidationError(
				`Property '${propertyPath.join(".")}' not found in schema '${input.reference.slug}'`,
			);
		}

		const propertiesCol = overrides?.properties ?? "properties";
		const valueExpression = buildJsonColumnPropertyExpression({
			propertyPath,
			propertyType,
			targetType: input.targetType,
			base: sql`${sql.raw(`${safeAlias}.${propertiesCol}`)}`,
		});

		if (input.context.schemaMap.size === 1 && input.reference.slug === schema.slug) {
			return valueExpression;
		}

		return sql`case when ${sql.raw(safeAlias)}.entity_schema_data ->> ${"slug"} = ${input.reference.slug} then ${valueExpression} else null end`;
	}

	const [column] = input.reference.path;
	if (!column) {
		throw new QueryEngineValidationError("Entity reference path must not be empty");
	}

	const sqlCol = resolveEntityColumn(column, overrides);

	const expression = sqlCol
		? sql`${sql.raw(`${safeAlias}.${sqlCol}`)}`
		: Match.value(column).pipe(
				Match.when("name", () => sql`${sql.raw(safeAlias)}.name`),
				Match.when("image", () => sql`${sql.raw(safeAlias)}.image`),
				Match.when("externalId", () => sql`${sql.raw(safeAlias)}.external_id`),
				Match.when("sandboxScriptId", () => sql`${sql.raw(safeAlias)}.sandbox_script_id`),
				Match.orElse(() => {
					throw new QueryEngineValidationError(`Unsupported entity column '${column}'`);
				}),
			);

	const actualType =
		column === "image" ? undefined : (getEntityColumnPropertyType(column) ?? undefined);
	if (column === "image" && input.targetType) {
		throw new QueryEngineValidationError(
			"Image expressions are display-only and cannot be compiled for sort or filter usage",
		);
	}

	const valueExpression = input.targetType
		? castExpressionToType(expression, input.targetType)
		: actualType
			? castExpressionToType(expression, normalizeExpressionPropertyType(actualType))
			: expression;

	if (input.context.schemaMap.size === 1 && input.context.schemaMap.has(input.reference.slug)) {
		return valueExpression;
	}

	return sql`case when ${sql.raw(safeAlias)}.entity_schema_data ->> ${"slug"} = ${input.reference.slug} then ${valueExpression} else null end`;
};

export const buildEntitySchemaExpression = (input: {
	alias: string;
	targetType?: PropertyType;
	reference: Extract<QueryExpression, { type: "reference" }>["reference"] & {
		type: "entity-schema";
	};
}) =>
	buildSchemaReferenceExpression({
		alias: input.alias,
		path: input.reference.path,
		targetType: input.targetType,
		referenceLabel: "Entity schema",
		dataColumn: "entity_schema_data",
		resolvePropertyType: getEntitySchemaColumnPropertyType,
	});
