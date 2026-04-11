import type { AppSchema } from "@ryot/ts-utils";
import { and, eq, inArray, isNull, or } from "drizzle-orm";
import { db } from "~/lib/db";
import { entitySchema, eventSchema } from "~/lib/db/schema";
import {
	buildEventJoinMap,
	buildSchemaMap,
	type ViewRuntimeEventJoinLike,
	type ViewRuntimeEventSchemaLike,
	type ViewRuntimeSchemaLike,
} from "~/lib/views/reference";
import type {
	DisplayConfiguration,
	EventJoinDefinition,
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
	loadVisibleEventJoins: typeof loadVisibleEventJoins;
};

type ViewRuntimeEventSchemaRow = ViewRuntimeEventSchemaLike;

type PreparedEventJoin = ViewRuntimeEventJoinLike<ViewRuntimeEventSchemaRow>;

type PreparedViewState = {
	userId: string;
	source: ViewSource["kind"];
	eventJoins: PreparedEventJoin[];
	runtimeRequest?: ViewRuntimeRequest;
	runtimeSchemas: ViewRuntimeSchemaRow[];
	queryDefinition: SavedViewQueryDefinition;
	displayConfiguration: DisplayConfiguration;
	schemaMap: Map<string, ViewRuntimeSchemaRow>;
	eventJoinMap: Map<string, PreparedEventJoin>;
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
	eventJoins: PreparedEventJoin[];
	runtimeSchemas: ViewRuntimeSchemaRow[];
	schemaMap: Map<string, ViewRuntimeSchemaRow>;
	eventJoinMap: Map<string, PreparedEventJoin>;
}) => executePreparedViewQuery(input);

const loadVisibleEventJoins = async (input: {
	userId: string;
	eventJoins: EventJoinDefinition[];
	runtimeSchemas: ViewRuntimeSchemaRow[];
}): Promise<PreparedEventJoin[]> => {
	if (!input.eventJoins.length) {
		return [];
	}

	const uniqueEventSchemaSlugs = [
		...new Set(input.eventJoins.map((join) => join.eventSchemaSlug)),
	];
	const rows = await db
		.select({
			id: eventSchema.id,
			slug: eventSchema.slug,
			entitySchemaSlug: entitySchema.slug,
			entitySchemaId: eventSchema.entitySchemaId,
			propertiesSchema: eventSchema.propertiesSchema,
		})
		.from(eventSchema)
		.innerJoin(entitySchema, eq(eventSchema.entitySchemaId, entitySchema.id))
		.where(
			and(
				inArray(
					eventSchema.entitySchemaId,
					input.runtimeSchemas.map((schema) => schema.id),
				),
				inArray(eventSchema.slug, uniqueEventSchemaSlugs),
				or(isNull(eventSchema.userId), eq(eventSchema.userId, input.userId)),
			),
		);

	const visibleEventSchemas = rows.map((row) => ({
		...row,
		propertiesSchema: row.propertiesSchema as AppSchema,
	}));
	const eventSchemasByEntitySchemaKey = new Map<
		string,
		ViewRuntimeEventSchemaRow
	>();
	for (const schema of visibleEventSchemas) {
		const key = `${schema.entitySchemaSlug}:${schema.slug}`;
		if (eventSchemasByEntitySchemaKey.has(key)) {
			throw new ViewRuntimeValidationError(
				`Event schema '${schema.slug}' resolves to multiple visible schemas for entity schema '${schema.entitySchemaSlug}'`,
			);
		}

		eventSchemasByEntitySchemaKey.set(key, schema);
	}

	return input.eventJoins.map((join) => {
		const eventSchemas = visibleEventSchemas.filter(
			(schema) => schema.slug === join.eventSchemaSlug,
		);
		if (!eventSchemas.length) {
			throw new ViewRuntimeValidationError(
				`Event schema '${join.eventSchemaSlug}' is not available for the requested entity schemas`,
			);
		}

		return {
			...join,
			eventSchemas,
			eventSchemaMap: new Map(
				eventSchemas.map((schema) => [schema.entitySchemaSlug, schema]),
			),
		};
	});
};

const emptyCardDisplayConfiguration: DisplayConfiguration["grid"] = {
	imageProperty: null,
	titleProperty: null,
	badgeProperty: null,
	subtitleProperty: null,
};

const emptyDisplayConfiguration: DisplayConfiguration = {
	table: { columns: [] },
	grid: emptyCardDisplayConfiguration,
	list: emptyCardDisplayConfiguration,
};

const normalizeQueryDefinition = (
	queryDefinition: SavedViewQueryDefinition,
): SavedViewQueryDefinition => ({
	...queryDefinition,
	eventJoins: queryDefinition.eventJoins ?? [],
});

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
		eventJoins: input.queryDefinition.eventJoins,
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
	queryDefinition: SavedViewQueryDefinition;
	displayConfiguration: DisplayConfiguration;
	eventJoinMap: Map<string, PreparedEventJoin>;
	schemaMap: Map<string, ViewRuntimeSchemaLike>;
}) => {
	for (const layout of ["grid", "list", "table"] as const) {
		const request = buildRuntimeRequest({
			layout,
			pagination: { page: 1, limit: 1 },
			queryDefinition: input.queryDefinition,
			displayConfiguration: input.displayConfiguration,
		});
		validateViewRuntimeReferences(request, {
			schemaMap: input.schemaMap,
			eventJoinMap: input.eventJoinMap,
		});
	}
};

const buildPreparedRuntimeRequest = (input: {
	runtimeRequest: ViewRuntimeRequest;
	executionInput?: RuntimeExecutionInput;
	state: Pick<PreparedViewState, "displayConfiguration" | "queryDefinition">;
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

		validateViewRuntimeReferences(request, {
			schemaMap: state.schemaMap,
			eventJoinMap: state.eventJoinMap,
		});

		return deps.executePreparedView({
			request,
			userId: state.userId,
			schemaMap: state.schemaMap,
			eventJoins: state.eventJoins,
			eventJoinMap: state.eventJoinMap,
			runtimeSchemas: state.runtimeSchemas,
		});
	},
});

const viewDefinitionModuleDeps: ViewDefinitionModuleDeps = {
	loadVisibleSchemas,
	executePreparedView,
	loadVisibleEventJoins,
};

export const createViewDefinitionModule = (
	deps: ViewDefinitionModuleDeps = viewDefinitionModuleDeps,
): ViewDefinitionModule => ({
	async prepare(input) {
		const queryDefinition =
			input.source.kind === "runtime"
				? normalizeQueryDefinition({
						sort: input.source.request.sort,
						filters: input.source.request.filters,
						eventJoins: input.source.request.eventJoins,
						entitySchemaSlugs: input.source.request.entitySchemaSlugs,
					})
				: normalizeQueryDefinition(input.source.definition.queryDefinition);
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
		const eventJoins = await deps.loadVisibleEventJoins({
			runtimeSchemas,
			userId: input.userId,
			eventJoins: queryDefinition.eventJoins,
		});
		const schemaMap = buildSchemaMap(runtimeSchemas);
		const eventJoinMap = buildEventJoinMap(eventJoins);

		if (input.source.kind === "runtime") {
			validateViewRuntimeReferences(input.source.request, {
				schemaMap,
				eventJoinMap,
			});
		} else {
			validateSavedViewDefinition({
				schemaMap,
				eventJoinMap,
				queryDefinition,
				displayConfiguration,
			});
		}

		return createPreparedView(
			{
				schemaMap,
				eventJoins,
				eventJoinMap,
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
