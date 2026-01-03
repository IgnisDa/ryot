import { describe, expect, it, mock } from "bun:test";
import type { AppSchema } from "@ryot/ts-utils";
import {
	coalesceExpression,
	comparisonPredicate,
	computedExpression,
	createSavedViewBody,
	createSmartphoneSchema,
	createTabletSchema,
	entityExpression,
	eventExpression,
	literalExpression,
	nullExpression,
	sortDefinition,
} from "~/lib/test-fixtures";
import { createDefaultDisplayConfiguration } from "~/modules/saved-views/constants";
import { createViewDefinitionModule } from "./definition";
import { ViewRuntimeNotFoundError } from "./errors";

const createRuntimeSchemaRow = (input: {
	id: string;
	slug: string;
	propertiesSchema: AppSchema;
}) => input;

const createSmartphoneDisplayConfiguration = () =>
	createDefaultDisplayConfiguration("smartphones");

const createDeps = (overrides: Record<string, unknown> = {}) => {
	const loadVisibleSchemas = mock(async () => [
		createRuntimeSchemaRow({
			id: "schema-1",
			slug: "smartphones",
			propertiesSchema: createSmartphoneSchema().propertiesSchema,
		}),
		createRuntimeSchemaRow({
			id: "schema-2",
			slug: "tablets",
			propertiesSchema: createTabletSchema().propertiesSchema,
		}),
	]);
	const loadVisibleEventJoins = mock(async () => []);
	const executePreparedView = mock(async ({ request }) => {
		const pagination = {
			total: 0,
			totalPages: 0,
			hasNextPage: false,
			hasPreviousPage: false,
			page: request.pagination.page,
			limit: request.pagination.limit,
		};

		return { items: [], meta: { pagination } };
	});

	const deps = {
		loadVisibleSchemas,
		executePreparedView,
		loadVisibleEventJoins,
		...overrides,
	};

	return deps;
};

