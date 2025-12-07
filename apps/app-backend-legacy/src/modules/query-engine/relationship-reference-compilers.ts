import type { RuntimeRef } from "@ryot/ts-utils/view-language";
import { sql } from "drizzle-orm";

import { QueryEngineValidationError } from "~/lib/views/errors";
import { normalizeExpressionPropertyType } from "~/lib/views/expression-analysis";
import type { PropertyType } from "~/lib/views/reference";
import {
	getEntityColumnPropertyType,
	getPropertyDefinition,
	getRelationshipJoinColumnPropertyType,
	getRelationshipJoinEntitySchema,
	getRelationshipJoinForReference,
	getRelationshipJoinPropertyType,
} from "~/lib/views/reference";

import type { QueryEngineContext } from "./schemas";
import {
	buildJsonColumnPropertyExpression,
	castExpressionToType,
	sanitizeIdentifier,
	type SqlExpression,
} from "./sql-expression-helpers";

const buildRelatedEntityExpression = (input: {
	path: string[];
	joinColumn: SqlExpression;
	targetType?: PropertyType;
	context: QueryEngineContext;
	entitySide: "sourceEntity" | "targetEntity";
	reference: Extract<RuntimeRef, { type: "relationship-join" }>;
}) => {
	const entityRoot = sql`${input.joinColumn} -> ${input.entitySide}`;
	const [column, ...columnRest] = input.path;

	if (!column) {
		throw new QueryEngineValidationError(
			`Related entity reference path must not be empty after '${input.entitySide}'`,
		);
	}

	if (column === "properties") {
		const propertyPath = columnRest;
		if (!propertyPath.length) {
			throw new QueryEngineValidationError(
				`Related entity 'properties' reference requires at least one property segment`,
			);
		}
		const join = getRelationshipJoinForReference(
			input.context.relationshipJoinMap ?? new Map(),
			input.reference,
		);
		const entitySchema = getRelationshipJoinEntitySchema(join, input.entitySide);
		if (!entitySchema) {
			const sideName = input.entitySide === "sourceEntity" ? "source" : "target";
			throw new QueryEngineValidationError(
				`Related entity properties under '${input.entitySide}.properties' are not available: relationship schema '${join.relationshipSchemaSlug}' does not define the ${sideName} entity schema`,
			);
		}
		const propertyDefinition = getPropertyDefinition(entitySchema, propertyPath);
		if (!propertyDefinition) {
			throw new QueryEngineValidationError(
				`Property '${propertyPath.join(".")}' not found in ${input.entitySide === "sourceEntity" ? "source" : "target"} entity schema '${entitySchema.slug}'`,
			);
		}
		return buildJsonColumnPropertyExpression({
			propertyPath,
			targetType: input.targetType,
			propertyType: propertyDefinition.type,
			base: sql`${entityRoot} -> ${"properties"}`,
		});
	}

	if (column === "image") {
		if (input.targetType) {
			throw new QueryEngineValidationError(
				"Image expressions are display-only and cannot be compiled for sort or filter usage",
			);
		}
		return sql`${entityRoot} -> ${"image"}`;
	}

	const propertyType = getEntityColumnPropertyType(column);
	if (!propertyType) {
		throw new QueryEngineValidationError(
			`Unsupported related entity column '${input.entitySide}.${column}'`,
		);
	}

	const rawExpression = sql`${entityRoot} ->> ${column}`;
	return input.targetType
		? castExpressionToType(rawExpression, input.targetType)
		: castExpressionToType(rawExpression, normalizeExpressionPropertyType(propertyType));
};

export const buildRelationshipJoinExpression = (input: {
	alias: string;
	targetType?: PropertyType;
	context: QueryEngineContext;
	reference: Extract<RuntimeRef, { type: "relationship-join" }>;
}) => {
	const joinColumn = sql`${sql.raw(`${sanitizeIdentifier(input.alias, "table alias")}.relationship_join_${input.reference.joinKey}`)}`;

	const [pathRoot] = input.reference.path;

	if (pathRoot === "sourceEntity" || pathRoot === "targetEntity") {
		return buildRelatedEntityExpression({
			joinColumn,
			entitySide: pathRoot,
			context: input.context,
			reference: input.reference,
			targetType: input.targetType,
			path: input.reference.path.slice(1),
		});
	}

	if (pathRoot === "properties") {
		const propertyPath = input.reference.path.slice(1);
		const join = getRelationshipJoinForReference(
			input.context.relationshipJoinMap ?? new Map(),
			input.reference,
		);
		const propertyType = getRelationshipJoinPropertyType(join, propertyPath);

		return buildJsonColumnPropertyExpression({
			propertyPath,
			propertyType,
			targetType: input.targetType,
			base: sql`${joinColumn} -> ${"properties"}`,
		});
	}

	const [column] = input.reference.path;
	if (!column) {
		throw new QueryEngineValidationError("Relationship join reference path must not be empty");
	}
	const propertyType = getRelationshipJoinColumnPropertyType(column);
	if (!propertyType) {
		throw new QueryEngineValidationError(
			`Unsupported relationship join column 'relationship.${input.reference.joinKey}.${column}'`,
		);
	}

	return buildJsonColumnPropertyExpression({
		propertyType,
		base: joinColumn,
		propertyPath: [column],
		targetType: input.targetType,
	});
};
