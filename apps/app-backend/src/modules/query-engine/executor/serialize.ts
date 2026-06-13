import { Effect } from "effect";

import type { CurrentDb } from "#lib/db";
import type { BadRequest, DbError, NotFound } from "#lib/errors";

import type { Expr, RelationshipSource, RootEventSource, RowValue, RowsOutput } from "../language";
import {
	makeEntityContext,
	makeEventRootContext,
	makeRelationshipRootContext,
	relationshipEntityRow,
} from "./context";
import { evalExprValue } from "./expr";
import {
	evalEventFieldSelector,
	evalFieldSelector,
	evalRelationshipFieldSelector,
	literalToFieldValue,
} from "./field-values";
import type { EntityQueryRow, EventQueryRow, RelationshipRootQueryRow } from "./types";

const evalRootExprForField = (
	userId: string,
	expr: Expr,
	row: EntityQueryRow,
	entityAlias: string,
): Effect.Effect<RowValue, BadRequest | NotFound | DbError, CurrentDb> =>
	evalExprValue(userId, expr, makeEntityContext(entityAlias, row));

const evalEventRootExprForField = (
	userId: string,
	expr: Expr,
	row: EventQueryRow,
	source: RootEventSource,
): Effect.Effect<RowValue, BadRequest | NotFound | DbError, CurrentDb> => {
	if (expr.type === "ref" && expr.sourceAlias === source.alias) {
		return Effect.succeed(evalEventFieldSelector(expr.field, row));
	}
	if (expr.type === "ref" && expr.sourceAlias === source.entity.alias) {
		return Effect.succeed(evalFieldSelector(expr.field, row));
	}
	if (expr.type === "literal") {
		return Effect.succeed(literalToFieldValue(expr));
	}
	return evalExprValue(userId, expr, makeEventRootContext(source, row));
};

const evalRelationshipRootExprForField = (
	userId: string,
	expr: Expr,
	row: RelationshipRootQueryRow,
	source: RelationshipSource,
): Effect.Effect<RowValue, BadRequest | NotFound | DbError, CurrentDb> => {
	if (expr.type === "ref" && expr.sourceAlias === source.alias) {
		return Effect.succeed(evalRelationshipFieldSelector(expr.field, row));
	}
	if (expr.type === "ref" && expr.sourceAlias === source.sourceEntity.alias) {
		return Effect.succeed(evalFieldSelector(expr.field, relationshipEntityRow(row.sourceEntity)));
	}
	if (expr.type === "ref" && expr.sourceAlias === source.targetEntity.alias) {
		return Effect.succeed(evalFieldSelector(expr.field, relationshipEntityRow(row.targetEntity)));
	}
	if (expr.type === "literal") {
		return Effect.succeed(literalToFieldValue(expr));
	}
	return evalExprValue(userId, expr, makeRelationshipRootContext(source, row));
};

export const serializeRootRow = Effect.fn("serializeRootRow")(function* (
	userId: string,
	row: EntityQueryRow,
	entityAlias: string,
	fields: RowsOutput["fields"],
) {
	const result: Record<string, RowValue> = {};
	for (const field of fields) {
		result[field.key] = yield* evalRootExprForField(userId, field.expr, row, entityAlias);
	}
	return result;
});

export const serializeEventRootRow = Effect.fn("serializeEventRootRow")(function* (
	userId: string,
	row: EventQueryRow,
	source: RootEventSource,
	fields: RowsOutput["fields"],
) {
	const result: Record<string, RowValue> = {};
	for (const field of fields) {
		result[field.key] = yield* evalEventRootExprForField(userId, field.expr, row, source);
	}
	return result;
});

export const serializeRelationshipRootRow = Effect.fn("serializeRelationshipRootRow")(function* (
	userId: string,
	row: RelationshipRootQueryRow,
	source: RelationshipSource,
	fields: RowsOutput["fields"],
) {
	const result: Record<string, RowValue> = {};
	for (const field of fields) {
		result[field.key] = yield* evalRelationshipRootExprForField(userId, field.expr, row, source);
	}
	return result;
});
