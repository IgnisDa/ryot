import type { RuntimeRef } from "@ryot/ts-utils";
import { sql } from "drizzle-orm";
import { match } from "ts-pattern";

import { entity, relationship } from "~/lib/db/schema";
import { QueryEngineValidationError } from "~/lib/views/errors";
import type { ViewExpression } from "~/lib/views/expression";
import {
	assertConcatCompatibleExpression,
	assertNumericExpression,
	inferViewExpressionType,
	normalizeExpressionPropertyType,
	type ViewExpressionTypeInfo,
} from "~/lib/views/expression-analysis";
import type { PropertyType } from "~/lib/views/reference";
import {
	getRelationshipJoinColumnPropertyType,
	getRelationshipJoinPropertyType,
} from "~/lib/views/reference";

import type { LoadedRelationshipJoin } from "./context";
import type { ExpressionCompiler } from "./expression-compiler";
import { buildPredicateClause } from "./predicate-clause-builder";
import {
	buildCastedValueExpression,
	buildCoalescedExpression,
	buildIntegerNormalizationExpression,
	buildJsonColumnPropertyExpression,
	buildJsonNullNormalizedExpression,
	buildLiteralExpression,
	buildTextValueExpression,
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

	const getTypeInfo = (expression: ViewExpression): ViewExpressionTypeInfo => {
		return inferViewExpressionType({
			expression,
			context: { relationshipJoinMap, schemaMap: new Map(), eventJoinMap: new Map() },
		});
	};

	const compile = (expression: ViewExpression, targetType?: PropertyType): SqlExpression => {
		return match(expression)
			.with({ type: "literal" }, (expr) =>
				buildLiteralExpression({ literalType: expr.literalType, value: expr.value }, targetType),
			)
			.with({ type: "reference" }, (expr) => {
				if (expr.reference.type !== "relationship-join") {
					throw new QueryEngineValidationError(
						`Join-local filter may only reference the current relationship join, received '${expr.reference.type}'`,
					);
				}
				if (expr.reference.joinKey !== join.key) {
					throw new QueryEngineValidationError(
						`Join-local filter cannot reference relationship join '${expr.reference.joinKey}'`,
					);
				}
				return buildRelationshipJoinLocalExpression({
					join,
					targetType,
					reference: expr.reference,
				});
			})
			.with({ type: "coalesce" }, (expr) => {
				const typeInfo = getTypeInfo(expr);
				const coalesceTargetType =
					targetType ?? (typeInfo.kind === "property" ? typeInfo.propertyType : undefined);
				return buildCoalescedExpression(
					expr.values.map((value) => {
						const compiledValue = compile(value, coalesceTargetType);
						return buildJsonNullNormalizedExpression({
							expression: compiledValue,
							targetType: coalesceTargetType,
							typeInfo: getTypeInfo(value),
						});
					}),
				);
			})
			.with({ type: "arithmetic" }, (expr) => {
				const leftType = getTypeInfo(expr.left);
				const rightType = getTypeInfo(expr.right);
				assertNumericExpression(leftType, "Arithmetic");
				assertNumericExpression(rightType, "Arithmetic");
				const arithmeticTargetType =
					targetType ??
					(expr.operator === "divide" ||
					(leftType.kind === "property" && leftType.propertyType === "number") ||
					(rightType.kind === "property" && rightType.propertyType === "number")
						? "number"
						: "integer");
				const left = compile(expr.left, arithmeticTargetType);
				const right = compile(expr.right, arithmeticTargetType);

				return match(expr.operator)
					.with("add", () => sql`(${left}) + (${right})`)
					.with("subtract", () => sql`(${left}) - (${right})`)
					.with("multiply", () => sql`(${left}) * (${right})`)
					.with("divide", () => sql`(${left}) / nullif((${right}), 0)`)
					.exhaustive();
			})
			.with({ type: "round" }, (expr) => {
				const expressionType = getTypeInfo(expr.expression);
				assertNumericExpression(expressionType, "Numeric normalization");
				const compiled = compile(expr.expression, "number");
				return sql`round(${compiled})::integer`;
			})
			.with({ type: "floor" }, (expr) => {
				const expressionType = getTypeInfo(expr.expression);
				assertNumericExpression(expressionType, "Numeric normalization");
				const compiled = compile(expr.expression, "number");
				return sql`floor(${compiled})::integer`;
			})
			.with({ type: "integer" }, (expr) => {
				const expressionType = getTypeInfo(expr.expression);
				assertNumericExpression(expressionType, "Numeric normalization");
				return buildIntegerNormalizationExpression(compile(expr.expression, "number"));
			})
			.with({ type: "concat" }, (expr) => {
				for (const value of expr.values) {
					assertConcatCompatibleExpression(getTypeInfo(value));
				}
				return sql`concat(${sql.join(
					expr.values.map((value) => buildTextValueExpression(compile(value))),
					sql`, `,
				)})`;
			})
			.with({ type: "transform" }, (expr) => {
				assertConcatCompatibleExpression(getTypeInfo(expr.expression));
				const textExpr = buildTextValueExpression(compile(expr.expression));
				return match(expr.name)
					.with("titleCase", () => sql`initcap(replace(replace(${textExpr}, '_', ' '), '-', ' '))`)
					.with("kebabCase", () => sql`lower(replace(replace(${textExpr}, '_', '-'), ' ', '-'))`)
					.exhaustive();
			})
			.with({ type: "conditional" }, (expr) => {
				const typeInfo = getTypeInfo(expr);
				const conditionalTargetType =
					targetType ?? (typeInfo.kind === "property" ? typeInfo.propertyType : undefined);
				const predicate = buildPredicateClause({
					predicate: expr.condition,
					compiler: { compile, getTypeInfo },
				});
				const whenTrue = compile(expr.whenTrue, conditionalTargetType);
				const whenFalse = compile(expr.whenFalse, conditionalTargetType);
				return sql`case when ${predicate} then ${whenTrue} else ${whenFalse} end`;
			})
			.exhaustive();
	};

	return { compile, getTypeInfo };
};

const buildRelatedEntityDataObject = (alias: string) =>
	sql`jsonb_build_object(
		'id', ${sql.raw(`${alias}.id`)},
		'name', ${sql.raw(`${alias}.name`)},
		'image', ${sql.raw(`${alias}.image`)},
		'createdAt', ${sql.raw(`${alias}.created_at`)},
		'updatedAt', ${sql.raw(`${alias}.updated_at`)},
		'externalId', ${sql.raw(`${alias}.external_id`)},
		'sandboxScriptId', ${sql.raw(`${alias}.sandbox_script_id`)},
		'properties', ${sql.raw(`${alias}.properties`)}
	)`;

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
					'sourceEntity', ${buildRelatedEntityDataObject(sourceAlias)},
					'targetEntity', ${buildRelatedEntityDataObject(targetAlias)}
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
