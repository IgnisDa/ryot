import { Effect } from "effect";

import type { BadRequest } from "#lib/errors";
import { badRequest } from "#lib/errors";
import {
	entityBuiltinColumns,
	entitySchemaBuiltinColumns,
	type DisplayConfiguration,
	type QueryExpression,
	type QueryFilter,
	type RuntimeRef,
} from "#lib/query-language";
import type { AppPropertyDefinition, AppSchema } from "#lib/schema/property-schema";
import type { QueryDocument } from "#modules/query-engine/language";

type DisplayExpressionType =
	| "boolean"
	| "date"
	| "image"
	| "null"
	| "number"
	| "string"
	| "unknown";
export type DisplayEntitySchema = { readonly slug: string; readonly propertiesSchema: AppSchema };

const entityBuiltinTypeMap = {
	createdAt: "date",
	externalId: "string",
	id: "string",
	image: "image",
	name: "string",
	sandboxScriptId: "string",
	updatedAt: "date",
} satisfies Record<string, DisplayExpressionType>;

const entitySchemaBuiltinTypeMap = {
	accentColor: "string",
	createdAt: "date",
	id: "string",
	icon: "string",
	isBuiltin: "boolean",
	name: "string",
	slug: "string",
	updatedAt: "date",
	userId: "string",
} satisfies Record<string, DisplayExpressionType>;

const eventBuiltinTypeMap = {
	createdAt: "date",
	id: "string",
	occurredAt: "date",
	updatedAt: "date",
} satisfies Record<string, DisplayExpressionType>;

const eventSchemaBuiltinTypeMap = {
	createdAt: "date",
	id: "string",
	isBuiltin: "boolean",
	name: "string",
	slug: "string",
	updatedAt: "date",
} satisfies Record<string, DisplayExpressionType>;

const getDisplayTypeFromRecord = (record: Record<string, DisplayExpressionType>, column: string) =>
	record[column] ?? null;

