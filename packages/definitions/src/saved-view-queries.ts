import { ownerIdentityReference } from "@ryot-app/contract/modules/plugins/references";
import type { NamedQuery, RyotQLDocument } from "@ryot-app/contract/modules/ryotql/authored";
import { entityBrowserFields } from "@ryot-app/contract/modules/saved-views/entity-browser-fields";
import {
	EntityBrowserSavedViewSettings,
	ResultsTableSavedViewSettings,
	type SavedViewRenderer,
} from "@ryot-app/contract/modules/saved-views/schemas";
import { and, column, entitySchemaPredicate, or, table } from "@ryot-app/ryotql";
import { stableStringify } from "@ryot-app/ts-utils/json";
import { Result, Schema } from "effect";

export const deriveSavedViewQueries = (
	renderer: SavedViewRenderer,
	settings: unknown,
	document: RyotQLDocument,
	trusted = false,
): Result.Result<RyotQLDocument, Error> => {
	if (
		renderer.kind !== "kernel" ||
		!(
			renderer.name === "entity-browser" ||
			renderer.name === "collection-browser" ||
			renderer.name === "results-table"
		)
	) {
		return Result.succeed(document);
	}
	const decoded = Schema.decodeUnknownResult(
		Schema.Union([EntityBrowserSavedViewSettings, ResultsTableSavedViewSettings]),
	)(settings);
	if (Result.isFailure(decoded)) {
		return Result.fail(new Error("Invalid renderer settings"));
	}
	const config = decoded.success;
	if (
		config.controls?.search !== undefined &&
		document.parameters?.fields[config.controls.search]?.type !== "string"
	) {
		return Result.fail(new Error("Search must name a declared string parameter"));
	}
	if (
		(config.controls?.filter && document.controls?.filter === undefined) ||
		(config.controls?.sort && document.controls?.sort === undefined)
	) {
		return Result.fail(new Error("Renderer controls must be declared by the document"));
	}
	const source = document.queries[config.sourceName];
	const derived = new Set(["ids", "count", "librarySearchCount"]);
	if (source?.output.type !== "rows" || derived.has(config.sourceName)) {
		return Result.fail(new Error("Invalid saved source query"));
	}
	if (!trusted && Object.keys(document.queries).some((name) => derived.has(name))) {
		return Result.fail(
			new Error("Saved query names count, ids and librarySearchCount are reserved"),
		);
	}
	const entity = "subject" in config ? table("entity", config.subject.entityAlias) : undefined;
	const subject =
		"subject" in config && entity
			? or(
					...config.subject.schemas.map(({ slug, owner }) =>
						entitySchemaPredicate(entity, slug, ownerIdentityReference(owner)),
					),
				)
			: undefined;
	const reservedFields = entity
		? [
				{ expr: column(entity, "id"), key: entityBrowserFields.id },
				{ expr: column(entity, "name"), key: entityBrowserFields.name },
				{ key: entityBrowserFields.owner, expr: column(entity, "entitySchemaPluginId") },
				{ key: entityBrowserFields.schema, expr: column(entity, "entitySchemaSlug") },
				{ key: entityBrowserFields.population, expr: column(entity, "populationStatus") },
				{ key: entityBrowserFields.translation, expr: column(entity, "translationStatus") },
			]
		: [];
	const prepare = (query: NamedQuery): Result.Result<NamedQuery, Error> => {
		if (query.output.type !== "rows") {
			return Result.fail(new Error("Browser sources must produce rows"));
		}
		for (const field of query.output.fields) {
			if (!("key" in field) || !reservedFields.some(({ key }) => key === field.key)) {
				continue;
			}
			const expected = reservedFields.find(({ key }) => key === field.key);
			if (!trusted || stableStringify(expected) !== stableStringify(field)) {
				return Result.fail(new Error(`Output '${field.key}' is reserved`));
			}
		}
		const where =
			subject !== undefined && !trusted
				? and(...(query.where ? [query.where] : []), subject)
				: query.where;
		const fields = [
			...query.output.fields.filter(
				(field) => !("key" in field) || !reservedFields.some(({ key }) => key === field.key),
			),
			...reservedFields,
		];
		return Result.succeed({
			...query,
			...(where === undefined ? {} : { where }),
			output: {
				...query.output,
				fields,
				...(entity === undefined
					? {}
					: { presentation: { scope: "owner" as const, entityId: entityBrowserFields.id } }),
			},
		});
	};
	const selected = prepare(source);
	if (Result.isFailure(selected)) {
		return Result.fail(selected.failure);
	}
	const count = (query: NamedQuery): NamedQuery => ({
		...query,
		output: {
			limit: 1,
			maxLimit: 1,
			type: "aggregate",
			measures: [
				{
					key: "count",
					aggregation: entity
						? { function: "countDistinct", expr: column(entity, "id") }
						: { function: "count" },
				},
			],
		},
	});
	const { include: _, presentation: _presentation, ...output } = source.output;
	const ids: NamedQuery = {
		...selected.success,
		output: {
			...output,
			pagination: { limit: 100, maxLimit: 100 },
			fields: entity
				? [{ key: "id", expr: column(entity, "id") }]
				: source.output.fields.filter(
						(field) =>
							"key" in field && "rowKeyFields" in config && config.rowKeyFields.includes(field.key),
					),
		},
	};
	const queries: Record<string, NamedQuery> = {
		...document.queries,
		ids,
		count: count(selected.success),
		[config.sourceName]: selected.success,
	};
	if (document.queries["librarySearch"] !== undefined) {
		if (!entity) {
			return Result.fail(new Error("librarySearch requires an entity browser"));
		}
		const search = prepare(document.queries["librarySearch"]);
		if (Result.isFailure(search)) {
			return Result.fail(search.failure);
		}
		queries["librarySearch"] = search.success;
		queries["librarySearchCount"] = count(search.success);
	}
	const atomic = (
		value: Exclude<
			NonNullable<NonNullable<RyotQLDocument["controls"]>["filter"]>,
			{ kind: "composite" }
		>,
	) => (value.kind === "outputs" ? { ...value, query: value.query ?? config.sourceName } : value);
	const target = (
		value: NonNullable<RyotQLDocument["controls"]>["filter"],
	): NonNullable<RyotQLDocument["controls"]>["filter"] => {
		if (value === undefined) {
			return undefined;
		}
		if (value.kind !== "composite") {
			return atomic(value);
		}
		const [first, ...rest] = value.targets;
		return { ...value, targets: [atomic(first), ...rest.map(atomic)] };
	};
	return Result.succeed({
		...document,
		queries,
		...(document.controls === undefined
			? {}
			: {
					controls: {
						sort: target(document.controls.sort),
						filter: target(document.controls.filter),
					},
				}),
	});
};
