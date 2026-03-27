import type { AppSchema } from "@ryot/ts-utils";
import { and, eq, inArray, isNull, or } from "drizzle-orm";
import { db } from "~/lib/db";
import { entitySchema } from "~/lib/db/schema";
import {
	buildSchemaMap,
	type ViewRuntimeSchemaLike,
} from "~/lib/views/reference";
import type {
	DisplayConfiguration,
	SavedViewQueryDefinition,
} from "~/modules/saved-views/schemas";
import {
	executePreparedViewQuery,
	type ViewRuntimeSchemaRow,
} from "~/modules/view-runtime/query-builder";
import type {
	ViewRuntimeRequest,
	ViewRuntimeResponse,
} from "~/modules/view-runtime/schemas";
import { ViewRuntimeNotFoundError, ViewRuntimeValidationError } from "./errors";
import { validateViewRuntimeReferences } from "./validator";

type ViewDefinition = {
	queryDefinition: SavedViewQueryDefinition;
	displayConfiguration: DisplayConfiguration;
};

type ViewSource =
	| { kind: "runtime"; request: ViewRuntimeRequest }
	| { kind: "saved-view"; definition: ViewDefinition };

type RuntimeExecutionInput = {
	layout?: ViewRuntimeRequest["layout"];
	pagination?: ViewRuntimeRequest["pagination"];
};

type ViewDefinitionModuleDeps = {
	loadVisibleSchemas: typeof loadVisibleSchemas;
	executePreparedView: typeof executePreparedView;
};

type PreparedViewState = {
	userId: string;
	source: ViewSource["kind"];
	runtimeRequest?: ViewRuntimeRequest;
	runtimeSchemas: ViewRuntimeSchemaRow[];
	queryDefinition: SavedViewQueryDefinition;
	displayConfiguration: DisplayConfiguration;
	schemaMap: Map<string, ViewRuntimeSchemaRow>;
};

export type PreparedView = {
	assertSavable(): void;
	execute(input?: RuntimeExecutionInput): Promise<ViewRuntimeResponse>;
	toRuntimeRequest(input: {
		layout: ViewRuntimeRequest["layout"];
		pagination: ViewRuntimeRequest["pagination"];
	}): ViewRuntimeRequest;
};

export type ViewDefinitionModule = {
	prepare(input: { userId: string; source: ViewSource }): Promise<PreparedView>;
};

const loadVisibleSchemas = async (input: {
	userId: string;
	entitySchemaSlugs: string[];
}): Promise<ViewRuntimeSchemaRow[]> => {
	const uniqueSlugs = [...new Set(input.entitySchemaSlugs)];
	const rows = await db
		.select({
			id: entitySchema.id,
			slug: entitySchema.slug,
			propertiesSchema: entitySchema.propertiesSchema,
		})
		.from(entitySchema)
		.where(
			and(
				inArray(entitySchema.slug, uniqueSlugs),
				or(isNull(entitySchema.userId), eq(entitySchema.userId, input.userId)),
			),
		);

	const schemas = rows.map((row) => ({
		...row,
		propertiesSchema: row.propertiesSchema as AppSchema,
	}));
	const schemasBySlug = new Map<string, ViewRuntimeSchemaRow[]>();
	for (const schema of schemas) {
		const existing = schemasBySlug.get(schema.slug) ?? [];
		existing.push(schema);
		schemasBySlug.set(schema.slug, existing);
	}

	for (const slug of uniqueSlugs) {
		const found = schemasBySlug.get(slug);
		if (!found?.length) {
			throw new ViewRuntimeNotFoundError(`Schema '${slug}' not found`);
		}

		if (found.length > 1) {
			throw new ViewRuntimeValidationError(
				`Schema '${slug}' resolves to multiple visible schemas`,
			);
		}
	}

	return schemas;
};

const executePreparedView = async (input: {
	userId: string;
	request: ViewRuntimeRequest;
	runtimeSchemas: ViewRuntimeSchemaRow[];
	schemaMap: Map<string, ViewRuntimeSchemaRow>;
}) => executePreparedViewQuery(input);

const emptyCardDisplayConfiguration: DisplayConfiguration["grid"] = {
	imageProperty: null,
	titleProperty: null,
	badgeProperty: null,
	subtitleProperty: null,
};

const emptyDisplayConfiguration: DisplayConfiguration = {
	grid: emptyCardDisplayConfiguration,
	list: emptyCardDisplayConfiguration,
	table: { columns: [] },
};

const buildRuntimeRequest = (input: {
	layout: ViewRuntimeRequest["layout"];
	queryDefinition: SavedViewQueryDefinition;
	displayConfiguration: DisplayConfiguration;
	pagination: ViewRuntimeRequest["pagination"];
}): ViewRuntimeRequest => {
	const shared = {
		pagination: input.pagination,
		sort: input.queryDefinition.sort,
		filters: input.queryDefinition.filters,
		entitySchemaSlugs: input.queryDefinition.entitySchemaSlugs,
	};

	if (input.layout === "grid") {
		return {
			...shared,
			layout: "grid",
			displayConfiguration: input.displayConfiguration.grid,
		};
	}

	if (input.layout === "list") {
		return {
			...shared,
			layout: "list",
			displayConfiguration: input.displayConfiguration.list,
		};
	}

	return {
		...shared,
		layout: "table",
		displayConfiguration: input.displayConfiguration.table,
	};
};

