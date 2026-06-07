import {
	getQueryEngineField,
	type QueryComputedField,
	type QueryFilter,
	type QueryRelationshipJoin,
	type RuntimeField,
} from "@ryot/app-backend/query-language";

import { requirePresent } from "../test-support/assertions";
import { type Client, createAuthenticatedClient } from "./auth";
import type { ContractPayload, ContractSuccess } from "./contract-client";
import { createEntity } from "./entities";
import { createEntitySchema } from "./entity-schemas";
import { waitForEventCount } from "./events";
import type { CardDisplayConfigurationInput, DisplayConfigurationInput } from "./saved-views";
import { createTracker } from "./trackers";
import {
	type ExpressionInput,
	entityField,
	qualifyBuiltinFields,
	toRequiredExpression,
} from "./view-language";

type QueryEngineFieldValue = { kind: string; value: unknown };
type QueryEngineResponseItem = Readonly<Record<string, QueryEngineFieldValue>>;

export type EntitiesQueryEngineResponse = Extract<
	ContractSuccess<"queryEngine", "execute">,
	{ mode: "entities" }
>;

type EntitiesQueryEngineRequest = Extract<
	ContractPayload<"queryEngine", "execute">,
	{ mode: "entities" }
>;

type QueryEngineField = {
	key: string;
	kind: QueryEngineFieldValue["kind"];
	value: QueryEngineFieldValue["value"];
};

export type QueryEngineRequest = Omit<EntitiesQueryEngineRequest, "mode" | "pagination"> & {
	mode?: "entities";
	pagination?: EntitiesQueryEngineRequest["pagination"];
};

type TableDisplayConfiguration = DisplayConfigurationInput["table"];

type RuntimeFieldsInput =
	| { layout: "table"; displayConfiguration: TableDisplayConfiguration }
	| { layout: "grid" | "list"; displayConfiguration: CardDisplayConfigurationInput };

export function toQueryEngineItem(fields: QueryEngineField[]): QueryEngineResponseItem {
	return Object.fromEntries(fields.map(({ key, ...field }) => [key, field]));
}

interface CreateEntityInput {
	name: string;
	client: Client;
	entitySchemaId: string;
	properties: Record<string, unknown>;
	image?: string | null;
}

interface CreateQueryEngineEventInput {
	client: Client;
	entityId: string;
	occurredAt?: string;
	eventSchemaId: string;
	properties: Record<string, unknown>;
}

type QueryEngineEntityFixture = {
	name: string;
	entitySchemaId: string;
	properties: Record<string, unknown>;
	image?: string | null;
};

const buildCardDisplayConfiguration = (
	schemaSlugs: readonly string[],
	overrides: Partial<CardDisplayConfigurationInput> = {},
): CardDisplayConfigurationInput => {
	const schemaSlug = schemaSlugs[0];

	return {
		secondarySubtitleProperty: null,
		calloutProperty: schemaSlug ? [entityField(schemaSlug, "category")] : null,
		primarySubtitleProperty: schemaSlug ? [entityField(schemaSlug, "year")] : null,
		titleProperty: schemaSlugs.length ? qualifyBuiltinFields(schemaSlugs, "name") : null,
		imageProperty: schemaSlugs.length ? qualifyBuiltinFields(schemaSlugs, "image") : null,
		...overrides,
	};
};

export function buildGridDisplayConfiguration(
	overrides: Partial<CardDisplayConfigurationInput> = {},
	schemaSlugs: readonly string[] = [],
): CardDisplayConfigurationInput {
	return buildCardDisplayConfiguration(schemaSlugs, overrides);
}

export function buildTableDisplayConfiguration(
	columns?: TableDisplayConfiguration["columns"],
	schemaSlugs: readonly string[] = [],
): TableDisplayConfiguration {
	return {
		columns:
			columns ??
			(schemaSlugs.length
				? [{ label: "Name", expression: qualifyBuiltinFields(schemaSlugs, "name") }]
				: []),
	};
}

