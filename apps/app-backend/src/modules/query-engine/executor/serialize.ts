import { Effect } from "effect";

import type { CurrentDb } from "#lib/db";
import type { BadRequest, DbError, NotFound } from "#lib/errors";

import type {
	Expr,
	RelationshipSource,
	RootEventSource,
	RowItem,
	RowValue,
	RowsOutput,
} from "../language";
import {
	makeEntityContext,
	makeEventRootContext,
	makeRelationshipRootContext,
	relationshipEntityRow,
} from "./context";
import { evalExprValue } from "./expr";
import {
	evalEventFieldSelector,
	evalExprForField,
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

export const serializeRow = (row: EntityQueryRow, fields: RowsOutput["fields"]): RowItem => {
	const result: Record<string, RowValue> = {};
	for (const field of fields) {
		result[field.key] = evalExprForField(field.expr, row);
	}
	return result;
};

export const serializeRootRow = (
	userId: string,
	row: EntityQueryRow,
	entityAlias: string,
	fields: RowsOutput["fields"],
): Effect.Effect<RowItem, BadRequest | NotFound | DbError, CurrentDb> =>
	Effect.gen(function* () {
		const result: Record<string, RowValue> = {};
		for (const field of fields) {
			result[field.key] = yield* evalRootExprForField(userId, field.expr, row, entityAlias);
		}
		return result;
	});

export const serializeEventRootRow = (
	userId: string,
	row: EventQueryRow,
	source: RootEventSource,
	fields: RowsOutput["fields"],
): Effect.Effect<RowItem, BadRequest | NotFound | DbError, CurrentDb> =>
	Effect.gen(function* () {
		const result: Record<string, RowValue> = {};
		for (const field of fields) {
			result[field.key] = yield* evalEventRootExprForField(userId, field.expr, row, source);
		}
		return result;
	});

export const serializeRelationshipRootRow = (
	userId: string,
	row: RelationshipRootQueryRow,
	source: RelationshipSource,
	fields: RowsOutput["fields"],
): Effect.Effect<RowItem, BadRequest | NotFound | DbError, CurrentDb> =>
	Effect.gen(function* () {
		const result: Record<string, RowValue> = {};
		for (const field of fields) {
			result[field.key] = yield* evalRelationshipRootExprForField(userId, field.expr, row, source);
		}
		return result;
	});
