import type {
	AutomationInput,
	AutomationPolicyInput,
	AutomationEventSnapshot,
} from "@ryot/sandbox-sdk/automation";
import type {
	EntityRecord,
	EntitySchemaRecord,
	EventRecord,
	IntegrationRecord,
	JsonValue,
} from "@ryot/sandbox-sdk/core";
import { isObjectRecord } from "@ryot/ts-utils/predicates";

const timestamp = "2026-01-01T00:00:00.000Z";

export const execution = { metadata: {}, sandboxScriptId: "script-test" };

export const eventAutomationContext = (
	overrides: Partial<AutomationEventSnapshot> = {},
	ruleMetadata?: AutomationInput["automation"]["ruleMetadata"],
): AutomationInput => ({
	automation: {
		operation: "create",
		origin: { kind: "api" },
		ruleId: "automation-rule-1",
		occurredAt: timestamp,
		occurrenceId: "occurrence-1",
		...(ruleMetadata === undefined ? {} : { ruleMetadata }),
		source: {
			kind: "event",
			after: {
				properties: {},
				id: "event-1",
				occurredAt: timestamp,
				eventSchemaSlug: "event-schema-1",
				subject: { id: "entity-1", name: "Entity", entitySchemaSlug: "movie" },
				...overrides,
			},
		},
	},
});

export const policyAutomationContext = (
	overrides: Partial<AutomationPolicyInput["automation"]["source"]["draft"]> = {},
	origin: AutomationPolicyInput["automation"]["origin"] = {
		kind: "integration",
		integrationId: "integration-1",
	},
): AutomationPolicyInput => ({
	automation: {
		origin,
		operation: "create",
		ruleId: "automation-rule-1",
		occurrenceId: "occurrence-1",
		source: {
			kind: "event",
			draft: {
				properties: {},
				entityId: "entity-1",
				occurredAt: timestamp,
				entitySchemaSlug: "movie",
				eventSchemaSlug: "event-schema-1",
				...overrides,
			},
		},
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
	entitySchemaSlug: "entity-schema-1",
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
	eventSchemaSlug: "event-schema-1",
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