function toQueryEngineFields(input: RuntimeFieldsInput): RuntimeField[] {
	if (input.layout === "table") {
		return input.displayConfiguration.columns.map((column, index) => ({
			key: `column_${index}`,
			expression: toRequiredExpression(column.expression ?? column.property ?? []),
		}));
	}

	const config = input.displayConfiguration;
	return [
		{
			key: "image",
			expression: toRequiredExpression(config.imageProperty ?? null),
		},
		{
			key: "title",
			expression: toRequiredExpression(config.titleProperty ?? null),
		},
		{
			key: "primarySubtitle",
			expression: toRequiredExpression(config.primarySubtitleProperty ?? null),
		},
		{
			key: "secondarySubtitle",
			expression: toRequiredExpression(config.secondarySubtitleProperty ?? null),
		},
		{
			key: "callout",
			expression: toRequiredExpression(config.calloutProperty ?? null),
		},
	];
}

const defaultSort = (schemaSlugs: readonly string[]): QueryEngineRequest["sort"] => ({
	direction: "asc",
	expression: toRequiredExpression(
		schemaSlugs.length ? qualifyBuiltinFields(schemaSlugs, "name") : [],
	),
});

const buildQueryEngineRequest = (
	input: Partial<Omit<QueryEngineRequest, "fields" | "sort">> & {
		fields: RuntimeField[];
		scope: readonly string[];
		sort?: QueryEngineRequest["sort"];
	},
): EntitiesQueryEngineRequest => ({
	filter: null,
	eventJoins: [],
	mode: "entities",
	computedFields: [],
	relationshipJoins: [],
	pagination: { page: 1, limit: 10 },
	sort: defaultSort(input.scope),
	...input,
});

export function buildQueryEngineField(key: string, expression: ExpressionInput): RuntimeField {
	return { key, expression: toRequiredExpression(expression) };
}

export function buildComputedField(key: string, expression: ExpressionInput): QueryComputedField {
	return { key, expression: toRequiredExpression(expression) };
}

type RelationshipJoinInput = {
	key: string;
	required?: boolean;
	sourceEntityId?: string;
	targetEntityId?: string;
	filter?: QueryFilter | null;
	relationshipSchemaSlug: string;
	direction: "outgoing" | "incoming";
};

export function buildLatestRelationshipJoin(input: RelationshipJoinInput): QueryRelationshipJoin {
	return {
		key: input.key,
		direction: input.direction,
		required: input.required ?? false,
		kind: "latestRelationship" as const,
		relationshipSchemaSlug: input.relationshipSchemaSlug,
		...(input.filter !== undefined && { filter: input.filter }),
		...(input.sourceEntityId !== undefined && { sourceEntityId: input.sourceEntityId }),
		...(input.targetEntityId !== undefined && { targetEntityId: input.targetEntityId }),
	};
}

export function buildRequiredLatestRelationshipJoin(
	input: Omit<RelationshipJoinInput, "required">,
): QueryRelationshipJoin {
	return buildLatestRelationshipJoin({ ...input, required: true });
}

export const buildInLibraryRelationshipJoin = (required = true): QueryRelationshipJoin =>
	buildLatestRelationshipJoin({
		required,
		key: "inLibrary",
		direction: "outgoing",
		relationshipSchemaSlug: "in-library",
	});

export function buildGridRequest(
	overrides: Partial<Omit<QueryEngineRequest, "fields">> & {
		scope: readonly string[];
		displayConfiguration?: CardDisplayConfigurationInput;
	},
): EntitiesQueryEngineRequest {
	const {
		scope,
		displayConfiguration: displayConfigurationOverride,
		...requestOverrides
	} = overrides;
	const displayConfiguration =
		displayConfigurationOverride ?? buildGridDisplayConfiguration({}, scope);

	return buildQueryEngineRequest({
		scope,
		fields: toQueryEngineFields({ layout: "grid", displayConfiguration }),
		...requestOverrides,
	});
}

