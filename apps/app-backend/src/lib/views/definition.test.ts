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
	const executePreparedView = mock(async ({ request }) => {
		const pagination = {
			total: 0,
			totalPages: 0,
			hasNextPage: false,
			hasPreviousPage: false,
			page: request.pagination.page,
			limit: request.pagination.limit,
		};

		if (request.layout === "table") {
			return { items: [], meta: { pagination, table: { columns: [] } } };
		}

		return { items: [], meta: { pagination } };
	});

	return {
		loadVisibleSchemas,
		executePreparedView,
		...overrides,
	} as NonNullable<Parameters<typeof createViewDefinitionModule>[0]> & {
		executePreparedView: typeof executePreparedView;
	};
};

describe("viewDefinitionModule", () => {
	it("validates saved views across all layouts during prepare", async () => {
		const views = createViewDefinitionModule(createDeps());
		const body = createSavedViewBody({
			displayConfiguration: {
				table: {
					columns: [{ label: "Broken", property: ["smartphones.unknown"] }],
				},
				grid: {
					badgeProperty: null,
					subtitleProperty: null,
					titleProperty: ["@name"],
					imageProperty: ["@image"],
				},
				list: {
					badgeProperty: null,
					subtitleProperty: null,
					titleProperty: ["@name"],
					imageProperty: ["@image"],
				},
			},
		});

		await expect(
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

	it("projects a saved view into a runtime request", async () => {
		const views = createViewDefinitionModule(createDeps());
		const body = createSavedViewBody({
			queryDefinition: {
				entitySchemaSlugs: ["smartphones"],
				sort: { fields: ["@name"], direction: "asc" },
				filters: [
					{ op: "eq", field: "smartphones.manufacturer", value: "Apple" },
				],
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
			layout: "grid",
			sort: body.queryDefinition.sort,
			pagination: { page: 2, limit: 10 },
			filters: body.queryDefinition.filters,
			displayConfiguration: body.displayConfiguration.grid,
			entitySchemaSlugs: body.queryDefinition.entitySchemaSlugs,
		});
	});

	it("executes runtime requests through the prepared boundary", async () => {
		const deps = createDeps();
		const views = createViewDefinitionModule(deps);
		const request = {
			layout: "grid" as const,
			pagination: { page: 1, limit: 25 },
			entitySchemaSlugs: ["smartphones"],
			sort: { fields: ["@name"], direction: "asc" as const },
			filters: [
				{
					value: "Apple",
					op: "eq" as const,
					field: "smartphones.manufacturer",
				},
			],
			displayConfiguration: {
				badgeProperty: null,
				subtitleProperty: null,
				titleProperty: ["@name"],
				imageProperty: ["@image"],
			},
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

	it("rejects layout changes for prepared runtime views", async () => {
		const views = createViewDefinitionModule(createDeps());
		const prepared = await views.prepare({
			userId: "user-1",
			source: {
				kind: "runtime",
				request: {
					filters: [],
					layout: "grid",
					pagination: { page: 1, limit: 10 },
					entitySchemaSlugs: ["smartphones"],
					sort: { fields: ["@name"], direction: "asc" },
					displayConfiguration: {
						badgeProperty: null,
						subtitleProperty: null,
						titleProperty: ["@name"],
						imageProperty: ["@image"],
					},
				},
			},
		});

		expect(() =>
			prepared.toRuntimeRequest({
				layout: "table",
				pagination: { page: 1, limit: 10 },
			}),
		).toThrow("Cannot change layout for a prepared runtime view");

		expect(
			prepared.execute({
				layout: "table",
				pagination: { page: 1, limit: 10 },
			}),
		).rejects.toThrow("Cannot change layout for a prepared runtime view");
	});

	it("rejects assertSavable for prepared runtime views", async () => {
		const views = createViewDefinitionModule(createDeps());
		const prepared = await views.prepare({
			userId: "user-1",
			source: {
				kind: "runtime",
				request: {
					filters: [],
					layout: "grid",
					pagination: { page: 1, limit: 10 },
					entitySchemaSlugs: ["smartphones"],
					sort: { fields: ["@name"], direction: "asc" },
					displayConfiguration: {
						badgeProperty: null,
						subtitleProperty: null,
						titleProperty: ["@name"],
						imageProperty: ["@image"],
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
			queryDefinition: {
				entitySchemaSlugs: ["smartphones"],
				filters: [],
				sort: { fields: ["@name"], direction: "asc" },
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
			queryDefinition: {
				filters: [],
				entitySchemaSlugs: ["smartphones"],
				sort: { fields: ["@name"], direction: "asc" },
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
