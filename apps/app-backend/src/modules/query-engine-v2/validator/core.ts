import type {
	EntitySourceV2,
	Expr,
	NestedEventSourceV2,
	RootEventSourceV2,
	RelationshipSourceV2,
	SourceV2,
} from "../language";
import {
	MAX_EXPRESSION_SOURCE_DEPTH,
	type AliasScope,
	registerAlias,
	validateFieldSelector,
	validateSchemaList,
} from "./shared";

export const validateExpr = (
	expr: Expr,
	scope: AliasScope,
	aliases: AliasScope,
	expressionSourceDepth = 0,
	allowFirst = false,
	measureKeys: ReadonlySet<string> | null = null,
): string | null => {
	if (expr.type === "literal") {
		return null;
	}

	if (expr.type === "ref") {
		const entry = scope.get(expr.sourceAlias);
		if (!entry) {
			return `Unknown source alias '${expr.sourceAlias}'`;
		}
		return validateFieldSelector(expr.field, entry);
	}

	if (expr.type === "measureRef") {
		if (measureKeys === null) {
			return "Measure references are valid only in aggregate orderBy";
		}
		return measureKeys.has(expr.key) ? null : `Unknown aggregate measure key '${expr.key}'`;
	}

	if (expr.type === "exists") {
		if (expressionSourceDepth + 1 > MAX_EXPRESSION_SOURCE_DEPTH) {
			return `Expression source depth exceeds maximum of ${MAX_EXPRESSION_SOURCE_DEPTH}`;
		}
		const sourceScope = new Map(scope);
		return validateSource(expr.source, sourceScope, aliases, expressionSourceDepth + 1);
	}

	if (expr.type === "aggregate") {
		if (expressionSourceDepth + 1 > MAX_EXPRESSION_SOURCE_DEPTH) {
			return `Expression source depth exceeds maximum of ${MAX_EXPRESSION_SOURCE_DEPTH}`;
		}

		const sourceScope = new Map(scope);
		const sourceError = validateSource(
			expr.source,
			sourceScope,
			aliases,
			expressionSourceDepth + 1,
		);
		if (sourceError) {
			return sourceError;
		}

		if (expr.aggregation.function === "count") {
			return expr.aggregation.distinctBy
				? validateExpr(expr.aggregation.distinctBy, sourceScope, aliases, expressionSourceDepth + 1)
				: null;
		}

		return validateExpr(expr.aggregation.expr, sourceScope, aliases, expressionSourceDepth + 1);
	}

	if (expr.type === "first") {
		if (!allowFirst) {
			return "First expressions are currently valid only as output fields";
		}
		if (expressionSourceDepth + 1 > MAX_EXPRESSION_SOURCE_DEPTH) {
			return `Expression source depth exceeds maximum of ${MAX_EXPRESSION_SOURCE_DEPTH}`;
		}
		if (expr.source.type !== "events") {
			return "First expression currently supports event sources only";
		}
		if (expr.source.where !== null) {
			return "First expression event source does not support where yet";
		}

		const sourceScope = new Map(scope);
		const sourceError = validateSource(
			expr.source,
			sourceScope,
			aliases,
			expressionSourceDepth + 1,
		);
		if (sourceError) {
			return sourceError;
		}

		for (const entry of expr.orderBy) {
			const error = validateExpr(entry.expr, sourceScope, aliases, expressionSourceDepth + 1);
			if (error) {
				return error;
			}
			if (entry.expr.type !== "ref") {
				return "First orderBy currently supports ref expressions only";
			}
			if (
				entry.expr.sourceAlias !== expr.source.alias &&
				entry.expr.sourceAlias !== expr.source.entityRef
			) {
				return `First orderBy cannot reference source alias '${entry.expr.sourceAlias}'`;
			}
		}

		const selectError = validateExpr(expr.select, sourceScope, aliases, expressionSourceDepth + 1);
		if (selectError) {
			return selectError;
		}
		if (expr.select.type === "literal") {
			return null;
		}
		if (expr.select.type !== "ref") {
			return "First select currently supports ref and literal expressions only";
		}
		if (
			expr.select.sourceAlias !== expr.source.alias &&
			expr.select.sourceAlias !== expr.source.entityRef
		) {
			return `First select cannot reference source alias '${expr.select.sourceAlias}'`;
		}
		return null;
	}

	if (expr.type === "comparison") {
		return (
			validateExpr(expr.left, scope, aliases, expressionSourceDepth, false) ??
			validateExpr(expr.right, scope, aliases, expressionSourceDepth, false)
		);
	}

	if (expr.type === "and" || expr.type === "or" || expr.type === "coalesce") {
		for (const value of expr.values) {
			const error = validateExpr(value, scope, aliases, expressionSourceDepth, false);
			if (error) {
				return error;
			}
		}
		return null;
	}

	if (expr.type === "not" || expr.type === "isNull" || expr.type === "isNotNull") {
		return validateExpr(expr.expr, scope, aliases, expressionSourceDepth, false);
	}

	return (
		validateExpr(expr.left, scope, aliases, expressionSourceDepth, false) ??
		validateExpr(expr.right, scope, aliases, expressionSourceDepth, false)
	);
};

