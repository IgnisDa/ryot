import type { JsonValue } from "@ryot-app/contract/modules/ryotql/language";
import type {
	AutomationInput,
	AutomationPolicyInput,
	AutomationEventSnapshot,
} from "@ryot-app/sandbox-sdk/automation";
import type {
	EntityRecord,
	EntitySchemaRecord,
	EventRecord,
	IntegrationRecord,
} from "@ryot-app/sandbox-sdk/core";
import { Effect } from "@ryot-app/sandbox-sdk/effect";
import { isObjectRecord } from "@ryot-app/ts-utils/predicates";

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
				createdAt: timestamp,
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
	maximumProgress: 95,
	syncOwnership: false,
	lastFinishedAt: null,
	createdAt: timestamp,
	updatedAt: timestamp,
	providerSpecifics: {},
	extraSettings: { disableOnContinuousErrors: false },
	...overrides,
});

export const hostSuccess = <Data>(data: Data) => Effect.succeed(data);

export const hostFailure = (message = "not found") => Effect.fail({ message });

export const ryotqlRows = (
	queryName: string,
	records: readonly Record<string, unknown>[],
	pageInfo: { readonly hasMore: boolean; readonly nextCursor: string | null } = {
		hasMore: false,
		nextCursor: null,
	},
) => ({
	data: {
		[queryName]: {
			type: "rows" as const,
			pageInfo: { limit: 100, ...pageInfo },
			items: records.map((record) =>
				queryName === "events"
					? {
							id: record.id,
							entityId: record.entityId,
							updatedAt: record.updatedAt,
							createdAt: record.createdAt,
							occurredAt: record.occurredAt,
							properties: record.properties,
							eventSchemaSlug: record.eventSchemaSlug,
							sessionEntityId: record.sessionEntityId ?? null,
							entitySchemaSlug: record.entitySchemaSlug ?? "entity-schema-1",
						}
					: record,
			),
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
