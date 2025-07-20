import { and, eq, inArray, isNull, or } from "drizzle-orm";
import { match } from "ts-pattern";
import { db } from "~/lib/db";
import { entitySchema, eventSchema } from "~/lib/db/schema";
import { nullViewExpression } from "~/lib/views/expression";
import {
	buildEventJoinMap,
	buildSchemaMap,
	type QueryEngineEventJoinLike,
	type QueryEngineEventSchemaLike,
	type QueryEngineSchemaLike,
} from "~/lib/views/reference";
import { propertySchemaObjectSchema } from "~/modules/property-schemas";
import {
	executePreparedQuery,
	type QueryEngineField,
	type QueryEngineRequest,
	type QueryEngineResponse,
	type QueryEngineSchemaRow,
} from "~/modules/query-engine";
import type {
	DisplayConfiguration,
	EventJoinDefinition,
	SavedViewQueryDefinition,
} from "~/modules/saved-views";
import { QueryEngineNotFoundError, QueryEngineValidationError } from "./errors";
import {
	validateQueryEngineReferences,
	validateSavedViewDisplayConfiguration,
} from "./validator";

type ViewDefinition = {
	queryDefinition: SavedViewQueryDefinition;
	displayConfiguration: DisplayConfiguration;
};

type ViewSource =
	| { kind: "runtime"; request: QueryEngineRequest }
	| { kind: "saved-view"; definition: ViewDefinition };

type SavedViewLayout = keyof DisplayConfiguration;

type RuntimeExecutionInput = {
	layout?: SavedViewLayout;
	pagination?: QueryEngineRequest["pagination"];
};

type ViewDefinitionModuleDeps = {
	loadVisibleSchemas: typeof loadVisibleSchemas;
	executePreparedView: typeof executePreparedView;
	loadVisibleEventJoins: typeof loadVisibleEventJoins;
};

type QueryEngineEventSchemaRow = QueryEngineEventSchemaLike;

type PreparedEventJoin = QueryEngineEventJoinLike<QueryEngineEventSchemaRow>;

const parseAppSchema = (value: unknown) => {
	return propertySchemaObjectSchema.parse(value);
};

type PreparedViewState = {
	userId: string;
	source: ViewSource["kind"];
	eventJoins: PreparedEventJoin[];
	runtimeRequest?: QueryEngineRequest;
	runtimeSchemas: QueryEngineSchemaRow[];
	queryDefinition: SavedViewQueryDefinition;
	displayConfiguration?: DisplayConfiguration;
	schemaMap: Map<string, QueryEngineSchemaRow>;
	eventJoinMap: Map<string, PreparedEventJoin>;
};

export type PreparedView = {
	assertSavable(): void;
	execute(input?: RuntimeExecutionInput): Promise<QueryEngineResponse>;
	toRuntimeRequest(input: {
		layout: SavedViewLayout;
		pagination: QueryEngineRequest["pagination"];
	}): QueryEngineRequest;
};

export type ViewDefinitionModule = {
	prepare(input: { userId: string; source: ViewSource }): Promise<PreparedView>;
};

const loadVisibleSchemas = async (input: {
	userId: string;
	entitySchemaSlugs: string[];
}): Promise<QueryEngineSchemaRow[]> => {
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
		propertiesSchema: parseAppSchema(row.propertiesSchema),
	}));
	const schemasBySlug = new Map<string, QueryEngineSchemaRow[]>();
	for (const schema of schemas) {
		const existing = schemasBySlug.get(schema.slug) ?? [];
		existing.push(schema);
		schemasBySlug.set(schema.slug, existing);
	}

	for (const slug of uniqueSlugs) {
		const found = schemasBySlug.get(slug);
		if (!found?.length) {
			throw new QueryEngineNotFoundError(`Schema '${slug}' not found`);
		}

		if (found.length > 1) {
			throw new QueryEngineValidationError(
				`Schema '${slug}' resolves to multiple visible schemas`,
			);
		}
	}

	return schemas;
};

const executePreparedView = async (input: {
	userId: string;
	request: QueryEngineRequest;
	eventJoins: PreparedEventJoin[];
	runtimeSchemas: QueryEngineSchemaRow[];
	schemaMap: Map<string, QueryEngineSchemaRow>;
	eventJoinMap: Map<string, PreparedEventJoin>;
}) => executePreparedQuery(input);

