import { Schema } from "effect";

import { HttpUrl } from "./utils";

export const UserId = Schema.String.pipe(Schema.brand("UserId"));

export type UserId = typeof UserId.Type;

export const EventId = Schema.String.pipe(Schema.brand("EventId"));

export type EventId = typeof EventId.Type;

export const EntityId = Schema.String.pipe(Schema.brand("EntityId"));

export type EntityId = typeof EntityId.Type;

// TODO(plugin-system): Return branded values from `.make` after plain-string schema slug fixtures and callers migrate.
const makeSchemaSlug = () =>
	Object.assign(Schema.String.pipe(Schema.filter(() => true)), {
		make: (value: string) => value,
	});

export const PluginSlug = makeSchemaSlug();

export type PluginSlug = typeof PluginSlug.Type;

export const SavedViewId = Schema.String.pipe(Schema.brand("SavedViewId"));

export type SavedViewId = typeof SavedViewId.Type;

export const ImportRunId = Schema.String.pipe(Schema.brand("ImportRunId"));

export type ImportRunId = typeof ImportRunId.Type;

export const RelationshipId = Schema.String.pipe(Schema.brand("RelationshipId"));

export type RelationshipId = typeof RelationshipId.Type;

export const IntegrationId = Schema.String.pipe(Schema.brand("IntegrationId"));

export type IntegrationId = typeof IntegrationId.Type;

export const NotificationChannelId = Schema.String.pipe(Schema.brand("NotificationChannelId"));

export type NotificationChannelId = typeof NotificationChannelId.Type;

export const EventSchemaSlug = makeSchemaSlug();

export type EventSchemaSlug = typeof EventSchemaSlug.Type;

export const EntitySchemaSlug = makeSchemaSlug();

export type EntitySchemaSlug = typeof EntitySchemaSlug.Type;

export const SandboxScriptId = Schema.String.pipe(Schema.brand("SandboxScriptId"));

export type SandboxScriptId = typeof SandboxScriptId.Type;

export const RelationshipSchemaSlug = makeSchemaSlug();

export type RelationshipSchemaSlug = typeof RelationshipSchemaSlug.Type;

export const SignalId = Schema.String.pipe(Schema.brand("SignalId"));

export type SignalId = typeof SignalId.Type;

export const SignalSchemaSlug = makeSchemaSlug();

export type SignalSchemaSlug = typeof SignalSchemaSlug.Type;

export const AutomationRuleId = Schema.String.pipe(Schema.brand("AutomationRuleId"));

export type AutomationRuleId = typeof AutomationRuleId.Type;

export const SubscriptionRunId = Schema.String.pipe(Schema.brand("SubscriptionRunId"));

export type SubscriptionRunId = typeof SubscriptionRunId.Type;

export const Slug = Schema.String.pipe(
	Schema.filter((value) =>
		/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value) ? true : "must be a non-empty kebab-case slug",
	),
	Schema.brand("Slug"),
);

export type Slug = typeof Slug.Type;

export const RemoteImageUrl = HttpUrl.pipe(Schema.brand("RemoteImageUrl"));

export type RemoteImageUrl = typeof RemoteImageUrl.Type;
