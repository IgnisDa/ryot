import type { RuntimeRef } from "@ryot/ts-utils";
import { sql } from "drizzle-orm";
import { match } from "ts-pattern";
import { QueryEngineValidationError } from "~/lib/views/errors";
import { normalizeExpressionPropertyType } from "~/lib/views/expression-analysis";
import type { PropertyType } from "~/lib/views/reference";
import {
	getEntityColumnPropertyType,
	getEntitySchemaColumnPropertyType,
	getPropertyType,
	getSchemaForReference,
} from "~/lib/views/reference";
import type { QueryEngineContext } from "./schemas";
import {
	buildJsonColumnPropertyExpression,
	castExpressionToType,
	sanitizeIdentifier,
} from "./sql-expression-helpers";

export const buildEntityExpression = (input: {
	alias: string;
	targetType?: PropertyType;
	context: QueryEngineContext;
	reference: Extract<RuntimeRef, { type: "entity" }>;
}) => {
	const safeAlias = sanitizeIdentifier(input.alias, "table alias");
	const schema = getSchemaForReference(
		input.context.schemaMap,
		input.reference,
	);
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

		if (
			input.context.schemaMap.size === 1 &&
			input.reference.slug === schema.slug
		) {
			return valueExpression;
		}

		return sql`case when ${sql.raw(safeAlias)}.entity_schema_data ->> ${"slug"} = ${input.reference.slug} then ${valueExpression} else null end`;
	}

	const [column] = input.reference.path;
	if (!column) {
		throw new QueryEngineValidationError(
			"Entity reference path must not be empty",
		);
	}

	const sqlCol = (() => {
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
	})();

	const expression = sqlCol
		? sql`${sql.raw(`${safeAlias}.${sqlCol}`)}`
		: match(column)
				.with("name", () => sql`${sql.raw(safeAlias)}.name`)
				.with("image", () => sql`${sql.raw(safeAlias)}.image`)
				.with("externalId", () => sql`${sql.raw(safeAlias)}.external_id`)
				.with(
					"sandboxScriptId",
					() => sql`${sql.raw(safeAlias)}.sandbox_script_id`,
				)
				.otherwise(() => {
					throw new QueryEngineValidationError(
						`Unsupported entity column '${column}'`,
					);
				});

	const actualType =
		column === "image"
			? undefined
			: (getEntityColumnPropertyType(column) ?? undefined);
	if (column === "image" && input.targetType) {
		throw new QueryEngineValidationError(
			"Image expressions are display-only and cannot be compiled for sort or filter usage",
		);
	}

	const valueExpression = input.targetType
		? castExpressionToType(expression, input.targetType)
		: actualType
			? castExpressionToType(
					expression,
					normalizeExpressionPropertyType(actualType),
				)
			: expression;

	if (
		input.context.schemaMap.size === 1 &&
		input.context.schemaMap.has(input.reference.slug)
	) {
		return valueExpression;
	}

	return sql`case when ${sql.raw(safeAlias)}.entity_schema_data ->> ${"slug"} = ${input.reference.slug} then ${valueExpression} else null end`;
};

export const buildEntitySchemaExpression = (input: {
	alias: string;
	targetType?: PropertyType;
	reference: Extract<RuntimeRef, { type: "entity-schema" }>;
}) => {
	const [column] = input.reference.path;
	if (!column) {
		throw new QueryEngineValidationError(
			"Entity schema reference path must not be empty",
		);
	}

	if (input.reference.path.length > 1) {
		throw new QueryEngineValidationError(
			"Entity schema references do not support nested paths",
		);
	}

	const propertyType = getEntitySchemaColumnPropertyType(column);
	if (!propertyType) {
		throw new QueryEngineValidationError(
			`Unsupported entity schema column '${column}'`,
		);
	}

	const safeAlias = sanitizeIdentifier(input.alias, "table alias");
	const expression = sql`${sql.raw(safeAlias)}.entity_schema_data ->> ${column}`;

	return input.targetType
		? castExpressionToType(expression, input.targetType)
		: castExpressionToType(
				expression,
				normalizeExpressionPropertyType(propertyType),
			);
};
