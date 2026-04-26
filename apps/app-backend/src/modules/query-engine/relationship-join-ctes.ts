import { sql } from "drizzle-orm";
import { Match } from "effect";

import { schema } from "~/lib/db";
import type { QueryExpression } from "~/lib/query-language";
import { QueryEngineValidationError } from "~/lib/views/errors";
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
	reference: Extract<QueryExpression, { type: "reference" }>["reference"] & {
		type: "relationship-join";
	};
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
			base: sql`${schema.relationship.properties}`,
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

	const baseColumn = Match.value(column).pipe(
		Match.when("id", () => schema.relationship.id),
		Match.when("createdAt", () => schema.relationship.createdAt),
		Match.when("sourceEntityId", () => schema.relationship.sourceEntityId),
		Match.when("targetEntityId", () => schema.relationship.targetEntityId),
		Match.orElse(() => {
			throw new QueryEngineValidationError(
				`Unsupported relationship join column 'relationship.${input.reference.joinKey}.${column}'`,
			);
		}),
	);

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

	const getTypeInfo = (expression: QueryExpression) => {
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
		input.join.direction === "outgoing"
			? schema.relationship.sourceEntityId
			: schema.relationship.targetEntityId;

	const sourceEntityIdFilter = input.join.sourceEntityId
		? sql`and ${schema.relationship.sourceEntityId} = ${input.join.sourceEntityId}`
		: sql``;
	const targetEntityIdFilter = input.join.targetEntityId
		? sql`and ${schema.relationship.targetEntityId} = ${input.join.targetEntityId}`
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
					'id', ${schema.relationship.id},
					'createdAt', ${schema.relationship.createdAt},
					'sourceEntityId', ${schema.relationship.sourceEntityId},
					'targetEntityId', ${schema.relationship.targetEntityId},
					'properties', ${schema.relationship.properties},
					'sourceEntity', ${buildEntityDataObjectExpression(sourceAlias)},
					'targetEntity', ${buildEntityDataObjectExpression(targetAlias)}
				) as latest_relationship
			from ${schema.relationship}
			left join ${schema.entity} ${sql.raw(sourceAlias)} on ${schema.relationship.sourceEntityId} = ${sql.raw(`${sourceAlias}.id`)}
			left join ${schema.entity} ${sql.raw(targetAlias)} on ${schema.relationship.targetEntityId} = ${sql.raw(`${targetAlias}.id`)}
			where ${schema.relationship.relationshipSchemaId} = ${input.join.schemaId}
				and (${schema.relationship.userId} = ${input.userId} or ${schema.relationship.userId} is null)
				${sourceEntityIdFilter}
				${targetEntityIdFilter}
				${joinLocalFilterClause}
			order by ${entityIdColumn}, ${schema.relationship.createdAt} desc, ${schema.relationship.id} desc
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
