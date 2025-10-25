import type { RuntimeRef } from "@ryot/ts-utils/view-language";
import { sql } from "drizzle-orm";
import { match } from "ts-pattern";

import { entity, relationship } from "~/lib/db/schema";
import { QueryEngineValidationError } from "~/lib/views/errors";
import type { ViewExpression } from "~/lib/views/expression";
import {
	inferViewExpressionType,
	normalizeExpressionPropertyType,
} from "~/lib/views/expression-analysis";
import type { PropertyType } from "~/lib/views/reference";
import {
	getRelationshipJoinColumnPropertyType,
	getRelationshipJoinPropertyType,
} from "~/lib/views/reference";

import type { LoadedRelationshipJoin } from "./context";
import { createExpressionCompilerCore, type ExpressionCompiler } from "./expression-compiler";
import { buildPredicateClause } from "./predicate-clause-builder";
import { buildEntityDataObjectExpression } from "./query-cte-shared";
import {
	buildCastedValueExpression,
	buildJsonColumnPropertyExpression,
	getRelationshipJoinCteName,
	getRelationshipJoinColumnName,
	sanitizeIdentifier,
	type SqlExpression,
} from "./sql-expression-helpers";

const buildRelationshipJoinLocalExpression = (input: {
	targetType?: PropertyType;
	join: LoadedRelationshipJoin;
	reference: Extract<RuntimeRef, { type: "relationship-join" }>;
}) => {
	const [pathRoot] = input.reference.path;

	if (pathRoot === "sourceEntity" || pathRoot === "targetEntity") {
		throw new QueryEngineValidationError(
			`Join-local filter cannot reference related entity data '${pathRoot}' on join '${input.reference.joinKey}'`,
		);
	}

	if (pathRoot === "properties") {
		const propertyPath = input.reference.path.slice(1);
		const propertyType = getRelationshipJoinPropertyType(input.join, propertyPath);
		return buildJsonColumnPropertyExpression({
			propertyPath,
			propertyType,
			targetType: input.targetType,
			base: sql`${relationship.properties}`,
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

	const baseColumn = match(column)
		.with("id", () => relationship.id)
		.with("createdAt", () => relationship.createdAt)
		.with("sourceEntityId", () => relationship.sourceEntityId)
		.with("targetEntityId", () => relationship.targetEntityId)
		.otherwise(() => {
			throw new QueryEngineValidationError(
				`Unsupported relationship join column 'relationship.${input.reference.joinKey}.${column}'`,
			);
		});

	return buildCastedValueExpression(
		input.targetType ?? normalizeExpressionPropertyType(propertyType),
		{
			propertyJson: sql`${baseColumn}`,
			propertyText: sql`${baseColumn}`,
		},
	);
};

const createJoinLocalFilterCompiler = (join: LoadedRelationshipJoin): ExpressionCompiler => {
	const relationshipJoinMap = new Map([[join.key, join]]);

	const getTypeInfo = (expression: ViewExpression) => {
		return inferViewExpressionType({
			expression,
			context: { relationshipJoinMap, schemaMap: new Map(), eventJoinMap: new Map() },
		});
	};

	return createExpressionCompilerCore({
		getTypeInfo,
		resolveReference: ({ reference, targetType }) => {
			if (reference.type !== "relationship-join") {
				throw new QueryEngineValidationError(
					`Join-local filter may only reference the current relationship join, received '${reference.type}'`,
				);
			}

			if (reference.joinKey !== join.key) {
				throw new QueryEngineValidationError(
					`Join-local filter cannot reference relationship join '${reference.joinKey}'`,
				);
			}

			return buildRelationshipJoinLocalExpression({ join, reference, targetType });
		},
	});
};

export const buildLatestRelationshipJoinCte = (input: {
	join: LoadedRelationshipJoin;
	userId: string;
}) => {
	const safeKey = sanitizeIdentifier(input.join.key, "relationship join key");
	const sourceAlias = `rj_${safeKey}_se`;
	const targetAlias = `rj_${safeKey}_te`;

	const entityIdColumn =
		input.join.direction === "outgoing" ? relationship.sourceEntityId : relationship.targetEntityId;

	const sourceEntityIdFilter = input.join.sourceEntityId
		? sql`and ${relationship.sourceEntityId} = ${input.join.sourceEntityId}`
		: sql``;
	const targetEntityIdFilter = input.join.targetEntityId
		? sql`and ${relationship.targetEntityId} = ${input.join.targetEntityId}`
		: sql``;

	const joinLocalFilterClause = input.join.filter
		? sql`and ${buildPredicateClause({
				predicate: input.join.filter,
				compiler: createJoinLocalFilterCompiler(input.join),
			})}`
		: sql``;

	return sql`
		${sql.raw(getRelationshipJoinCteName(input.join.key))} as (
			select distinct on (${entityIdColumn})
				${entityIdColumn} as entity_id,
				jsonb_build_object(
					'id', ${relationship.id},
					'createdAt', ${relationship.createdAt},
					'sourceEntityId', ${relationship.sourceEntityId},
					'targetEntityId', ${relationship.targetEntityId},
					'properties', ${relationship.properties},
					'sourceEntity', ${buildEntityDataObjectExpression(sourceAlias)},
					'targetEntity', ${buildEntityDataObjectExpression(targetAlias)}
				) as latest_relationship
			from ${relationship}
			left join ${entity} ${sql.raw(sourceAlias)} on ${relationship.sourceEntityId} = ${sql.raw(`${sourceAlias}.id`)}
			left join ${entity} ${sql.raw(targetAlias)} on ${relationship.targetEntityId} = ${sql.raw(`${targetAlias}.id`)}
			where ${relationship.relationshipSchemaId} = ${input.join.schemaId}
				and (${relationship.userId} = ${input.userId} or ${relationship.userId} is null)
				${sourceEntityIdFilter}
				${targetEntityIdFilter}
				${joinLocalFilterClause}
			order by ${entityIdColumn}, ${relationship.createdAt} desc, ${relationship.id} desc
		)
	`;
};

export const buildRequiredJoinWhereClause = (
	relationshipJoins: LoadedRelationshipJoin[],
): SqlExpression | null => {
	const requiredJoins = relationshipJoins.filter((j) => j.required);
	if (!requiredJoins.length) {
		return null;
	}

	const conditions = requiredJoins.map((join) => {
		return sql`${sql.raw(getRelationshipJoinColumnName(join.key))} is not null`;
	});

	return sql.join(conditions, sql` and `);
};
