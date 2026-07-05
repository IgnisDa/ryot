import type { DbError, NotFound } from "@ryot/contract/errors";
import type {
	Expr,
	IncludeEntry,
	QueryDocument,
	RelationshipSource,
	RootEventSource,
	Source,
} from "@ryot/contract/modules/query-engine/language";
import { Effect } from "effect";

import type { CurrentDb } from "#lib/infrastructure/db/service";
import type { DefinitionRegistry } from "#modules/definition-registry/service";

import {
	loadVisibleEntitySchemas,
	loadVisibleEventSchemasForEntitySchemas,
	loadVisibleRelationshipSchema,
	loadVisibleRelationshipSchemas,
} from "../executor/schema-loaders";
import { validateQueryDocumentTypeCompatibility } from "./type-check";

type EntityAliasSchemas = ReadonlyMap<string, readonly string[]>;
type ValidationEffect = Effect.Effect<void, NotFound | DbError, CurrentDb | DefinitionRegistry>;

const validateExpr = (userId: string, expr: Expr, aliases: EntityAliasSchemas): ValidationEffect =>
	Effect.gen(function* () {
		switch (expr.type) {
			case "ref":
			case "literal":
			case "measureRef":
				return;
			case "not":
			case "isNull":
			case "isNotNull":
				yield* validateExpr(userId, expr.expr, aliases);
				return;
			case "or":
			case "and":
			case "coalesce":
				for (const value of expr.values) {
					yield* validateExpr(userId, value, aliases);
				}
				return;
			case "contains":
			case "arithmetic":
			case "comparison":
				yield* validateExpr(userId, expr.left, aliases);
				yield* validateExpr(userId, expr.right, aliases);
				return;
			case "exists":
				yield* validateSource(userId, expr.source, aliases);
				return;
			case "aggregate": {
				const nextAliases = yield* validateSource(userId, expr.source, aliases);
				if ("expr" in expr.aggregation) {
					yield* validateExpr(userId, expr.aggregation.expr, nextAliases);
				}
				if ("distinctBy" in expr.aggregation && expr.aggregation.distinctBy) {
					yield* validateExpr(userId, expr.aggregation.distinctBy, nextAliases);
				}
				return;
			}
			case "first": {
				const nextAliases = yield* validateSource(userId, expr.source, aliases);
				yield* validateExpr(userId, expr.select, nextAliases);
				for (const orderBy of expr.orderBy) {
					yield* validateExpr(userId, orderBy.expr, nextAliases);
				}
				return;
			}
		}
	});

const validateSource = Effect.fn("validateSource")(function* (
	userId: string,
	source: Source,
	aliases: EntityAliasSchemas,
) {
	if (source.type === "events") {
		const entitySchemaSlugs = aliases.get(source.entityRef) ?? [];
		yield* loadVisibleEventSchemasForEntitySchemas(userId, entitySchemaSlugs, source.schemas);
		if (source.where) {
			yield* validateExpr(userId, source.where, aliases);
		}
		return aliases;
	}

	const visibleSchemas = yield* loadVisibleEntitySchemas(userId, source.schemas);
	if (source.via) {
		yield* loadVisibleRelationshipSchema(userId, source.via.schema);
	}

	const nextAliases = new Map(aliases);
	nextAliases.set(
		source.alias,
		visibleSchemas.map((schema) => schema.id),
	);
	if (source.where) {
		yield* validateExpr(userId, source.where, nextAliases);
	}

	return nextAliases;
});

const validateRootEventSource = Effect.fn("validateRootEventSource")(function* (
	userId: string,
	source: RootEventSource,
) {
	const entitySchemas = yield* loadVisibleEntitySchemas(userId, source.entity.schemas);
	const entitySchemaSlugs = entitySchemas.map((schema) => schema.id);
	yield* loadVisibleEventSchemasForEntitySchemas(userId, entitySchemaSlugs, source.schemas);
	const aliases = new Map<string, readonly string[]>([[source.entity.alias, entitySchemaSlugs]]);
	if (source.where) {
		yield* validateExpr(userId, source.where, aliases);
	}
	return aliases;
});

const validateRelationshipRootSource = Effect.fn("validateRelationshipRootSource")(function* (
	userId: string,
	source: RelationshipSource,
) {
	yield* loadVisibleRelationshipSchemas(userId, source.schemas);
	const sourceEntitySchemas = yield* loadVisibleEntitySchemas(userId, source.sourceEntity.schemas);
	const targetEntitySchemas = yield* loadVisibleEntitySchemas(userId, source.targetEntity.schemas);
	const aliases = new Map<string, readonly string[]>([
		[source.sourceEntity.alias, sourceEntitySchemas.map((schema) => schema.id)],
		[source.targetEntity.alias, targetEntitySchemas.map((schema) => schema.id)],
	]);
	if (source.where) {
		yield* validateExpr(userId, source.where, aliases);
	}
	return aliases;
});

const validateRootSource = (userId: string, doc: QueryDocument) => {
	const source = doc.source;
	if (source.type === "events") {
		return validateRootEventSource(userId, source);
	}
	if (source.type === "relationships") {
		return validateRelationshipRootSource(userId, source);
	}
	return validateSource(userId, source, new Map());
};

const validateInclude = (
	userId: string,
	include: IncludeEntry,
	aliases: EntityAliasSchemas,
): ValidationEffect =>
	Effect.gen(function* () {
		const nextAliases = yield* validateSource(userId, include.source, aliases);
		for (const field of include.fields) {
			yield* validateExpr(userId, field.expr, nextAliases);
		}
		for (const orderBy of include.orderBy) {
			yield* validateExpr(userId, orderBy.expr, nextAliases);
		}
		for (const child of include.include ?? []) {
			yield* validateInclude(userId, child, nextAliases);
		}
	});

const validateQueryDocumentReferences = Effect.fn("validateQueryDocumentReferences")(function* (
	userId: string,
	doc: QueryDocument,
) {
	const aliases = yield* validateRootSource(userId, doc);

	if (doc.output.type === "rows") {
		for (const field of doc.output.fields) {
			yield* validateExpr(userId, field.expr, aliases);
		}
		for (const orderBy of doc.output.orderBy) {
			yield* validateExpr(userId, orderBy.expr, aliases);
		}
		for (const include of doc.output.include ?? []) {
			yield* validateInclude(userId, include, aliases);
		}
		return;
	}

	if (doc.output.type === "aggregate") {
		for (const measure of doc.output.measures) {
			if ("expr" in measure.aggregation) {
				yield* validateExpr(userId, measure.aggregation.expr, aliases);
			}
			if ("distinctBy" in measure.aggregation && measure.aggregation.distinctBy) {
				yield* validateExpr(userId, measure.aggregation.distinctBy, aliases);
			}
		}
		for (const groupBy of doc.output.groupBy ?? []) {
			yield* validateExpr(userId, groupBy.expr, aliases);
		}
		for (const orderBy of doc.output.orderBy ?? []) {
			yield* validateExpr(userId, orderBy.expr, aliases);
		}
		return;
	}

	if ("expr" in doc.output.measure.aggregation) {
		yield* validateExpr(userId, doc.output.measure.aggregation.expr, aliases);
	}
	yield* validateExpr(userId, doc.output.time.expr, aliases);
});

export const validateQueryDocumentReferencesAndTypes = Effect.fn(
	"validateQueryDocumentReferencesAndTypes",
)(function* (userId: string, doc: QueryDocument) {
	yield* validateQueryDocumentReferences(userId, doc);
	yield* validateQueryDocumentTypeCompatibility(userId, doc);
});
