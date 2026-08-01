import type {
	ColumnExpression,
	CorrelatedQuerySet,
	ScalarExpression,
} from "@ryot/contract/modules/ryotql/language";

import type { CatalogFieldKind } from "./catalog";

export type ScalarKind = CatalogFieldKind | "null";

export type KindResolver<Scope> = {
	readonly column: (expr: ColumnExpression, scope: Scope) => ScalarKind | undefined;
	readonly correlated: (query: CorrelatedQuerySet, scope: Scope) => Scope;
};

const unifyKinds = (kinds: readonly (ScalarKind | undefined)[]) => {
	const nonNullKinds = kinds.filter((kind) => kind !== "null");
	if (nonNullKinds.length === 0) {
		return "null" as const;
	}
	const first = nonNullKinds[0];
	return first !== undefined && nonNullKinds.every((kind) => kind === first) ? first : "json";
};

export const scalarExpressionKind = <Scope>(
	expr: ScalarExpression,
	scope: Scope,
	resolver: KindResolver<Scope>,
): ScalarKind | undefined => {
	if (expr.type === "literal") {
		if (expr.value === null) {
			return "null";
		}
		if (typeof expr.value === "boolean") {
			return "boolean";
		}
		if (typeof expr.value === "number") {
			return "number";
		}
		return typeof expr.value === "string" ? "text" : "json";
	}
	if (expr.type === "cast") {
		return expr.target;
	}
	if (expr.type === "dateBucket") {
		return "date";
	}
	if (expr.type === "jsonPath") {
		return "json";
	}
	if (expr.type === "exists" || expr.type === "isNotNull") {
		return "boolean";
	}
	if (expr.type === "concat" || expr.type === "transform") {
		return "text";
	}
	if (
		expr.type === "aggregate" ||
		expr.type === "arithmetic" ||
		expr.type === "floor" ||
		expr.type === "integer" ||
		expr.type === "round"
	) {
		return "number";
	}
	if (expr.type === "first") {
		return scalarExpressionKind(expr.select, resolver.correlated(expr.query, scope), resolver);
	}
	if (expr.type === "coalesce") {
		return unifyKinds(expr.values.map((value) => scalarExpressionKind(value, scope, resolver)));
	}
	if (expr.type === "conditional") {
		return unifyKinds([
			scalarExpressionKind(expr.whenTrue, scope, resolver),
			scalarExpressionKind(expr.whenFalse, scope, resolver),
		]);
	}
	return resolver.column(expr, scope);
};
