import type {
	EntityRecord,
	EntitySchemaRecord,
	EventRecord,
	IntegrationRecord,
	JsonValue,
} from "@ryot/sandbox-sdk";
import type { AfterCreateTriggerInput, BeforeCreateTriggerInput } from "@ryot/sandbox-sdk/trigger";
import { isObjectRecord } from "@ryot/ts-utils/predicates";

const timestamp = "2026-01-01T00:00:00.000Z";

export const execution = { metadata: {}, sandboxScriptId: "script-test" };

export const afterCreateContext = (
	overrides: Partial<AfterCreateTriggerInput["trigger"]> = {},
): AfterCreateTriggerInput => ({
	trigger: {
		properties: {},
		eventId: "event-1",
		entityId: "entity-1",
		createdAt: timestamp,
		updatedAt: timestamp,
		occurredAt: timestamp,
		phase: "after_create",
		inheritedProperties: {},
		entitySchemaSlug: "movie",
		eventSchemaSlug: "progress",
		eventSchemaId: "event-schema-1",
		entitySchemaId: "entity-schema-1",
		...overrides,
	},
});

export const beforeCreateContext = (
	overrides: Partial<BeforeCreateTriggerInput["trigger"]> = {},
): BeforeCreateTriggerInput => ({
	trigger: {
		properties: {},
		userId: "user-1",
		entityId: "entity-1",
		origin: "integration",
		occurredAt: timestamp,
		phase: "before_create",
		entitySchemaSlug: "movie",
		eventSchemaSlug: "progress",
		integrationId: "integration-1",
		eventSchemaId: "event-schema-1",
		entitySchemaId: "entity-schema-1",
		...overrides,
	},
});

export const entityRecord = (overrides: Partial<EntityRecord> = {}): EntityRecord => ({
	id: "entity-1",
	properties: {},
	name: "Entity",
	externalId: null,
	populatedAt: null,
	createdAt: timestamp,
	updatedAt: timestamp,
	sandboxScriptId: null,
	entitySchemaId: "entity-schema-1",
	...overrides,
});

export const entitySchemaRecord = (
	overrides: Partial<EntitySchemaRecord> = {},
): EntitySchemaRecord => ({
	providers: [],
	icon: "circle",
	name: "Entity",
	slug: "entity",
	isBuiltin: true,
	propertiesSchema: {},
	id: "entity-schema-1",
	trackerId: "tracker-1",
	accentColor: "#000000",
	...overrides,
});

export const eventRecord = (overrides: Partial<EventRecord> = {}): EventRecord => ({
	id: "event-1",
	properties: {},
	entityId: "entity-1",
	createdAt: timestamp,
	updatedAt: timestamp,
	occurredAt: timestamp,
	eventSchemaName: "Progress",
	eventSchemaSlug: "progress",
	eventSchemaId: "event-schema-1",
	...overrides,
});

export const integrationRecord = (
	overrides: Partial<IntegrationRecord> = {},
): IntegrationRecord => ({
	name: null,
	lot: "push",
	userId: "user-1",
	isDisabled: false,
	provider: "radarr",
	minimumProgress: 2,
	id: "integration-1",
	syncOwnership: false,
	maximumProgress: 95,
	lastFinishedAt: null,
	createdAt: timestamp,
	updatedAt: timestamp,
	providerSpecifics: {},
	extraSettings: { disableOnContinuousErrors: false },
	...overrides,
});

export const hostSuccess = <Data>(data: Data) => Promise.resolve({ success: true as const, data });

export const hostFailure = (message = "not found") =>
	Promise.resolve({ error: message, success: false as const });

export const httpSuccess = (body: JsonValue) =>
	hostSuccess({
		status: 200,
		headers: {},
		body: typeof body === "string" ? body : JSON.stringify(body),
	});

export const httpFailure = (message = "request failed", status = 500) =>
	Promise.resolve({ error: message, success: false as const, data: { status } });

export const toRecord = (value: unknown): Record<string, unknown> =>
	isObjectRecord(value) ? value : Object.create(null);