const loadVisibleEventJoins = async (input: {
	userId: string;
	eventJoins: EventJoinDefinition[];
	runtimeSchemas: QueryEngineSchemaRow[];
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
		propertiesSchema: parseAppSchema(row.propertiesSchema),
	}));
	const eventSchemasByEntitySchemaKey = new Map<
		string,
		QueryEngineEventSchemaRow
	>();
	for (const schema of visibleEventSchemas) {
		const key = `${schema.entitySchemaSlug}:${schema.slug}`;
		if (eventSchemasByEntitySchemaKey.has(key)) {
			throw new QueryEngineValidationError(
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
			throw new QueryEngineValidationError(
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

const normalizeQueryDefinition = (
	queryDefinition: SavedViewQueryDefinition,
): SavedViewQueryDefinition => ({
	...queryDefinition,
	filter: queryDefinition.filter ?? null,
	eventJoins: queryDefinition.eventJoins ?? [],
	computedFields: queryDefinition.computedFields ?? [],
});

const buildRuntimeFields = (input: {
	layout: SavedViewLayout;
	displayConfiguration: DisplayConfiguration;
}): QueryEngineField[] => {
	const buildCardRuntimeFields = (
		configuration: DisplayConfiguration["grid"],
	) => {
		return [
			{
				key: "image",
				expression: configuration.imageProperty ?? nullViewExpression,
			},
			{
				key: "title",
				expression: configuration.titleProperty ?? nullViewExpression,
			},
			{
				key: "subtitle",
				expression: configuration.subtitleProperty ?? nullViewExpression,
			},
			{
				key: "badge",
				expression: configuration.badgeProperty ?? nullViewExpression,
			},
		];
	};

	return match(input.layout)
		.with("grid", () => buildCardRuntimeFields(input.displayConfiguration.grid))
		.with("list", () => buildCardRuntimeFields(input.displayConfiguration.list))
		.with("table", () => {
			return input.displayConfiguration.table.columns.map((column, index) => ({
				key: `column_${index}`,
				expression: column.expression,
			}));
		})
		.exhaustive();
};

const buildRuntimeRequest = (input: {
	fields: QueryEngineField[];
	queryDefinition: SavedViewQueryDefinition;
	pagination: QueryEngineRequest["pagination"];
}): QueryEngineRequest => {
	return {
		fields: input.fields,
		pagination: input.pagination,
		sort: input.queryDefinition.sort,
		filter: input.queryDefinition.filter,
		eventJoins: input.queryDefinition.eventJoins,
		computedFields: input.queryDefinition.computedFields,
		entitySchemaSlugs: input.queryDefinition.entitySchemaSlugs,
	};
};

const validateSavedViewDefinition = (input: {
	queryDefinition: SavedViewQueryDefinition;
	displayConfiguration: DisplayConfiguration;
	eventJoinMap: Map<string, PreparedEventJoin>;
	schemaMap: Map<string, QueryEngineSchemaLike>;
}) => {
	validateQueryEngineReferences(
		buildRuntimeRequest({
			fields: [],
			pagination: { page: 1, limit: 1 },
			queryDefinition: input.queryDefinition,
		}),
		{ schemaMap: input.schemaMap, eventJoinMap: input.eventJoinMap },
	);
	validateSavedViewDisplayConfiguration(
		input.displayConfiguration,
		{
			schemaMap: input.schemaMap,
			eventJoinMap: input.eventJoinMap,
		},
		input.queryDefinition.computedFields,
	);
};

const createPreparedView = (
	state: PreparedViewState,
	deps: ViewDefinitionModuleDeps,
): PreparedView => ({
	assertSavable() {
		if (state.source !== "saved-view") {
			throw new QueryEngineValidationError(
				"Only saved views can be asserted as savable",
			);
		}
	},
	toRuntimeRequest(input) {
		if (!state.displayConfiguration) {
			throw new QueryEngineValidationError(
				"Only saved views can be projected into runtime requests",
			);
		}

		return buildRuntimeRequest({
			pagination: input.pagination,
			queryDefinition: state.queryDefinition,
			fields: buildRuntimeFields({
				layout: input.layout,
				displayConfiguration: state.displayConfiguration,
			}),
		});
	},
	async execute(input) {
		const request = state.runtimeRequest
			? state.runtimeRequest
			: input?.layout && input.pagination && state.displayConfiguration
				? buildRuntimeRequest({
						pagination: input.pagination,
						queryDefinition: state.queryDefinition,
						fields: buildRuntimeFields({
							layout: input.layout,
							displayConfiguration: state.displayConfiguration,
						}),
					})
				: undefined;

		if (!request) {
			throw new QueryEngineValidationError(
				"Layout and pagination are required to execute a saved view",
			);
		}

		validateQueryEngineReferences(request, {
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
						filter: input.source.request.filter,
						eventJoins: input.source.request.eventJoins,
						entitySchemaSlugs: input.source.request.entitySchemaSlugs,
					})
				: normalizeQueryDefinition(input.source.definition.queryDefinition);
		const displayConfiguration =
			input.source.kind === "saved-view"
				? input.source.definition.displayConfiguration
				: undefined;
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
			validateQueryEngineReferences(input.source.request, {
				schemaMap,
				eventJoinMap,
			});
		} else {
			validateSavedViewDefinition({
				schemaMap,
				eventJoinMap,
				queryDefinition,
				displayConfiguration: input.source.definition.displayConfiguration,
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
