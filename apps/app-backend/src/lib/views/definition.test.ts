import { describe, expect, it, mock } from "bun:test";
import type { AppSchema } from "@ryot/ts-utils";
import {
	createSavedViewBody,
	createSmartphoneSchema,
	createTabletSchema,
} from "~/lib/test-fixtures";
import { createViewDefinitionModule } from "./definition";
import { ViewRuntimeNotFoundError } from "./errors";

const createRuntimeSchemaRow = (input: {
	id: string;
	slug: string;
	propertiesSchema: AppSchema;
}) => input;

const entityField = (schemaSlug: string, field: string) => {
	return `entity.${schemaSlug}.${field}`;
};

const createSmartphoneDisplayConfiguration = () => ({
	table: {
		columns: [
			{ label: "Name", property: [entityField("smartphones", "@name")] },
		],
	},
	grid: {
		badgeProperty: null,
		subtitleProperty: null,
		titleProperty: [entityField("smartphones", "@name")],
		imageProperty: [entityField("smartphones", "@image")],
	},
	list: {
		badgeProperty: null,
		subtitleProperty: null,
		titleProperty: [entityField("smartphones", "@name")],
		imageProperty: [entityField("smartphones", "@image")],
	},
});

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

	return {
		loadVisibleSchemas,
		executePreparedView,
		loadVisibleEventJoins,
		...overrides,
	} as NonNullable<Parameters<typeof createViewDefinitionModule>[0]> & {
		executePreparedView: typeof executePreparedView;
	};
};

describe("viewDefinitionModule", () => {
	it("validates saved views across all layouts during prepare", async () => {
		const views = createViewDefinitionModule(createDeps());
		const body = createSavedViewBody({
			queryDefinition: {
				filters: [],
				eventJoins: [],
				entitySchemaSlugs: ["smartphones"],
				sort: {
					direction: "asc",
					fields: [entityField("smartphones", "@name")],
				},
			},
			displayConfiguration: {
				table: {
					columns: [
						{ label: "Broken", property: ["entity.smartphones.unknown"] },
					],
				},
				grid: {
					badgeProperty: null,
					subtitleProperty: null,
					titleProperty: [entityField("smartphones", "@name")],
					imageProperty: [entityField("smartphones", "@image")],
				},
				list: {
					badgeProperty: null,
					subtitleProperty: null,
					titleProperty: [entityField("smartphones", "@name")],
					imageProperty: [entityField("smartphones", "@image")],
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
				eventJoins: [],
				entitySchemaSlugs: ["smartphones"],
				filters: [],
				sort: {
					direction: "asc",
					fields: [entityField("smartphones", "@name")],
				},
			},
			displayConfiguration: {
				...createSmartphoneDisplayConfiguration(),
				grid: {
					badgeProperty: null,
					subtitleProperty: null,
					titleProperty: ["event.review.rating"],
					imageProperty: [entityField("smartphones", "@image")],
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
			queryDefinition: {
				eventJoins: [],
				entitySchemaSlugs: ["smartphones"],
				sort: {
					direction: "asc",
					fields: [entityField("smartphones", "@name")],
				},
				filters: [
					{
						op: "eq",
						value: "Apple",
						field: "entity.smartphones.manufacturer",
					},
				],
			},
			displayConfiguration: createSmartphoneDisplayConfiguration(),
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
			sort: body.queryDefinition.sort,
			pagination: { page: 2, limit: 10 },
			filters: body.queryDefinition.filters,
			eventJoins: body.queryDefinition.eventJoins,
			entitySchemaSlugs: body.queryDefinition.entitySchemaSlugs,
			fields: [
				{ key: "image", references: [entityField("smartphones", "@image")] },
				{ key: "title", references: [entityField("smartphones", "@name")] },
				{ key: "subtitle", references: [] },
				{ key: "badge", references: [] },
			],
		});
	});

	it("executes runtime requests through the prepared boundary", async () => {
		const deps = createDeps();
		const views = createViewDefinitionModule(deps);
		const request = {
			eventJoins: [],
			pagination: { page: 1, limit: 25 },
			entitySchemaSlugs: ["smartphones"],
			sort: {
				direction: "asc" as const,
				fields: [entityField("smartphones", "@name")],
			},
			filters: [
				{
					value: "Apple",
					op: "eq" as const,
					field: "entity.smartphones.manufacturer",
				},
			],
			fields: [
				{ key: "image", references: [entityField("smartphones", "@image")] },
				{ key: "title", references: [entityField("smartphones", "@name")] },
				{ key: "subtitle", references: [] },
				{ key: "badge", references: [] },
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
					filters: [],
					eventJoins: [],
					pagination: { page: 1, limit: 10 },
					entitySchemaSlugs: ["smartphones"],
					fields: [
						{ key: "title", references: [entityField("smartphones", "@name")] },
					],
					sort: {
						direction: "asc",
						fields: [entityField("smartphones", "@name")],
					},
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
					filters: [],
					eventJoins: [],
					pagination: { page: 1, limit: 10 },
					entitySchemaSlugs: ["smartphones"],
					fields: [
						{ key: "title", references: [entityField("smartphones", "@name")] },
					],
					sort: {
						direction: "asc",
						fields: [entityField("smartphones", "@name")],
					},
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
				filters: [],
				eventJoins: [],
				entitySchemaSlugs: ["smartphones"],
				sort: {
					direction: "asc",
					fields: [entityField("smartphones", "@name")],
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
		).rejects.toThrow("Schema 'smartphones' not found");
	});

	it("requires layout and pagination to execute saved views", async () => {
		const views = createViewDefinitionModule(createDeps());
		const body = createSavedViewBody({
			displayConfiguration: createSmartphoneDisplayConfiguration(),
			queryDefinition: {
				filters: [],
				eventJoins: [],
				entitySchemaSlugs: ["smartphones"],
				sort: {
					direction: "asc",
					fields: [entityField("smartphones", "@name")],
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

		expect(prepared.execute()).rejects.toThrow(
			"Layout and pagination are required to execute a saved view",
		);
	});
});
