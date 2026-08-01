import { it } from "@effect/vitest";
import type { RyotQLDocument } from "@ryot-app/contract/modules/ryotql/language";
import {
	type EntityBrowserSavedViewSettings,
	type ResultsTableSavedViewSettings,
	SavedViewBadRequest,
	type SavedViewLayouts,
} from "@ryot-app/contract/modules/saved-views/schemas";
import {
	aggregate,
	and,
	ascending,
	castJson,
	column,
	document,
	field,
	eq,
	join,
	jsonPath,
	literal,
	rows,
	table,
} from "@ryot-app/ryotql";
import { Effect } from "effect";

import { assertExitFails } from "#lib/test-utils/assertions";

import {
	validateEntityBrowserSavedViewDefinition,
	validateResultsTableSavedViewDefinition,
	validateSavedViewDefinition,
} from "./definition-validation";

const record = table("entity", "record");
const queryDocument = document({
	savedView: rows(record, {
		orderBy: [ascending(column(record, "name"))],
		fields: [
			field("id", column(record, "id")),
			field("name", column(record, "name")),
			field("image", castJson(jsonPath(column(record, "properties"), "images", 0))),
			field("imageUrl", jsonPath(column(record, "properties"), "images", 0, "url")),
			field("textId", literal("not-an-entity-id")),
			field("count", literal(1)),
		],
	}),
}) satisfies RyotQLDocument;

const cardLayout = {
	queryDocument,
	titleField: "name",
	callout: null,
	imageField: "image",
	entityIdField: "id",
	overline: null,
	primaryMetadata: null,
	secondaryMetadata: null,
} as const;

const layouts = {
	grid: cardLayout,
	list: cardLayout,
	table: {
		queryDocument,
		imageField: "image",
		entityIdField: "id",
		columns: [{ label: "Name", field: "name", displayKind: "text" }],
	},
} satisfies SavedViewLayouts;

it.effect("accepts three independently valid layouts", () =>
	validateSavedViewDefinition({ layouts }),
);

it.effect("prefixes validation failures with the layout name", () =>
	Effect.gen(function* () {
		const invalid = { ...layouts, list: { ...layouts.list, entityIdField: "count" } };
		const exit = yield* Effect.exit(validateSavedViewDefinition({ layouts: invalid }));

		assertExitFails(
			exit,
			new SavedViewBadRequest({
				reason: {
					layout: "list",
					issue: "field-kind",
					field: "entityIdField",
					code: "invalid-definition",
				},
			}),
		);
	}),
);

it.effect("requires the entity ID mapping to project an entity primary key", () => {
	const invalid = { ...layouts, grid: { ...layouts.grid, entityIdField: "textId" } };
	return Effect.exit(validateSavedViewDefinition({ layouts: invalid })).pipe(
		Effect.map((exit) =>
			assertExitFails(
				exit,
				new SavedViewBadRequest({
					reason: {
						layout: "grid",
						field: "entityIdField",
						issue: "entity-id-source",
						code: "invalid-definition",
					},
				}),
			),
		),
	);
});

it.effect("validates mappings against only their layout projection", () => {
	const tableDocument = document({
		savedView: rows(record, {
			fields: [field("id", column(record, "id")), field("tableName", column(record, "name"))],
		}),
	});
	const invalid = {
		...layouts,
		table: {
			...layouts.table,
			queryDocument: tableDocument,
			columns: [{ label: "Name", field: "name", displayKind: "text" }],
		},
	} satisfies SavedViewLayouts;

	return Effect.exit(validateSavedViewDefinition({ layouts: invalid })).pipe(
		Effect.map((exit) =>
			assertExitFails(
				exit,
				new SavedViewBadRequest({
					reason: {
						field: "image",
						layout: "table",
						code: "invalid-definition",
						issue: "mapping-field-missing",
					},
				}),
			),
		),
	);
});