const validateSavedViewDefinition = (input: {
	displayConfiguration: DisplayConfiguration;
	queryDefinition: SavedViewQueryDefinition;
	schemaMap: Map<string, ViewRuntimeSchemaLike>;
}) => {
	for (const layout of ["grid", "list", "table"] as const) {
		const request = buildRuntimeRequest({
			layout,
			pagination: { page: 1, limit: 1 },
			queryDefinition: input.queryDefinition,
			displayConfiguration: input.displayConfiguration,
		});
		validateViewRuntimeReferences(request, input.schemaMap);
	}
};

const buildPreparedRuntimeRequest = (input: {
	runtimeRequest: ViewRuntimeRequest;
	state: Pick<PreparedViewState, "displayConfiguration" | "queryDefinition">;
	executionInput?: RuntimeExecutionInput;
}) => {
	if (
		input.executionInput?.layout &&
		input.executionInput.layout !== input.runtimeRequest.layout
	) {
		throw new ViewRuntimeValidationError(
			"Cannot change layout for a prepared runtime view",
		);
	}

	return buildRuntimeRequest({
		layout: input.runtimeRequest.layout,
		queryDefinition: input.state.queryDefinition,
		displayConfiguration: input.state.displayConfiguration,
		pagination:
			input.executionInput?.pagination ?? input.runtimeRequest.pagination,
	});
};

const createPreparedView = (
	state: PreparedViewState,
	deps: ViewDefinitionModuleDeps,
): PreparedView => ({
	assertSavable() {
		if (state.source !== "saved-view") {
			throw new ViewRuntimeValidationError(
				"Only saved views can be asserted as savable",
			);
		}
	},
	toRuntimeRequest(input) {
		if (state.runtimeRequest && input.layout !== state.runtimeRequest.layout) {
			throw new ViewRuntimeValidationError(
				"Cannot change layout for a prepared runtime view",
			);
		}

		return buildRuntimeRequest({
			layout: input.layout,
			pagination: input.pagination,
			queryDefinition: state.queryDefinition,
			displayConfiguration: state.displayConfiguration,
		});
	},
	async execute(input) {
		const request = state.runtimeRequest
			? buildPreparedRuntimeRequest({
					state,
					runtimeRequest: state.runtimeRequest,
					executionInput: input,
				})
			: input?.layout && input.pagination
				? buildRuntimeRequest({
						layout: input.layout,
						pagination: input.pagination,
						queryDefinition: state.queryDefinition,
						displayConfiguration: state.displayConfiguration,
					})
				: undefined;

		if (!request) {
			throw new ViewRuntimeValidationError(
				"Layout and pagination are required to execute a saved view",
			);
		}

		validateViewRuntimeReferences(request, state.schemaMap);

		return deps.executePreparedView({
			request,
			userId: state.userId,
			schemaMap: state.schemaMap,
			runtimeSchemas: state.runtimeSchemas,
		});
	},
});

const viewDefinitionModuleDeps: ViewDefinitionModuleDeps = {
	loadVisibleSchemas,
	executePreparedView,
};

export const createViewDefinitionModule = (
	deps: ViewDefinitionModuleDeps = viewDefinitionModuleDeps,
): ViewDefinitionModule => ({
	async prepare(input) {
		const queryDefinition =
			input.source.kind === "runtime"
				? {
						filters: input.source.request.filters,
						entitySchemaSlugs: input.source.request.entitySchemaSlugs,
						sort: input.source.request.sort,
					}
				: input.source.definition.queryDefinition;
		const displayConfiguration =
			input.source.kind === "runtime"
				? {
						grid:
							input.source.request.layout === "grid"
								? input.source.request.displayConfiguration
								: emptyDisplayConfiguration.grid,
						list:
							input.source.request.layout === "list"
								? input.source.request.displayConfiguration
								: emptyDisplayConfiguration.list,
						table:
							input.source.request.layout === "table"
								? input.source.request.displayConfiguration
								: emptyDisplayConfiguration.table,
					}
				: input.source.definition.displayConfiguration;
		const runtimeSchemas = await deps.loadVisibleSchemas({
			userId: input.userId,
			entitySchemaSlugs: queryDefinition.entitySchemaSlugs,
		});
		const schemaMap = buildSchemaMap(runtimeSchemas);

		if (input.source.kind === "runtime") {
			validateViewRuntimeReferences(input.source.request, schemaMap);
		} else {
			validateSavedViewDefinition({
				schemaMap,
				queryDefinition,
				displayConfiguration,
			});
		}

		return createPreparedView(
			{
				schemaMap,
				runtimeSchemas,
				queryDefinition,
				displayConfiguration,
				userId: input.userId,
				source: input.source.kind,
				runtimeRequest:
					input.source.kind === "runtime" ? input.source.request : undefined,
			},
			deps,
		);
	},
});

export const viewDefinitionModule = createViewDefinitionModule();
