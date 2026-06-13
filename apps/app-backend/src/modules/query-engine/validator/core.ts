import type {
	EntitySource,
	Expr,
	NestedEventSource,
	RootEventSource,
	RelationshipSource,
	Source,
} from "../language";
import {
	MAX_EXPRESSION_SOURCE_DEPTH,
	type AliasScope,
	registerAlias,
	validateFieldSelector,
	validateSchemaList,
} from "./shared";

const firstSourceAliases = (source: Source): ReadonlySet<string> =>
	source.type === "events"
		? new Set([source.alias, source.entityRef])
		: new Set(
				source.via === undefined
					? [source.alias]
					: [source.alias, source.via.alias, source.via.entityRef],
			);

export const validateExpr = (
	expr: Expr,
	scope: AliasScope,
	aliases: AliasScope,
	expressionSourceDepth = 0,
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
		if (expressionSourceDepth + 1 > MAX_EXPRESSION_SOURCE_DEPTH) {
			return `Expression source depth exceeds maximum of ${MAX_EXPRESSION_SOURCE_DEPTH}`;
		}
		if (expr.source.where !== null) {
			return "First expression source does not support where yet";
		}
		if (expr.source.type === "entities" && expr.source.via === undefined) {
			return `First expression entity source '${expr.source.alias}' must specify via`;
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

		const allowedAliases = firstSourceAliases(expr.source);
		for (const entry of expr.orderBy) {
			const error = validateExpr(entry.expr, sourceScope, aliases, expressionSourceDepth + 1);
			if (error) {
				return error;
			}
			if (entry.expr.type !== "ref") {
				return "First orderBy currently supports ref expressions only";
			}
			if (!allowedAliases.has(entry.expr.sourceAlias)) {
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
		if (!allowedAliases.has(expr.select.sourceAlias)) {
			return `First select cannot reference source alias '${expr.select.sourceAlias}'`;
		}
		return null;
	}

	if (expr.type === "arithmetic" || expr.type === "comparison") {
		return (
			validateExpr(expr.left, scope, aliases, expressionSourceDepth) ??
			validateExpr(expr.right, scope, aliases, expressionSourceDepth)
		);
	}

	if (expr.type === "and" || expr.type === "or" || expr.type === "coalesce") {
		for (const value of expr.values) {
			const error = validateExpr(value, scope, aliases, expressionSourceDepth);
			if (error) {
				return error;
			}
		}
		return null;
	}

	if (expr.type === "not" || expr.type === "isNull" || expr.type === "isNotNull") {
		return validateExpr(expr.expr, scope, aliases, expressionSourceDepth);
	}

	return (
		validateExpr(expr.left, scope, aliases, expressionSourceDepth) ??
		validateExpr(expr.right, scope, aliases, expressionSourceDepth)
	);
};

export const validateEntitySource = (
	source: EntitySource,
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

export const validateNestedEventSource = (
	source: NestedEventSource,
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
	source: RootEventSource,
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
		return validateExpr(source.where, scope, aliases);
	}

	return null;
};

export const validateRelationshipSource = (
	source: RelationshipSource,
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

	return source.where !== null ? validateExpr(source.where, scope, aliases) : null;
};

const validateSource = (
	source: Source,
	scope: AliasScope,
	aliases: AliasScope,
	expressionSourceDepth = 0,
) =>
	source.type === "entities"
		? validateEntitySource(source, scope, aliases, expressionSourceDepth)
		: validateNestedEventSource(source, scope, aliases, expressionSourceDepth);