export function buildListRequest(
	overrides: Partial<Omit<QueryEngineRequest, "fields">> & {
		scope: readonly string[];
		displayConfiguration?: CardDisplayConfigurationInput;
	},
): EntitiesQueryEngineRequest {
	const {
		scope,
		displayConfiguration: displayConfigurationOverride,
		...requestOverrides
	} = overrides;
	const displayConfiguration =
		displayConfigurationOverride ?? buildGridDisplayConfiguration({}, scope);

	return buildQueryEngineRequest({
		scope,
		fields: toQueryEngineFields({ layout: "list", displayConfiguration }),
		...requestOverrides,
	});
}

export function buildTableRequest(
	overrides: Partial<Omit<QueryEngineRequest, "fields">> & {
		scope: readonly string[];
		displayConfiguration?: TableDisplayConfiguration;
	},
): EntitiesQueryEngineRequest {
	const {
		scope,
		displayConfiguration: displayConfigurationOverride,
		...requestOverrides
	} = overrides;
	const displayConfiguration =
		displayConfigurationOverride ?? buildTableDisplayConfiguration(undefined, scope);

	return buildQueryEngineRequest({
		scope,
		fields: toQueryEngineFields({ layout: "table", displayConfiguration }),
		...requestOverrides,
	});
}

export function getQueryEngineFieldOrThrow(item: QueryEngineResponseItem | undefined, key: string) {
	const field = getQueryEngineField(item, key);
	return requirePresent(field, `Expected query engine field '${key}'`);
}

export function getQueryEngineFieldValue(
	item: Parameters<typeof getQueryEngineFieldOrThrow>[0],
	key: string,
) {
	return getQueryEngineFieldOrThrow(item, key).value;
}

const toExecuteRequest = (body: QueryEngineRequest): { payload: EntitiesQueryEngineRequest } => ({
	payload: {
		...body,
		mode: body.mode ?? "entities",
		pagination: body.pagination ?? { page: 1, limit: 10 },
	},
});

function requireEntitiesModeResponse(
	result: ContractSuccess<"queryEngine", "execute">,
): EntitiesQueryEngineResponse {
	if (result.mode !== "entities") {
		throw new Error(`Expected an entities-mode query engine response, received '${result.mode}'`);
	}

	return result;
}

export async function executeQueryEngine(
	client: Client,
	body: QueryEngineRequest,
): Promise<{ data: EntitiesQueryEngineResponse }> {
	const result = await client.run((c) => c.queryEngine.execute(toExecuteRequest(body)));

	return { data: requireEntitiesModeResponse(result) };
}

export async function executeQueryEngineError(client: Client, body: QueryEngineRequest) {
	return client.runError((c) => c.queryEngine.execute(toExecuteRequest(body)));
}

export async function createQueryEngineEntity(input: CreateEntityInput) {
	const entity = await createEntity(input.client, {
		name: input.name,
		properties: input.properties,
		entitySchemaId: input.entitySchemaId,
		image:
			input.image === undefined
				? `https://example.com/${input.name.toLowerCase().replace(/\s+/g, "-")}.png`
				: input.image,
	});

	return requirePresent(entity.id, `Failed to create entity '${input.name}'`);
}

export async function createQueryEngineEvent(input: CreateQueryEngineEventInput) {
	const before = await input.client.run((c) =>
		c.events.list({ urlParams: { entityId: input.entityId } }),
	);
	const beforeCount = before.length;

	const createdEvent = await input.client.run((c) =>
		c.events.create({
			payload: [
				{
					entityId: input.entityId,
					occurredAt: input.occurredAt,
					properties: input.properties,
					eventSchemaId: input.eventSchemaId,
				},
			],
		}),
	);
	if (createdEvent.count !== 1) {
		throw new Error(`Failed to create event for '${input.entityId}'`);
	}

	await waitForEventCount(input.client, input.entityId, beforeCount + 1);
}

const createQueryEngineEntities = async (input: {
	client: Client;
	entities: QueryEngineEntityFixture[];
}) => {
	const entries = await Promise.all(
		input.entities.map(
			async (entity) =>
				[
					entity.name,
					await createQueryEngineEntity({
						name: entity.name,
						image: entity.image,
						client: input.client,
						properties: entity.properties,
						entitySchemaId: entity.entitySchemaId,
					}),
				] as const,
		),
	);

	return Object.fromEntries(entries);
};

