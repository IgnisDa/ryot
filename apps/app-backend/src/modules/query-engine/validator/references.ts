import type { NotFound } from "@ryot/contract/errors";
import type {
	Expr,
	IncludeEntry,
	QueryDocument,
	RelationshipSource,
	RootEventSource,
	Source,
} from "@ryot/contract/modules/query-engine/language";
import { Effect } from "effect";

import type { DefinitionRegistry } from "#modules/definition-registry/service";

import type { QueryExecutionScope } from "../execution-scope";
import {
	loadVisibleEntitySchemas,
	loadVisibleEventSchemasForEntitySchemas,
	loadRelationshipEndpointEntitySchemas,
} from "../executor/schema-loaders";
import { validateQueryDocumentTypeCompatibility } from "./type-check";

type EntityAliasSchemas = ReadonlyMap<string, readonly string[]>;
type ValidationEffect = Effect.Effect<void, NotFound, DefinitionRegistry>;

const isNonEmpty = (schemas: readonly string[]): schemas is readonly [string, ...string[]] =>
	schemas.length > 0;

const validateExpr = (
	executionScope: QueryExecutionScope,
	expr: Expr,
	aliases: EntityAliasSchemas,
): ValidationEffect =>
	Effect.gen(function* () {
		switch (expr.type) {
			case "ref":
			case "literal":
			case "measureRef":
				return;
			case "not":
			case "isNull":
			case "isNotNull":
				yield* validateExpr(executionScope, expr.expr, aliases);
				return;
			case "or":
			case "and":
			case "coalesce":
				for (const value of expr.values) {
					yield* validateExpr(executionScope, value, aliases);
				}
				return;
			case "contains":
			case "arithmetic":
			case "comparison":
				yield* validateExpr(executionScope, expr.left, aliases);
				yield* validateExpr(executionScope, expr.right, aliases);
				return;
			case "exists":
				yield* validateSource(executionScope, expr.source, aliases);
				return;
			case "aggregate": {
				const nextAliases = yield* validateSource(executionScope, expr.source, aliases);
				if ("expr" in expr.aggregation) {
					yield* validateExpr(executionScope, expr.aggregation.expr, nextAliases);
				}
				if ("distinctBy" in expr.aggregation && expr.aggregation.distinctBy) {
					yield* validateExpr(executionScope, expr.aggregation.distinctBy, nextAliases);
				}
				return;
			}
			case "first": {
				const nextAliases = yield* validateSource(executionScope, expr.source, aliases);
				yield* validateExpr(executionScope, expr.select, nextAliases);
				for (const orderBy of expr.orderBy) {
					yield* validateExpr(executionScope, orderBy.expr, nextAliases);
				}
				return;
			}
		}
	});

const validateSource = Effect.fn("validateSource")(function* (
	executionScope: QueryExecutionScope,
	source: Source,
	aliases: EntityAliasSchemas,
) {
	if (source.type === "events") {
		const entitySchemaSlugs = aliases.get(source.entityRef) ?? [];
		yield* loadVisibleEventSchemasForEntitySchemas(
			executionScope,
			entitySchemaSlugs,
			source.schemas,
		);
		if (source.where) {
			yield* validateExpr(executionScope, source.where, aliases);
		}
		return aliases;
	}

	const via = source.via;
	const visibleSchemas = via
		? yield* Effect.gen(function* () {
				const anchorSchemas = aliases.get(via.entityRef) ?? [];
				const endpoint = via.direction === "outgoing" ? "target" : "source";
				const anchorEndpoint = endpoint === "target" ? "source" : "target";
				if (isNonEmpty(anchorSchemas)) {
					yield* loadRelationshipEndpointEntitySchemas(
						executionScope,
						[via.schema],
						anchorEndpoint,
						anchorSchemas,
					);
				}
				return yield* loadRelationshipEndpointEntitySchemas(
					executionScope,
					[via.schema],
					endpoint,
					source.schemas,
				);
			})
		: yield* loadVisibleEntitySchemas(executionScope, source.schemas);

	const nextAliases = new Map(aliases);
	nextAliases.set(
		source.alias,
		visibleSchemas.map((schema) => schema.id),
	);
	if (source.where) {
		yield* validateExpr(executionScope, source.where, nextAliases);
	}

	return nextAliases;
});