it.effect("enforces card title text and explicit JSON image casts", () => {
	const cases = [
		{
			layouts: { ...layouts, grid: { ...layouts.grid, titleField: "count" } },
			reason: {
				layout: "grid",
				issue: "field-kind",
				field: "titleField",
				code: "invalid-definition",
			} as const,
		},
		{
			layouts: { ...layouts, list: { ...layouts.list, imageField: "imageUrl" } },
			reason: {
				layout: "list",
				issue: "image-cast",
				field: "imageField",
				code: "invalid-definition",
			} as const,
		},
	];
	return Effect.forEach(cases, ({ layouts: invalid, reason }) =>
		Effect.exit(validateSavedViewDefinition({ layouts: invalid })).pipe(
			Effect.map((exit) => assertExitFails(exit, new SavedViewBadRequest({ reason }))),
		),
	);
});

it.effect("enforces the document rules independently for every layout", () => {
	const secondQuery = {
		...queryDocument,
		queries: { ...queryDocument.queries, second: queryDocument.queries.savedView },
	};
	const withCursor = {
		...queryDocument,
		queries: {
			savedView: {
				...queryDocument.queries.savedView,
				output: {
					...queryDocument.queries.savedView.output,
					pagination: {
						...queryDocument.queries.savedView.output.pagination,
						after: "persisted-cursor",
					},
				},
			},
		},
	};

	return Effect.gen(function* () {
		const queryCountExit = yield* Effect.exit(
			validateSavedViewDefinition({
				layouts: { ...layouts, grid: { ...layouts.grid, queryDocument: secondQuery } },
			}),
		);
		const cursorExit = yield* Effect.exit(
			validateSavedViewDefinition({
				layouts: { ...layouts, table: { ...layouts.table, queryDocument: withCursor } },
			}),
		);
		assertExitFails(
			queryCountExit,
			new SavedViewBadRequest({
				reason: { layout: "grid", issue: "query-count", code: "invalid-definition" },
			}),
		);
		assertExitFails(
			cursorExit,
			new SavedViewBadRequest({
				reason: { layout: "table", issue: "cursor-pagination", code: "invalid-definition" },
			}),
		);
	});
});

it.effect("reports semantic query errors as an unstructured query diagnostic", () => {
	const invalid = {
		...layouts,
		list: {
			...layouts.list,
			queryDocument: document({
				savedView: rows(record, {
					fields: [
						field("id", column(record, "id")),
						field("name", column(record, "name")),
						field("image", castJson(jsonPath(column(record, "missingColumn"), "images", 0))),
					],
				}),
			}),
		},
	} satisfies SavedViewLayouts;

	return Effect.exit(validateSavedViewDefinition({ layouts: invalid })).pipe(
		Effect.map((exit) =>
			assertExitFails(
				exit,
				new SavedViewBadRequest({
					reason: { layout: "list", issue: "query-invalid", code: "invalid-definition" },
				}),
			),
		),
	);
});

const browserSettings = {
	pageSize: 24,
	addAction: null,
	tableColumns: null,
	defaultLayout: "grid",
	sourceName: "entities",
	layouts: ["grid", "list"],
	entityIdField: "selectedId",
	searchFields: ["selectedName"],
	ownerPluginIdField: "selectedOwner",
	entitySchemaSlugField: "selectedSchema",
	sortChoices: [
		{ name: "name", label: "Name", orderBy: [{ field: "selectedName", direction: "asc" }] },
	],
} satisfies EntityBrowserSavedViewSettings;

const browserSource = (entity = table("entity", "selected")) =>
	document({
		extraCount: aggregate(entity, {
			measures: [{ key: "total", aggregation: { function: "count" } }],
		}),
		entities: rows(entity, {
			fields: [
				field("selectedId", column(entity, "id")),
				field("selectedName", column(entity, "name")),
				field("selectedOwner", column(entity, "entitySchemaPluginId")),
				field("selectedSchema", column(entity, "entitySchemaSlug")),
			],
		}),
	});

const browserFailure = (message: string) =>
	new SavedViewBadRequest({ reason: { code: "settings-incompatible", message } });

