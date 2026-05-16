import { Effect } from "effect";

import type { CurrentDb } from "#lib/db";
import { type BadRequest, type DbError, badRequest } from "#lib/errors";
import type { AppPropertyDefinition, AppSchema } from "#lib/schema/property-schema";

import { loadVisibleEntityPropertySchemas } from "../executor/schema-loaders";
import type { AggregationSpec, Expr, FieldSelector, QueryDocument } from "../language";
import { collectAliasScope } from "./index";
import type { AliasScope, ScopeEntry } from "./shared";

export type CoarseType = "boolean" | "date" | "number" | "string" | "unknown";

export type PropertySchemasBySlug = ReadonlyMap<string, AppSchema>;

type TypeCheckContext = {
	readonly scope: AliasScope;
	readonly propertiesBySlug: PropertySchemasBySlug;
};

const entitySystemTypeMap: Record<string, CoarseType> = {
	id: "string",
	name: "string",
	image: "string",
	createdAt: "date",
	updatedAt: "date",
	externalId: "string",
	sandboxScriptId: "string",
};

const eventSystemTypeMap: Record<string, CoarseType> = {
	id: "string",
	createdAt: "date",
	updatedAt: "date",
	occurredAt: "date",
};

const relationshipSystemTypeMap: Record<string, CoarseType> = {
	id: "string",
	createdAt: "date",
	sourceEntityId: "string",
	targetEntityId: "string",
};

const schemaMetadataTypeMap: Record<string, CoarseType> = {
	name: "string",
	slug: "string",
	isBuiltin: "boolean",
};

const normalizePropertyType = (propertyType: AppPropertyDefinition["type"]): CoarseType => {
	if (propertyType === "boolean") {
		return "boolean";
	}
	if (propertyType === "date" || propertyType === "datetime") {
		return "date";
	}
	if (propertyType === "integer" || propertyType === "number") {
		return "number";
	}
	if (propertyType === "enum" || propertyType === "string") {
		return "string";
	}
	return "unknown";
};

const getPropertyDefinition = (
	schema: AppSchema,
	path: readonly string[],
): AppPropertyDefinition | null => {
	const [head, ...rest] = path;
	if (!head) {
		return null;
	}
	const definition = schema.fields[head];
	if (!definition) {
		return null;
	}

	let current: AppPropertyDefinition = definition;
	for (const segment of rest) {
		if (current.type !== "object") {
			return null;
		}
		const next = current.properties[segment];
		if (!next) {
			return null;
		}
		current = next;
	}
	return current;
};

const unifyTypes = (types: readonly CoarseType[]): CoarseType => {
	const distinct = [...new Set(types)];
	if (distinct.length === 1) {
		return distinct[0] ?? "unknown";
	}
	return "unknown";
};

const inferPropertyType = (
	entry: ScopeEntry,
	selector: Extract<FieldSelector, { type: "property" }>,
	propertiesBySlug: PropertySchemasBySlug,
): CoarseType => {
	if (entry.type !== "entitySource") {
		return "unknown";
	}
	const perSchema = entry.schemas.map((slug): CoarseType => {
		const schema = propertiesBySlug.get(slug);
		if (!schema) {
			return "unknown";
		}
		const definition = getPropertyDefinition(schema, selector.path);
		return definition ? normalizePropertyType(definition.type) : "unknown";
	});
	return unifyTypes(perSchema);
};

const inferRefType = (
	entry: ScopeEntry,
	selector: FieldSelector,
	propertiesBySlug: PropertySchemasBySlug,
): CoarseType => {
	if (selector.type === "schema") {
		return schemaMetadataTypeMap[selector.name] ?? "unknown";
	}
	if (selector.type === "system") {
		const map =
			entry.type === "entitySource"
				? entitySystemTypeMap
				: entry.type === "eventSource"
					? eventSystemTypeMap
					: relationshipSystemTypeMap;
		return map[selector.name] ?? "unknown";
	}
	return inferPropertyType(entry, selector, propertiesBySlug);
};