const normalizePropertyType = (
	propertyType: AppPropertyDefinition["type"],
): DisplayExpressionType => {
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
	schema: DisplayEntitySchema,
	propertyPath: readonly string[],
): AppPropertyDefinition | null => {
	const [first, ...rest] = propertyPath;
	if (!first) {
		return null;
	}

	const definition = schema.propertiesSchema.fields[first];
	if (!definition) {
		return null;
	}
	if (rest.length === 0) {
		return definition;
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

const collectEntitySlugsFromFilter = (filter: QueryFilter): string[] => {
	if (filter.type === "not") {
		return collectEntitySlugsFromFilter(filter.predicate);
	}
	if (filter.type === "isNull" || filter.type === "isNotNull") {
		return collectEntitySlugsFromExpr(filter.expression);
	}
	if (filter.type === "and" || filter.type === "or") {
		return filter.predicates.flatMap(collectEntitySlugsFromFilter);
	}
	if (filter.type === "in") {
		return [
			...collectEntitySlugsFromExpr(filter.expression),
			...filter.values.flatMap(collectEntitySlugsFromExpr),
		];
	}
	if (filter.type === "contains") {
		return [
			...collectEntitySlugsFromExpr(filter.expression),
			...collectEntitySlugsFromExpr(filter.value),
		];
	}
	return [...collectEntitySlugsFromExpr(filter.left), ...collectEntitySlugsFromExpr(filter.right)];
};

const collectEntitySlugsFromExpr = (expr: QueryExpression): string[] => {
	if (expr.type === "reference") {
		return expr.reference.type === "entity" ? [expr.reference.slug] : [];
	}
	if (expr.type === "literal") {
		return [];
	}
	if (
		expr.type === "round" ||
		expr.type === "floor" ||
		expr.type === "integer" ||
		expr.type === "isNotNull" ||
		expr.type === "transform"
	) {
		return collectEntitySlugsFromExpr(expr.expression);
	}
	if (expr.type === "concat" || expr.type === "coalesce") {
		return expr.values.flatMap(collectEntitySlugsFromExpr);
	}
	if (expr.type === "arithmetic") {
		return [...collectEntitySlugsFromExpr(expr.left), ...collectEntitySlugsFromExpr(expr.right)];
	}
	return [
		...collectEntitySlugsFromFilter(expr.condition),
		...collectEntitySlugsFromExpr(expr.whenTrue),
		...collectEntitySlugsFromExpr(expr.whenFalse),
	];
};

const collectDisplayConfigEntitySlugs = (config: DisplayConfiguration): string[] => {
	const fromNullable = (expr: QueryExpression | null) =>
		expr ? collectEntitySlugsFromExpr(expr) : [];
	const fromCard = (card: DisplayConfiguration["grid"]) => [
		...collectEntitySlugsFromExpr(card.titleProperty),
		...fromNullable(card.imageProperty),
		...fromNullable(card.eyebrowProperty),
		...fromNullable(card.calloutProperty),
		...fromNullable(card.primarySubtitleProperty),
		...fromNullable(card.secondarySubtitleProperty),
	];
	return [
		...collectEntitySlugsFromExpr(config.entityIdProperty),
		...fromCard(config.grid),
		...fromCard(config.list),
		...config.table.columns.flatMap((col) => collectEntitySlugsFromExpr(col.expression)),
	];
};

const getQueryDocSourceSchemaList = (doc: QueryDocument): [string, ...string[]] => {
	if (doc.source.type === "entities") {
		return [...doc.source.schemas];
	}
	if (doc.source.type === "events") {
		return [...doc.source.entity.schemas];
	}
	return [...doc.source.sourceEntity.schemas, ...doc.source.targetEntity.schemas] as [
		string,
		...string[],
	];
};

const getQueryDocSourceSchemas = (doc: QueryDocument): ReadonlySet<string> =>
	new Set(getQueryDocSourceSchemaList(doc));

const unifyDisplayExpressionTypes = (
	types: readonly DisplayExpressionType[],
): DisplayExpressionType => {
	const nonNullTypes = [...new Set(types.filter((type) => type !== "null"))];
	if (nonNullTypes.length === 0) {
		return "null";
	}
	if (nonNullTypes.length === 1) {
		return nonNullTypes[0] ?? "unknown";
	}
	return "unknown";
};

const inferReferenceType = (
	reference: RuntimeRef,
	schemaMap: ReadonlyMap<string, DisplayEntitySchema>,
): Effect.Effect<DisplayExpressionType, BadRequest> => {
	if (reference.type === "computed-field") {
		return Effect.succeed("unknown");
	}
	if (reference.type === "entity-schema") {
		const [column, ...rest] = reference.path;
		if (!column || rest.length > 0 || !entitySchemaBuiltinColumns.has(column)) {
			return badRequest(
				`Unsupported entity schema column 'entity-schema.${reference.path.join(".")}'`,
			);
		}
		return Effect.succeed(
			getDisplayTypeFromRecord(entitySchemaBuiltinTypeMap, column) ?? "unknown",
		);
	}
	if (reference.type === "entity") {
		const [column, ...rest] = reference.path;
		if (!column) {
			return badRequest(`Unsupported entity column 'entity.${reference.slug}'`);
		}
		if (rest.length === 0 && entityBuiltinColumns.has(column)) {
			return Effect.succeed(getDisplayTypeFromRecord(entityBuiltinTypeMap, column) ?? "unknown");
		}
		if (column !== "properties") {
			return badRequest(
				`Unsupported entity column 'entity.${reference.slug}.${reference.path.join(".")}'`,
			);
		}
		const schema = schemaMap.get(reference.slug);
		if (!schema) {
			return badRequest(`Entity schema '${reference.slug}' not found`);
		}
		const propertyDefinition = getPropertyDefinition(schema, rest);
		if (!propertyDefinition) {
			return badRequest(
				`Property '${rest.join(".")}' not found in entity schema '${reference.slug}'`,
			);
		}
		return Effect.succeed(normalizePropertyType(propertyDefinition.type));
	}
	if (reference.type === "event") {
		const [column, ...rest] = reference.path;
		if (!column || rest.length > 0) {
			return Effect.succeed("unknown");
		}
		return Effect.succeed(getDisplayTypeFromRecord(eventBuiltinTypeMap, column) ?? "unknown");
	}
	if (reference.type === "event-schema") {
		const [column, ...rest] = reference.path;
		if (!column || rest.length > 0) {
			return Effect.succeed("unknown");
		}
		return Effect.succeed(getDisplayTypeFromRecord(eventSchemaBuiltinTypeMap, column) ?? "unknown");
	}
	if (reference.type === "event-aggregate") {
		return Effect.succeed("number");
	}
	return Effect.succeed("unknown");
};

const validateDisplayFilter = (
	filter: QueryFilter,
	schemaMap: ReadonlyMap<string, DisplayEntitySchema>,
): Effect.Effect<void, BadRequest> => {
	if (filter.type === "not") {
		return validateDisplayFilter(filter.predicate, schemaMap);
	}
	if (filter.type === "isNull" || filter.type === "isNotNull") {
		return inferDisplayExpressionType(filter.expression, schemaMap).pipe(Effect.asVoid);
	}
	if (filter.type === "and" || filter.type === "or") {
		return Effect.forEach(
			filter.predicates,
			(predicate) => validateDisplayFilter(predicate, schemaMap),
			{
				discard: true,
			},
		);
	}
	if (filter.type === "in") {
		return Effect.forEach(
			[filter.expression, ...filter.values],
			(expr) => inferDisplayExpressionType(expr, schemaMap),
			{ discard: true },
		);
	}
	if (filter.type === "contains") {
		return Effect.forEach(
			[filter.expression, filter.value],
			(expr) => inferDisplayExpressionType(expr, schemaMap),
			{ discard: true },
		);
	}
	return Effect.forEach(
		[filter.left, filter.right],
		(expr) => inferDisplayExpressionType(expr, schemaMap),
		{ discard: true },
	);
};

const inferDisplayExpressionType = (
	expr: QueryExpression,
	schemaMap: ReadonlyMap<string, DisplayEntitySchema>,
): Effect.Effect<DisplayExpressionType, BadRequest> => {
	if (expr.type === "literal") {
		if (expr.value === null || expr.value === undefined) {
			return Effect.succeed("null");
		}
		if (typeof expr.value === "boolean") {
			return Effect.succeed("boolean");
		}
		if (typeof expr.value === "number") {
			return Effect.succeed("number");
		}
		if (typeof expr.value === "string") {
			return Effect.succeed("string");
		}
		return Effect.succeed("unknown");
	}
	if (expr.type === "reference") {
		return inferReferenceType(expr.reference, schemaMap);
	}
	if (expr.type === "concat" || expr.type === "transform") {
		const expressions = expr.type === "concat" ? expr.values : [expr.expression];
		return Effect.forEach(expressions, (child) => inferDisplayExpressionType(child, schemaMap), {
			discard: true,
		}).pipe(Effect.as("string"));
	}
	if (expr.type === "floor" || expr.type === "integer" || expr.type === "round") {
		return inferDisplayExpressionType(expr.expression, schemaMap).pipe(Effect.as("number"));
	}
	if (expr.type === "isNotNull") {
		return inferDisplayExpressionType(expr.expression, schemaMap).pipe(Effect.as("boolean"));
	}
	if (expr.type === "arithmetic") {
		return Effect.forEach(
			[expr.left, expr.right],
			(child) => inferDisplayExpressionType(child, schemaMap),
			{ discard: true },
		).pipe(Effect.as("number"));
	}
	if (expr.type === "coalesce") {
		return Effect.forEach(expr.values, (child) =>
			inferDisplayExpressionType(child, schemaMap),
		).pipe(Effect.map(unifyDisplayExpressionTypes));
	}
	return Effect.gen(function* () {
		yield* validateDisplayFilter(expr.condition, schemaMap);
		const [whenFalseType, whenTrueType] = yield* Effect.all([
			inferDisplayExpressionType(expr.whenFalse, schemaMap),
			inferDisplayExpressionType(expr.whenTrue, schemaMap),
		]);
		return unifyDisplayExpressionTypes([whenFalseType, whenTrueType]);
	});
};

const collectDisplayExpressions = (displayConfig: DisplayConfiguration): QueryExpression[] => {
	const expressions: QueryExpression[] = [
		displayConfig.entityIdProperty,
		displayConfig.grid.titleProperty,
		displayConfig.list.titleProperty,
		...displayConfig.table.columns.map((column) => column.expression),
	];
	const nullableExpressions = [
		displayConfig.grid.imageProperty,
		displayConfig.grid.eyebrowProperty,
		displayConfig.grid.calloutProperty,
		displayConfig.grid.primarySubtitleProperty,
		displayConfig.grid.secondarySubtitleProperty,
		displayConfig.list.imageProperty,
		displayConfig.list.eyebrowProperty,
		displayConfig.list.calloutProperty,
		displayConfig.list.primarySubtitleProperty,
		displayConfig.list.secondarySubtitleProperty,
	];

	for (const expr of nullableExpressions) {
		if (expr) {
			expressions.push(expr);
		}
	}

	return expressions;
};

export const validateDisplayConfiguration = Effect.fn("validateDisplayConfiguration")(function* <
	E,
>(input: {
	displayConfig: DisplayConfiguration;
	doc: QueryDocument;
	loadSchemas: (
		slugs: readonly [string, ...string[]],
	) => Effect.Effect<readonly DisplayEntitySchema[], E>;
}) {
	if (input.displayConfig.table.columns.length === 0) {
		return yield* badRequest("At least one table column is required");
	}

	const sourceSchemas = getQueryDocSourceSchemas(input.doc);
	const badSlug = collectDisplayConfigEntitySlugs(input.displayConfig).find(
		(slug) => !sourceSchemas.has(slug),
	);
	if (badSlug) {
		return yield* badRequest(
			`Display configuration references entity schema '${badSlug}' which is not in the query document source`,
		);
	}

	const schemaRows = yield* input.loadSchemas(getQueryDocSourceSchemaList(input.doc));
	const schemaMap = new Map(schemaRows.map((schema) => [schema.slug, schema]));
	for (const expression of collectDisplayExpressions(input.displayConfig)) {
		yield* inferDisplayExpressionType(expression, schemaMap);
	}

	const entityIdType = yield* inferDisplayExpressionType(
		input.displayConfig.entityIdProperty,
		schemaMap,
	);
	if (entityIdType !== "string") {
		return yield* badRequest(
			"displayConfiguration.entityIdProperty must resolve to a string expression",
		);
	}

	return yield* Effect.void;
});