it.effect("accepts entity-browser settings selecting one rows source among named queries", () =>
	validateEntityBrowserSavedViewDefinition({
		settings: browserSettings,
		dataSources: browserSource(),
	}),
);

it.effect("requires provider add owner and schema to match fixed source provenance", () => {
	const entitySchemaSlug = "book";
	const ownerPluginId = "stable-plugin-id";
	const entity = table("entity", "selected");
	const settings = {
		...browserSettings,
		addAction: { type: "provider-search", ownerPluginId, entitySchemaSlug },
	} as const;
	const source = browserSource(entity);
	const entities = source.queries.entities;
	const fixedSource = {
		queries: {
			...source.queries,
			entities: {
				...entities,
				where: and(
					eq(column(entity, "entitySchemaPluginId"), literal(ownerPluginId)),
					eq(column(entity, "entitySchemaSlug"), literal(entitySchemaSlug)),
				),
			},
		},
	};

	return Effect.gen(function* () {
		yield* validateEntityBrowserSavedViewDefinition({ settings, dataSources: fixedSource });
		const mismatch = yield* Effect.exit(
			validateEntityBrowserSavedViewDefinition({
				dataSources: fixedSource,
				settings: {
					...settings,
					addAction: { ...settings.addAction, ownerPluginId: "other-plugin-id" },
				},
			}),
		);
		assertExitFails(
			mismatch,
			browserFailure(
				"Entity-browser addAction must match the fixed source entity owner and schema",
			),
		);
	});
});

it.effect("rejects missing and non-row entity-browser sources", () =>
	Effect.gen(function* () {
		const source = browserSource();
		const missing = yield* Effect.exit(
			validateEntityBrowserSavedViewDefinition({
				dataSources: source,
				settings: { ...browserSettings, sourceName: "missing" },
			}),
		);
		const nonRows = yield* Effect.exit(
			validateEntityBrowserSavedViewDefinition({
				dataSources: source,
				settings: { ...browserSettings, sourceName: "extraCount" },
			}),
		);

		assertExitFails(missing, browserFailure("Entity-browser source 'missing' does not exist"));
		assertExitFails(
			nonRows,
			browserFailure("Entity-browser source 'extraCount' must produce rows"),
		);
	}),
);

it.effect("rejects cursors stored in any rows data source", () => {
	const source = browserSource();
	const dataSources = {
		...source,
		queries: {
			...source.queries,
			laterPage: {
				...source.queries.entities,
				output: {
					...source.queries.entities.output,
					pagination: { limit: 10, after: "stored-cursor" },
				},
			},
		},
	};
	return Effect.exit(
		validateEntityBrowserSavedViewDefinition({ settings: browserSettings, dataSources }),
	).pipe(
		Effect.map((exit) =>
			assertExitFails(
				exit,
				browserFailure("Stored data source 'laterPage' must not contain a cursor"),
			),
		),
	);
});

it.effect("rejects aliases that spoof entity provenance", () => {
	const selected = table("entity", "selected");
	const dataSources = document({
		entities: rows(selected, {
			fields: [
				field("selectedId", literal("entity-id")),
				field("selectedOwner", literal("plugin-id")),
				field("selectedSchema", literal("book")),
			],
		}),
	});
	return Effect.exit(
		validateEntityBrowserSavedViewDefinition({ settings: browserSettings, dataSources }),
	).pipe(
		Effect.map((exit) =>
			assertExitFails(
				exit,
				browserFailure("Entity-browser field 'selectedId' must project entity.id"),
			),
		),
	);
});

it.effect("rejects identity projected from a non-entity table", () => {
	const selected = table("event", "selected");
	const dataSources = document({
		entities: rows(selected, {
			fields: [
				field("selectedId", column(selected, "id")),
				field("selectedOwner", literal(null)),
				field("selectedSchema", column(selected, "eventSchemaSlug")),
			],
		}),
	});
	return Effect.exit(
		validateEntityBrowserSavedViewDefinition({ settings: browserSettings, dataSources }),
	).pipe(
		Effect.map((exit) =>
			assertExitFails(
				exit,
				browserFailure("Entity-browser field 'selectedId' must project entity.id"),
			),
		),
	);
});