const validateRootEventSource = Effect.fn("validateRootEventSource")(function* (
	executionScope: QueryExecutionScope,
	source: RootEventSource,
) {
	const entitySchemas = yield* loadVisibleEntitySchemas(executionScope, source.entity.schemas);
	const entitySchemaSlugs = entitySchemas.map((schema) => schema.id);
	yield* loadVisibleEventSchemasForEntitySchemas(executionScope, entitySchemaSlugs, source.schemas);
	const aliases = new Map<string, readonly string[]>([[source.entity.alias, entitySchemaSlugs]]);
	if (source.where) {
		yield* validateExpr(executionScope, source.where, aliases);
	}
	return aliases;
});

const validateRelationshipRootSource = Effect.fn("validateRelationshipRootSource")(function* (
	executionScope: QueryExecutionScope,
	source: RelationshipSource,
) {
	const sourceEntitySchemas = yield* loadRelationshipEndpointEntitySchemas(
		executionScope,
		source.schemas,
		"source",
		source.sourceEntity.schemas,
	);
	const targetEntitySchemas = yield* loadRelationshipEndpointEntitySchemas(
		executionScope,
		source.schemas,
		"target",
		source.targetEntity.schemas,
	);
	const aliases = new Map<string, readonly string[]>([
		[source.sourceEntity.alias, sourceEntitySchemas.map((schema) => schema.id)],
		[source.targetEntity.alias, targetEntitySchemas.map((schema) => schema.id)],
	]);
	if (source.where) {
		yield* validateExpr(executionScope, source.where, aliases);
	}
	return aliases;
});

const validateRootSource = (executionScope: QueryExecutionScope, doc: QueryDocument) => {
	const source = doc.source;
	if (source.type === "events") {
		return validateRootEventSource(executionScope, source);
	}
	if (source.type === "relationships") {
		return validateRelationshipRootSource(executionScope, source);
	}
	return validateSource(executionScope, source, new Map());
};

const validateInclude = (
	executionScope: QueryExecutionScope,
	include: IncludeEntry,
	aliases: EntityAliasSchemas,
): ValidationEffect =>
	Effect.gen(function* () {
		const nextAliases = yield* validateSource(executionScope, include.source, aliases);
		for (const field of include.fields) {
			yield* validateExpr(executionScope, field.expr, nextAliases);
		}
		for (const orderBy of include.orderBy) {
			yield* validateExpr(executionScope, orderBy.expr, nextAliases);
		}
		for (const child of include.include ?? []) {
			yield* validateInclude(executionScope, child, nextAliases);
		}
	});

const validateQueryDocumentReferences = Effect.fn("validateQueryDocumentReferences")(function* (
	executionScope: QueryExecutionScope,
	doc: QueryDocument,
) {
	const aliases = yield* validateRootSource(executionScope, doc);

	if (doc.output.type === "rows") {
		for (const field of doc.output.fields) {
			yield* validateExpr(executionScope, field.expr, aliases);
		}
		for (const orderBy of doc.output.orderBy) {
			yield* validateExpr(executionScope, orderBy.expr, aliases);
		}
		for (const include of doc.output.include ?? []) {
			yield* validateInclude(executionScope, include, aliases);
		}
		return;
	}

	if (doc.output.type === "aggregate") {
		for (const measure of doc.output.measures) {
			if ("expr" in measure.aggregation) {
				yield* validateExpr(executionScope, measure.aggregation.expr, aliases);
			}
			if ("distinctBy" in measure.aggregation && measure.aggregation.distinctBy) {
				yield* validateExpr(executionScope, measure.aggregation.distinctBy, aliases);
			}
		}
		for (const groupBy of doc.output.groupBy ?? []) {
			yield* validateExpr(executionScope, groupBy.expr, aliases);
		}
		for (const orderBy of doc.output.orderBy ?? []) {
			yield* validateExpr(executionScope, orderBy.expr, aliases);
		}
		return;
	}

	if ("expr" in doc.output.measure.aggregation) {
		yield* validateExpr(executionScope, doc.output.measure.aggregation.expr, aliases);
	}
	yield* validateExpr(executionScope, doc.output.time.expr, aliases);
});

export const validateQueryDocumentReferencesAndTypes = Effect.fn(
	"validateQueryDocumentReferencesAndTypes",
)(function* (executionScope: QueryExecutionScope, doc: QueryDocument) {
	yield* validateQueryDocumentReferences(executionScope, doc);
	yield* validateQueryDocumentTypeCompatibility(executionScope, doc);
});