const inferAggregationType = (aggregation: AggregationSpec): CoarseType =>
	aggregation.function === "count" ? "number" : "unknown";

const inferType = (expr: Expr, context: TypeCheckContext): CoarseType => {
	if (expr.type === "literal") {
		if (expr.valueType === "date") {
			return "date";
		}
		if (typeof expr.value === "boolean") {
			return "boolean";
		}
		if (typeof expr.value === "number") {
			return "number";
		}
		if (typeof expr.value === "string") {
			return "string";
		}
		return "unknown";
	}
	if (expr.type === "ref") {
		const entry = context.scope.get(expr.sourceAlias);
		if (!entry) {
			return "unknown";
		}
		return inferRefType(entry, expr.field, context.propertiesBySlug);
	}
	if (expr.type === "arithmetic") {
		return "number";
	}
	if (
		expr.type === "and" ||
		expr.type === "or" ||
		expr.type === "not" ||
		expr.type === "exists" ||
		expr.type === "isNull" ||
		expr.type === "contains" ||
		expr.type === "isNotNull" ||
		expr.type === "comparison"
	) {
		return "boolean";
	}
	if (expr.type === "aggregate") {
		return inferAggregationType(expr.aggregation);
	}
	if (expr.type === "first") {
		return inferType(expr.select, context);
	}
	if (expr.type === "coalesce") {
		return unifyTypes(expr.values.map((value) => inferType(value, context)));
	}
	return "unknown";
};

const isComparableScalar = (type: CoarseType) =>
	type === "number" || type === "string" || type === "date";

const orderingComparable = (left: CoarseType, right: CoarseType) => {
	if (left === "number" || right === "number") {
		return left === right;
	}
	return isComparableScalar(left) && isComparableScalar(right);
};

const checkExpr = (expr: Expr, context: TypeCheckContext): string | null => {
	if (expr.type === "comparison") {
		const childError = checkExpr(expr.left, context) ?? checkExpr(expr.right, context);
		if (childError) {
			return childError;
		}
		if (expr.operator === "eq" || expr.operator === "neq") {
			return null;
		}
		const left = inferType(expr.left, context);
		const right = inferType(expr.right, context);
		if (left === "unknown" || right === "unknown") {
			return null;
		}
		return orderingComparable(left, right)
			? null
			: `Comparison operands are not type-compatible: ${left} and ${right}`;
	}
	if (expr.type === "arithmetic") {
		const childError = checkExpr(expr.left, context) ?? checkExpr(expr.right, context);
		if (childError) {
			return childError;
		}
		for (const operand of [expr.left, expr.right]) {
			const operandType = inferType(operand, context);
			if (operandType !== "unknown" && operandType !== "number") {
				return `Arithmetic operands must be numeric: ${operandType}`;
			}
		}
		return null;
	}
	if (expr.type === "contains") {
		const childError = checkExpr(expr.left, context) ?? checkExpr(expr.right, context);
		if (childError) {
			return childError;
		}
		const left = inferType(expr.left, context);
		const right = inferType(expr.right, context);
		if (
			isComparableScalar(left) &&
			isComparableScalar(right) &&
			!(left === "string" && right === "string")
		) {
			return `Contains operands are not type-compatible: ${left} and ${right}`;
		}
		return null;
	}
	if (expr.type === "not" || expr.type === "isNull" || expr.type === "isNotNull") {
		return checkExpr(expr.expr, context);
	}
	if (expr.type === "and" || expr.type === "or" || expr.type === "coalesce") {
		for (const value of expr.values) {
			const error = checkExpr(value, context);
			if (error) {
				return error;
			}
		}
		return null;
	}
	if (expr.type === "exists") {
		return expr.source.where ? checkExpr(expr.source.where, context) : null;
	}
	if (expr.type === "first") {
		const sourceWhereError = expr.source.where ? checkExpr(expr.source.where, context) : null;
		if (sourceWhereError) {
			return sourceWhereError;
		}
		for (const orderBy of expr.orderBy) {
			const error = checkExpr(orderBy.expr, context);
			if (error) {
				return error;
			}
		}
		return checkExpr(expr.select, context);
	}
	if (expr.type === "aggregate") {
		const sourceWhereError = expr.source.where ? checkExpr(expr.source.where, context) : null;
		if (sourceWhereError) {
			return sourceWhereError;
		}
		if (expr.aggregation.function === "count") {
			return expr.aggregation.distinctBy ? checkExpr(expr.aggregation.distinctBy, context) : null;
		}
		return checkExpr(expr.aggregation.expr, context);
	}
	return null;
};

