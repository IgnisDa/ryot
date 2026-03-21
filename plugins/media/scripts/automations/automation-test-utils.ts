import type { JsonValue } from "@ryot/contract/modules/ryotql/language";
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
} from "@ryot/sandbox-sdk/core";
import { Effect } from "@ryot/sandbox-sdk/effect";
import { isObjectRecord } from "@ryot/ts-utils/predicates";

const timestamp = "2026-01-01T00:00:00.000Z";

export const execution = { metadata: {}, startedAt: timestamp, sandboxScriptId: "script-test" };

export const eventAutomationContext = (
	overrides: Partial<AutomationEventSnapshot> = {},
	ruleMetadata?: AutomationInput["automation"]["ruleMetadata"],
): AutomationInput => ({
	automation: {
		operation: "create",
		occurredAt: timestamp,
		origin: { kind: "api" },
		ruleId: "automation-rule-1",
		occurrenceId: "occurrence-1",
		...(ruleMetadata === undefined ? {} : { ruleMetadata }),
		source: {
			kind: "event",
			after: {
				id: "event-1",
				properties: {},
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
	providerId: null,
	externalId: null,
	populatedAt: null,
	createdAt: timestamp,
	updatedAt: timestamp,
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
	pluginSlug: "media",
	propertiesSchema: {},
	id: "entity-schema-1",
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

export const hostSuccess = <Data>(data: Data) => Effect.succeed(data);

export const hostFailure = (message = "not found") => Effect.fail({ message });

const stringifyJson = (value: unknown): string | undefined => JSON.stringify(value);

const ryotqlField = (key: string, value: unknown) => {
	const textValue = typeof value === "string" ? value : (stringifyJson(value) ?? "");
	if (value === null) {
		return { kind: "null" as const, value };
	}
	if (key === "createdAt" || key === "updatedAt" || key === "occurredAt") {
		return { kind: "date" as const, value: textValue };
	}
	if (key === "properties") {
		return { kind: "json" as const, value };
	}
	if (typeof value === "boolean") {
		return { kind: "boolean" as const, value };
	}
	if (typeof value === "number") {
		return { kind: "number" as const, value };
	}
	return { kind: "text" as const, value: textValue };
};

export const ryotqlRows = (queryName: string, records: readonly Record<string, unknown>[]) => ({
	data: {
		[queryName]: {
			type: "rows" as const,
			pageInfo: { hasMore: false, limit: 100, page: 1, total: records.length },
			items: records.map((record) => {
				const values =
					queryName === "events"
						? {
								id: record.id,
								entityId: record.entityId,
								updatedAt: record.updatedAt,
								createdAt: record.createdAt,
								occurredAt: record.occurredAt,
								properties: record.properties,
								eventSchemaSlug: record.eventSchemaSlug,
								entitySchemaSlug: record.entitySchemaSlug,
								sessionEntityId: record.sessionEntityId ?? null,
							}
						: record;
				return Object.fromEntries(
					Object.entries(values).map(([key, value]) => [key, ryotqlField(key, value)]),
				);
			}),
		},
	},
});

export const httpSuccess = (body: JsonValue) =>
	hostSuccess({
		status: 200,
		headers: {},
		body: typeof body === "string" ? body : JSON.stringify(body),
	});

export const httpFailure = (message = "request failed") => Effect.fail({ message });

export const toRecord = (value: unknown): Record<string, unknown> =>
	isObjectRecord(value) ? value : Object.create(null);