export async function createSingleSchemaQueryEngineFixture() {
	const { client, cookies } = await createAuthenticatedClient();
	const { trackerId } = await createTracker(client, {
		name: "Device Tracker",
	});
	const schema = await createEntitySchema(client, {
		trackerId,
		name: "Device",
		propertiesSchema: {
			fields: {
				year: { type: "integer", label: "Year", description: "Year" },
				category: { type: "string", label: "Category", description: "Category" },
				manufacturer: { type: "string", label: "Manufacturer", description: "Manufacturer" },
			},
		},
	});

	const entities: QueryEngineEntityFixture[] = [
		{
			name: "Alpha Phone",
			entitySchemaId: schema.schemaId,
			properties: { year: 2018, category: "phone", manufacturer: "Acme" },
		},
		{
			name: "Beta Tablet",
			entitySchemaId: schema.schemaId,
			properties: { year: 2019, category: "tablet", manufacturer: "Tabula" },
		},
		{
			name: "Gamma Phone",
			entitySchemaId: schema.schemaId,
			properties: { year: 2020, category: "phone", manufacturer: "Zenith" },
		},
		{
			name: "Delta Watch",
			entitySchemaId: schema.schemaId,
			properties: { year: 2021, category: "wearable", manufacturer: "Orbit" },
		},
		{
			name: "Omega Prototype",
			entitySchemaId: schema.schemaId,
			properties: { manufacturer: "Ghost" },
		},
	];
	const entityIdsByName = await createQueryEngineEntities({
		client,
		entities,
	});

	return { client, cookies, schema, entityIdsByName };
}

export async function createCrossSchemaQueryEngineFixture() {
	const { client, cookies } = await createAuthenticatedClient();
	const { trackerId } = await createTracker(client, {
		name: "Mixed Device Tracker",
	});
	const smartphoneSchema = await createEntitySchema(client, {
		trackerId,
		name: "Smartphone",
		slug: `smartphones-${crypto.randomUUID()}`,
		propertiesSchema: {
			fields: {
				year: { type: "integer", label: "Year", description: "Year" },
				category: { type: "string", label: "Category", description: "Category" },
				manufacturer: { type: "string", label: "Manufacturer", description: "Manufacturer" },
			},
		},
	});
	const tabletSchema = await createEntitySchema(client, {
		trackerId,
		icon: "tablet",
		name: "Tablet",
		slug: `tablets-${crypto.randomUUID()}`,
		propertiesSchema: {
			fields: {
				maker: { type: "string", label: "Maker", description: "Maker" },
				category: { type: "string", label: "Category", description: "Category" },
				releaseYear: { type: "integer", label: "Release Year", description: "Release year" },
				releaseLabel: { type: "string", label: "Release Label", description: "Release label" },
			},
		},
	});

	const entities: QueryEngineEntityFixture[] = [
		{
			name: "Alpha Phone",
			entitySchemaId: smartphoneSchema.schemaId,
			properties: { year: 2018, category: "phone", manufacturer: "Acme" },
		},
		{
			name: "Gamma Phone",
			entitySchemaId: smartphoneSchema.schemaId,
			properties: { year: 2020, category: "phone", manufacturer: "Zenith" },
		},
		{
			name: "Omega Phone",
			entitySchemaId: smartphoneSchema.schemaId,
			properties: { year: 2024, manufacturer: "Nova" },
		},
		{
			name: "Beta Tablet",
			entitySchemaId: tabletSchema.schemaId,
			properties: { maker: "Tabula", releaseYear: 2019, category: "tablet", releaseLabel: "2019" },
		},
		{
			name: "Delta Tablet",
			entitySchemaId: tabletSchema.schemaId,
			properties: { releaseYear: 2021, category: "tablet", releaseLabel: "2021" },
		},
	];
	const entityIdsByName = await createQueryEngineEntities({ client, entities });

	return {
		client,
		cookies,
		tabletSchema,
		entityIdsByName,
		smartphoneSchema,
		tabletSlug: tabletSchema.slug,
		smartphoneSlug: smartphoneSchema.slug,
	};
}