export const validateEntitySource = (
	source: EntitySourceV2,
	scope: AliasScope,
	aliases: AliasScope,
	expressionSourceDepth = 0,
) => {
	const schemaError = validateSchemaList(source.schemas);
	if (schemaError) {
		return schemaError;
	}

	if (source.via !== undefined) {
		const anchor = scope.get(source.via.entityRef);
		if (!anchor) {
			return `Unknown source alias '${source.via.entityRef}'`;
		}
		if (anchor.type !== "entitySource") {
			return `Relationship traversal anchor '${source.via.entityRef}' must reference an entity source`;
		}

		const edgeAliasError = registerAlias(
			scope,
			source.via.alias,
			{ type: "relationshipEdge", schemas: [source.via.schema] },
			aliases,
		);
		if (edgeAliasError) {
			return edgeAliasError;
		}
	}

	const aliasError = registerAlias(
		scope,
		source.alias,
		{ type: "entitySource", schemas: source.schemas },
		aliases,
	);
	if (aliasError) {
		return aliasError;
	}

	if (source.where !== null) {
		return validateExpr(source.where, scope, aliases, expressionSourceDepth);
	}

	return null;
};

const validateNestedEventSource = (
	source: NestedEventSourceV2,
	scope: AliasScope,
	aliases: AliasScope,
	expressionSourceDepth = 0,
) => {
	const schemaError = validateSchemaList(source.schemas);
	if (schemaError) {
		return schemaError;
	}

	const entity = scope.get(source.entityRef);
	if (!entity) {
		return `Unknown source alias '${source.entityRef}'`;
	}
	if (entity.type !== "entitySource") {
		return `Event source entityRef '${source.entityRef}' must reference an entity source`;
	}

	const aliasError = registerAlias(
		scope,
		source.alias,
		{ type: "eventSource", schemas: source.schemas },
		aliases,
	);
	if (aliasError) {
		return aliasError;
	}

	if (source.where !== null) {
		return validateExpr(source.where, scope, aliases, expressionSourceDepth);
	}

	return null;
};

export const validateRootEventSource = (
	source: RootEventSourceV2,
	scope: AliasScope,
	aliases: AliasScope,
) => {
	const eventSchemaError = validateSchemaList(source.schemas);
	if (eventSchemaError) {
		return eventSchemaError;
	}

	const entitySchemaError = validateSchemaList(source.entity.schemas);
	if (entitySchemaError) {
		return entitySchemaError;
	}

	const aliasError = registerAlias(
		scope,
		source.alias,
		{ type: "eventSource", schemas: source.schemas },
		aliases,
	);
	if (aliasError) {
		return aliasError;
	}

	const entityAliasError = registerAlias(
		scope,
		source.entity.alias,
		{ type: "entitySource", schemas: source.entity.schemas },
		aliases,
	);
	if (entityAliasError) {
		return entityAliasError;
	}

	if (source.where !== null) {
		return `Root event source '${source.alias}' does not support where yet`;
	}

	return null;
};

export const validateRelationshipSource = (
	source: RelationshipSourceV2,
	scope: AliasScope,
	aliases: AliasScope,
) => {
	const schemaError = validateSchemaList(source.schemas);
	if (schemaError) {
		return schemaError;
	}

	const sourceEntitySchemaError = validateSchemaList(source.sourceEntity.schemas);
	if (sourceEntitySchemaError) {
		return sourceEntitySchemaError;
	}

	const targetEntitySchemaError = validateSchemaList(source.targetEntity.schemas);
	if (targetEntitySchemaError) {
		return targetEntitySchemaError;
	}

	const aliasError = registerAlias(
		scope,
		source.alias,
		{ type: "relationshipEdge", schemas: source.schemas },
		aliases,
	);
	if (aliasError) {
		return aliasError;
	}

	const sourceEntityAliasError = registerAlias(
		scope,
		source.sourceEntity.alias,
		{ type: "entitySource", schemas: source.sourceEntity.schemas },
		aliases,
	);
	if (sourceEntityAliasError) {
		return sourceEntityAliasError;
	}

	const targetEntityAliasError = registerAlias(
		scope,
		source.targetEntity.alias,
		{ type: "entitySource", schemas: source.targetEntity.schemas },
		aliases,
	);
	if (targetEntityAliasError) {
		return targetEntityAliasError;
	}

	if (source.where !== null) {
		return `Root relationship source '${source.alias}' does not support where yet`;
	}

	return null;
};

export const validateSource = (
	source: SourceV2,
	scope: AliasScope,
	aliases: AliasScope,
	expressionSourceDepth = 0,
) =>
	source.type === "entities"
		? validateEntitySource(source, scope, aliases, expressionSourceDepth)
		: validateNestedEventSource(source, scope, aliases, expressionSourceDepth);