describe("viewDefinitionModule", () => {
	it("validates saved views across all layouts during prepare", async () => {
		const views = createViewDefinitionModule(createDeps());
		const body = createSavedViewBody({
			queryDefinition: {
				filter: null,
				eventJoins: [],
				entitySchemaSlugs: ["smartphones"],
				sort: sortDefinition(entityExpression("smartphones", "@name")),
			},
			displayConfiguration: {
				table: {
					columns: [
						{
							label: "Broken",
							expression: entityExpression("smartphones", "unknown"),
						},
					],
				},
				grid: {
					badgeProperty: null,
					subtitleProperty: null,
					titleProperty: entityExpression("smartphones", "@name"),
					imageProperty: entityExpression("smartphones", "@image"),
				},
				list: {
					badgeProperty: null,
					subtitleProperty: null,
					titleProperty: entityExpression("smartphones", "@name"),
					imageProperty: entityExpression("smartphones", "@image"),
				},
			},
		});

		expect(
			views.prepare({
				userId: "user-1",
				source: {
					kind: "saved-view",
					definition: {
						queryDefinition: body.queryDefinition,
						displayConfiguration: body.displayConfiguration,
					},
				},
			}),
		).rejects.toThrow("Property 'unknown' not found in schema 'smartphones'");
	});

	it("rejects joined event references when the join is not declared", async () => {
		const views = createViewDefinitionModule(createDeps());
		const body = createSavedViewBody({
			queryDefinition: {
				filter: null,
				eventJoins: [],
				entitySchemaSlugs: ["smartphones"],
				sort: sortDefinition(entityExpression("smartphones", "@name")),
			},
			displayConfiguration: {
				...createSmartphoneDisplayConfiguration(),
				grid: {
					badgeProperty: null,
					subtitleProperty: null,
					titleProperty: eventExpression("review", "rating"),
					imageProperty: entityExpression("smartphones", "@image"),
				},
			},
		});

		expect(
			views.prepare({
				userId: "user-1",
				source: {
					kind: "saved-view",
					definition: {
						queryDefinition: body.queryDefinition,
						displayConfiguration: body.displayConfiguration,
					},
				},
			}),
		).rejects.toThrow(
			"Event join 'event.review' is not part of this runtime request",
		);
	});

	it("projects a saved view into a runtime request", async () => {
		const views = createViewDefinitionModule(createDeps());
		const body = createSavedViewBody({
			displayConfiguration: createSmartphoneDisplayConfiguration(),
			queryDefinition: {
				eventJoins: [],
				entitySchemaSlugs: ["smartphones"],
				sort: sortDefinition(entityExpression("smartphones", "@name")),
				filter: comparisonPredicate(
					entityExpression("smartphones", "manufacturer"),
					literalExpression("Apple"),
				),
			},
		});

		const prepared = await views.prepare({
			userId: "user-1",
			source: {
				kind: "saved-view",
				definition: {
					queryDefinition: body.queryDefinition,
					displayConfiguration: body.displayConfiguration,
				},
			},
		});

		expect(
			prepared.toRuntimeRequest({
				layout: "grid",
				pagination: { page: 2, limit: 10 },
			}),
		).toEqual({
			computedFields: [],
			sort: body.queryDefinition.sort,
			pagination: { page: 2, limit: 10 },
			filter: body.queryDefinition.filter,
			eventJoins: body.queryDefinition.eventJoins,
			entitySchemaSlugs: body.queryDefinition.entitySchemaSlugs,
			fields: [
				{ key: "image", expression: entityExpression("smartphones", "@image") },
				{ key: "title", expression: entityExpression("smartphones", "@name") },
				{ key: "subtitle", expression: nullExpression() },
				{ key: "badge", expression: nullExpression() },
			],
		});
	});

	it("preserves literal and coalesce display expressions for saved views", async () => {
		const views = createViewDefinitionModule(createDeps());
		const body = createSavedViewBody({
			queryDefinition: {
				filter: null,
				eventJoins: [],
				entitySchemaSlugs: ["smartphones"],
				sort: sortDefinition(entityExpression("smartphones", "@name")),
			},
			displayConfiguration: {
				table: {
					columns: [
						{ label: "Pinned", expression: literalExpression("Pinned") },
					],
				},
				grid: {
					badgeProperty: literalExpression("New"),
					titleProperty: entityExpression("smartphones", "@name"),
					imageProperty: entityExpression("smartphones", "@image"),
					subtitleProperty: coalesceExpression(
						nullExpression(),
						entityExpression("smartphones", "@name"),
					),
				},
				list: {
					badgeProperty: literalExpression("New"),
					titleProperty: entityExpression("smartphones", "@name"),
					imageProperty: entityExpression("smartphones", "@image"),
					subtitleProperty: coalesceExpression(
						nullExpression(),
						entityExpression("smartphones", "@name"),
					),
				},
			},
		});

		const prepared = await views.prepare({
			userId: "user-1",
			source: {
				kind: "saved-view",
				definition: {
					queryDefinition: body.queryDefinition,
					displayConfiguration: body.displayConfiguration,
				},
			},
		});

		expect(
			prepared.toRuntimeRequest({
				layout: "grid",
				pagination: { page: 1, limit: 10 },
			}),
		).toMatchObject({
			computedFields: [],
			fields: [
				{ key: "image", expression: entityExpression("smartphones", "@image") },
				{ key: "title", expression: entityExpression("smartphones", "@name") },
				{
					key: "subtitle",
					expression: coalesceExpression(
						nullExpression(),
						entityExpression("smartphones", "@name"),
					),
				},
				{ key: "badge", expression: literalExpression("New") },
			],
		});
	});

	it("projects computed fields from saved views into runtime requests", async () => {
		const views = createViewDefinitionModule(createDeps());
		const body = createSavedViewBody({
			queryDefinition: {
				filter: null,
				eventJoins: [],
				entitySchemaSlugs: ["smartphones"],
				sort: sortDefinition(entityExpression("smartphones", "@name")),
				computedFields: [
					{
						key: "displayName",
						expression: entityExpression("smartphones", "@name"),
					},
				],
			},
			displayConfiguration: {
				...createSmartphoneDisplayConfiguration(),
				grid: {
					badgeProperty: null,
					subtitleProperty: null,
					titleProperty: computedExpression("displayName"),
					imageProperty: entityExpression("smartphones", "@image"),
				},
			},
		});

		const prepared = await views.prepare({
			userId: "user-1",
			source: {
				kind: "saved-view",
				definition: {
					queryDefinition: body.queryDefinition,
					displayConfiguration: body.displayConfiguration,
				},
			},
		});

		expect(
			prepared.toRuntimeRequest({
				layout: "grid",
				pagination: { page: 1, limit: 10 },
			}),
		).toMatchObject({
			computedFields: [
				{
					key: "displayName",
					expression: entityExpression("smartphones", "@name"),
				},
			],
			fields: [
				{ key: "image", expression: entityExpression("smartphones", "@image") },
				{ key: "title", expression: computedExpression("displayName") },
				{ key: "subtitle", expression: nullExpression() },
				{ key: "badge", expression: nullExpression() },
			],
		});
	});

	it("rejects computed-field dependency cycles during prepare", async () => {
		const views = createViewDefinitionModule(createDeps());
		const body = createSavedViewBody({
			queryDefinition: {
				filter: null,
				eventJoins: [],
				entitySchemaSlugs: ["smartphones"],
				computedFields: [
					{ key: "first", expression: computedExpression("second") },
					{ key: "second", expression: computedExpression("first") },
				],
				sort: sortDefinition(entityExpression("smartphones", "@name")),
			},
			displayConfiguration: {
				...createSmartphoneDisplayConfiguration(),
				grid: {
					badgeProperty: null,
					subtitleProperty: null,
					titleProperty: computedExpression("first"),
					imageProperty: entityExpression("smartphones", "@image"),
				},
			},
		});

		expect(
			views.prepare({
				userId: "user-1",
				source: {
					kind: "saved-view",
					definition: {
						queryDefinition: body.queryDefinition,
						displayConfiguration: body.displayConfiguration,
					},
				},
			}),
		).rejects.toThrow(
			"Computed field dependency cycle detected: first -> second -> first",
		);
	});

	it("rejects computed sort expressions that mix image values into coalesce branches", async () => {
		const views = createViewDefinitionModule(createDeps());

		expect(
			views.prepare({
				userId: "user-1",
				source: {
					kind: "runtime",
					request: {
						filter: null,
						eventJoins: [],
						pagination: { page: 1, limit: 10 },
						entitySchemaSlugs: ["smartphones"],
						sort: {
							direction: "asc",
							expression: computedExpression("unsafeSort"),
						},
						fields: [
							{
								key: "title",
								expression: entityExpression("smartphones", "@name"),
							},
						],
						computedFields: [
							{
								key: "unsafeSort",
								expression: coalesceExpression(
									entityExpression("smartphones", "@image"),
									entityExpression("smartphones", "@name"),
								),
							},
						],
					},
				},
			}),
		).rejects.toThrow(
			"Expression branches cannot mix display-only image values",
		);
	});

	it("rejects contains filters with null literal values", async () => {
		const views = createViewDefinitionModule(createDeps());

		expect(
			views.prepare({
				userId: "user-1",
				source: {
					kind: "runtime",
					request: {
						eventJoins: [],
						pagination: { page: 1, limit: 10 },
						entitySchemaSlugs: ["smartphones"],
						sort: sortDefinition(entityExpression("smartphones", "@name")),
						filter: {
							type: "contains",
							value: literalExpression(null),
							expression: entityExpression("smartphones", "tags"),
						},
						fields: [
							{
								key: "title",
								expression: entityExpression("smartphones", "@name"),
							},
						],
					},
				},
			}),
		).rejects.toThrow("Filter operator 'contains' does not support null");
	});

	it("executes runtime requests through the prepared boundary", async () => {
		const deps = createDeps();
		const views = createViewDefinitionModule(deps);
		const request = {
			eventJoins: [],
			pagination: { page: 1, limit: 25 },
			entitySchemaSlugs: ["smartphones"],
			sort: sortDefinition(entityExpression("smartphones", "@name")),
			filter: comparisonPredicate(
				entityExpression("smartphones", "manufacturer"),
				literalExpression("Apple"),
			),
			fields: [
				{ key: "image", expression: entityExpression("smartphones", "@image") },
				{ key: "title", expression: entityExpression("smartphones", "@name") },
				{ key: "subtitle", expression: nullExpression() },
				{ key: "badge", expression: nullExpression() },
			],
		};

		const prepared = await views.prepare({
			userId: "user-1",
			source: { kind: "runtime", request },
		});

		await prepared.execute();

		expect(deps.executePreparedView).toHaveBeenCalledTimes(1);
		expect(deps.executePreparedView.mock.calls[0]?.[0]).toMatchObject({
			request,
			userId: "user-1",
		});
	});

	it("rejects projecting prepared runtime views into new runtime requests", async () => {
		const views = createViewDefinitionModule(createDeps());
		const prepared = await views.prepare({
			userId: "user-1",
			source: {
				kind: "runtime",
				request: {
					filter: null,
					eventJoins: [],
					pagination: { page: 1, limit: 10 },
					entitySchemaSlugs: ["smartphones"],
					sort: sortDefinition(entityExpression("smartphones", "@name")),
					fields: [
						{
							key: "title",
							expression: entityExpression("smartphones", "@name"),
						},
					],
				},
			},
		});

		expect(() =>
			prepared.toRuntimeRequest({
				layout: "table",
				pagination: { page: 1, limit: 10 },
			}),
		).toThrow("Only saved views can be projected into runtime requests");
	});

	it("rejects assertSavable for prepared runtime views", async () => {
		const views = createViewDefinitionModule(createDeps());
		const prepared = await views.prepare({
			userId: "user-1",
			source: {
				kind: "runtime",
				request: {
					filter: null,
					eventJoins: [],
					pagination: { page: 1, limit: 10 },
					entitySchemaSlugs: ["smartphones"],
					sort: sortDefinition(entityExpression("smartphones", "@name")),
					fields: [
						{
							key: "title",
							expression: entityExpression("smartphones", "@name"),
						},
					],
				},
			},
		});

		expect(() => prepared.assertSavable()).toThrow(
			"Only saved views can be asserted as savable",
		);
	});

	it("rejects missing schemas during prepare", async () => {
		const views = createViewDefinitionModule(
			createDeps({
				loadVisibleSchemas: mock(async () => {
					throw new ViewRuntimeNotFoundError("Schema 'smartphones' not found");
				}),
			}),
		);
		const body = createSavedViewBody({
			displayConfiguration: createSmartphoneDisplayConfiguration(),
			queryDefinition: {
				filter: null,
				eventJoins: [],
				entitySchemaSlugs: ["smartphones"],
				sort: sortDefinition(entityExpression("smartphones", "@name")),
			},
		});

		expect(
			views.prepare({
				userId: "user-1",
				source: {
					kind: "saved-view",
					definition: {
						queryDefinition: body.queryDefinition,
						displayConfiguration: body.displayConfiguration,
					},
				},
			}),
		).rejects.toThrow("Schema 'smartphones' not found");
	});

	it("requires layout and pagination to execute saved views", async () => {
		const views = createViewDefinitionModule(createDeps());
		const body = createSavedViewBody({
			displayConfiguration: createSmartphoneDisplayConfiguration(),
			queryDefinition: {
				filter: null,
				eventJoins: [],
				entitySchemaSlugs: ["smartphones"],
				sort: sortDefinition(entityExpression("smartphones", "@name")),
			},
		});

		const prepared = await views.prepare({
			userId: "user-1",
			source: {
				kind: "saved-view",
				definition: {
					queryDefinition: body.queryDefinition,
					displayConfiguration: body.displayConfiguration,
				},
			},
		});

		expect(prepared.execute()).rejects.toThrow(
			"Layout and pagination are required to execute a saved view",
		);
	});
});