const collectDocumentExpressions = (doc: QueryDocument): Expr[] => {
	const expressions: Expr[] = [];
	const pushSourceWhere = (where: Expr | null) => {
		if (where) {
			expressions.push(where);
		}
	};

	const source = doc.source;
	pushSourceWhere(source.where);

	const collectAggregation = (aggregation: AggregationSpec) => {
		if (aggregation.function === "count") {
			if (aggregation.distinctBy) {
				expressions.push(aggregation.distinctBy);
			}
			return;
		}
		expressions.push(aggregation.expr);
	};

	if (doc.output.type === "rows") {
		const walkInclude = (include: NonNullable<typeof doc.output.include>[number]) => {
			pushSourceWhere(include.source.where);
			for (const field of include.fields) {
				expressions.push(field.expr);
			}
			for (const orderBy of include.orderBy) {
				expressions.push(orderBy.expr);
			}
			for (const child of include.include ?? []) {
				walkInclude(child);
			}
		};
		for (const field of doc.output.fields) {
			expressions.push(field.expr);
		}
		for (const orderBy of doc.output.orderBy) {
			expressions.push(orderBy.expr);
		}
		for (const include of doc.output.include ?? []) {
			walkInclude(include);
		}
	} else if (doc.output.type === "aggregate") {
		for (const measure of doc.output.measures) {
			collectAggregation(measure.aggregation);
		}
		for (const groupBy of doc.output.groupBy ?? []) {
			expressions.push(groupBy.expr);
		}
		for (const orderBy of doc.output.orderBy ?? []) {
			expressions.push(orderBy.expr);
		}
	} else {
		expressions.push(doc.output.time.expr);
		collectAggregation(doc.output.measure.aggregation);
	}

	return expressions;
};

export const checkQueryDocumentTypes = (
	scope: AliasScope,
	doc: QueryDocument,
	propertiesBySlug: PropertySchemasBySlug,
): string | null => {
	const context: TypeCheckContext = { scope, propertiesBySlug };
	for (const expr of collectDocumentExpressions(doc)) {
		const error = checkExpr(expr, context);
		if (error) {
			return error;
		}
	}
	return null;
};

const collectEntitySlugs = (scope: AliasScope): string[] => {
	const slugs = new Set<string>();
	for (const entry of scope.values()) {
		if (entry.type === "entitySource") {
			for (const slug of entry.schemas) {
				slugs.add(slug);
			}
		}
	}
	return [...slugs];
};

export const validateQueryDocumentTypeCompatibility = (
	userId: string,
	doc: QueryDocument,
): Effect.Effect<void, BadRequest | DbError, CurrentDb> =>
	Effect.gen(function* () {
		const scope = collectAliasScope(doc);
		const schemas = yield* loadVisibleEntityPropertySchemas(userId, collectEntitySlugs(scope));
		const propertiesBySlug = new Map(
			schemas.map((schema) => [schema.slug, schema.propertiesSchema] as const),
		);
		const error = checkQueryDocumentTypes(scope, doc, propertiesBySlug);
		return error ? yield* badRequest(error) : undefined;
	});
