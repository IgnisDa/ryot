import type {
	AutomationEventDraft,
	AutomationEventSnapshot,
} from "@ryot-app/contract/modules/automations/lifecycle";
import { PluginId } from "@ryot-app/contract/schema/brands";
import type { JsonValue } from "@ryot-app/contract/schema/json";
import {
	automationInputSchema,
	automationPolicyInputSchema,
} from "@ryot-app/plugin-backend-sdk/automation";
import type {
	EntityRecord,
	EntitySchemaRecord,
	EventRecord,
	IntegrationRecord,
} from "@ryot-app/plugin-backend-sdk/core";
import { Effect, Schema } from "@ryot-app/plugin-backend-sdk/effect";
import { isObjectRecord } from "@ryot-app/ts-utils/predicates";

const timestamp = "2026-01-01T00:00:00.000Z";

export const execution = { metadata: {}, startedAt: timestamp, sandboxScriptId: "script-test" };

const invocation = {
	runId: "run-1",
	occurredAt: timestamp,
	triggerId: "trigger-1",
	hookSlug: "media.test",
	executionUserId: "user-1",
	causation: {
		depth: 0,
		source: "api",
		parentRunId: null,
		lane: "interactive",
		parentTriggerId: null,
		executionId: "execution-1",
		rootExecutionId: "execution-1",
		initiator: { kind: "user", id: "user-1" },
	},
};

export const automationContext = (payload: unknown, overrides: Record<string, unknown> = {}) =>
	Schema.decodeUnknownSync(automationInputSchema)({
		automation: { ...invocation, ...overrides, payload },
	});

export const eventAutomationContext = (
	overrides: Partial<typeof AutomationEventSnapshot.Encoded> = {},
	hookMetadata?: JsonValue,
) =>
	automationContext(
		{
			resource: "event",
			category: "change",
			operation: "create",
			after: {
				id: "event-1",
				properties: {},
				entityId: "entity-1",
				createdAt: timestamp,
				updatedAt: timestamp,
				occurredAt: timestamp,
				entitySchemaSlug: "movie",
				eventSchemaSlug: "event-schema-1",
				eventSchemaPluginId: PluginId.make("media-owner"),
				entitySchemaPluginId: PluginId.make("media-owner"),
				...overrides,
				sessionEntityId: overrides.sessionEntityId ?? null,
			},
		},
		hookMetadata === undefined ? {} : { hookMetadata },
	);

export const eventBatchContext = (...events: Parameters<typeof eventAutomationContext>[0][]) => {
	const items = events.map((event) => {
		const payload = eventAutomationContext(event).automation.payload;
		if (
			payload.category !== "change" ||
			payload.resource !== "event" ||
			payload.operation !== "create"
		) {
			throw new Error("Expected event create change");
		}
		return payload;
	});
	return automationContext({ items, resource: "event", category: "change", operation: "batch" });
};

export const policyAutomationContext = (
	overrides: Partial<typeof AutomationEventDraft.Encoded> = {},
) =>
	Schema.decodeUnknownSync(automationPolicyInputSchema)({
		automation: {
			...invocation,
			payload: {
				resource: "event",
				category: "request",
				operation: "create",
				draft: {
					properties: {},
					entityId: "entity-1",
					occurredAt: timestamp,
					sessionEntityId: null,
					entitySchemaSlug: "movie",
					eventSchemaSlug: "event-schema-1",
					eventSchemaPluginId: PluginId.make("media-owner"),
					entitySchemaPluginId: PluginId.make("media-owner"),
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
	entitySchemaPluginId: PluginId.make("media-owner"),
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
	pluginId: PluginId.make("media-owner"),
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
	eventSchemaPluginId: PluginId.make("media-owner"),
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
	pageInfo: { readonly hasMore: boolean; readonly nextCursor: null | string } = {
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
							eventSchemaPluginId: record.eventSchemaPluginId,
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