it.effect("requires all canonical provenance fields to use the same entity alias", () => {
	const selected = table("entity", "selected");
	const other = table("entity", "other");
	const source = browserSource(selected);
	const entities = source.queries.entities;
	const dataSources = {
		queries: {
			entities: {
				...entities,
				joins: [
					join("inner", other, {
						operator: "eq",
						type: "comparison",
						right: column(other, "id"),
						left: column(selected, "id"),
					}),
				] as const,
				output: {
					...entities.output,
					fields: [
						field("selectedId", column(selected, "id")),
						field("selectedOwner", column(other, "entitySchemaPluginId")),
						field("selectedSchema", column(selected, "entitySchemaSlug")),
					],
				},
			},
		},
	};
	return Effect.exit(
		validateEntityBrowserSavedViewDefinition({ settings: browserSettings, dataSources }),
	).pipe(
		Effect.map((exit) =>
			assertExitFails(
				exit,
				browserFailure(
					"Entity-browser provenance fields must come from the same entity table alias",
				),
			),
		),
	);
});

it.effect("validates configured entity-browser fields and table enablement", () =>
	Effect.gen(function* () {
		const missingSearch = yield* Effect.exit(
			validateEntityBrowserSavedViewDefinition({
				dataSources: browserSource(),
				settings: { ...browserSettings, searchFields: ["missing"] },
			}),
		);
		const tableWithoutColumns = yield* Effect.exit(
			validateEntityBrowserSavedViewDefinition({
				dataSources: browserSource(),
				settings: { ...browserSettings, layouts: ["grid", "table"] },
			}),
		);

		assertExitFails(
			missingSearch,
			browserFailure("Entity-browser configured field 'missing' must be a projected scalar field"),
		);
		assertExitFails(
			tableWithoutColumns,
			browserFailure(
				"Entity-browser table layout requires tableColumns and tableColumns require the table layout",
			),
		);
	}),
);

const resultsSettings = {
	pageSize: 25,
	sourceName: "events",
	rowKeyFields: ["eventId", "sequence"],
	entityLink: { entityIdField: "entityId" },
	columns: [{ label: "Name", field: "name", displayKind: "text" }],
} satisfies ResultsTableSavedViewSettings;

const resultEvent = table("event", "resultEvent");
const resultsSource = document({
	events: rows(resultEvent, {
		fields: [
			field("eventId", literal("event-1")),
			field("sequence", literal(1)),
			field("name", jsonPath(column(resultEvent, "properties"), "name")),
			field("entityId", column(resultEvent, "entityId")),
		],
	}),
});

it.effect("accepts a general rows source with canonical optional entity navigation", () =>
	validateResultsTableSavedViewDefinition({
		settings: resultsSettings,
		dataSources: resultsSource,
	}),
);

it.effect("rejects unprojected result fields and noncanonical entity navigation", () =>
	Effect.gen(function* () {
		const invalidPageSize = yield* Effect.exit(
			validateResultsTableSavedViewDefinition({
				dataSources: resultsSource,
				settings: { ...resultsSettings, pageSize: 101 },
			}),
		);
		const missing = yield* Effect.exit(
			validateResultsTableSavedViewDefinition({
				dataSources: resultsSource,
				settings: { ...resultsSettings, rowKeyFields: ["missing"] },
			}),
		);
		const noncanonical = yield* Effect.exit(
			validateResultsTableSavedViewDefinition({
				dataSources: resultsSource,
				settings: { ...resultsSettings, entityLink: { entityIdField: "eventId" } },
			}),
		);

		assertExitFails(invalidPageSize, browserFailure("Invalid results-table settings"));
		assertExitFails(
			missing,
			browserFailure("Results-table field 'missing' must be a projected scalar field"),
		);
		assertExitFails(
			noncanonical,
			browserFailure("Results-table entity link field 'eventId' must project entity.id"),
		);
	}),
);
