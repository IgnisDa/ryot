import { Schema } from "effect";

import { HttpUrl } from "./utils";

export const UserId = Schema.String.pipe(Schema.brand("UserId"));

export type UserId = typeof UserId.Type;

export const EventId = Schema.String.pipe(Schema.brand("EventId"));

export type EventId = typeof EventId.Type;

export const EntityId = Schema.String.pipe(Schema.brand("EntityId"));

export type EntityId = typeof EntityId.Type;

export const PluginSlug = Schema.String.pipe(Schema.brand("PluginSlug"));

export type PluginSlug = typeof PluginSlug.Type;

export const SavedViewId = Schema.String.pipe(Schema.brand("SavedViewId"));

export type SavedViewId = typeof SavedViewId.Type;

export const ClientRendererId = Schema.String.pipe(Schema.brand("ClientRendererId"));

export type ClientRendererId = typeof ClientRendererId.Type;

export const ImportRunId = Schema.String.pipe(Schema.brand("ImportRunId"));

export type ImportRunId = typeof ImportRunId.Type;

export const BackupRunId = Schema.String.pipe(Schema.brand("BackupRunId"));

export type BackupRunId = typeof BackupRunId.Type;

export const RelationshipId = Schema.String.pipe(Schema.brand("RelationshipId"));

export type RelationshipId = typeof RelationshipId.Type;

export const IntegrationId = Schema.String.pipe(Schema.brand("IntegrationId"));

export type IntegrationId = typeof IntegrationId.Type;

export const IntegrationWebhookToken = Schema.String.pipe(Schema.brand("IntegrationWebhookToken"));

export type IntegrationWebhookToken = typeof IntegrationWebhookToken.Type;

export const NotificationChannelId = Schema.String.pipe(Schema.brand("NotificationChannelId"));

export type NotificationChannelId = typeof NotificationChannelId.Type;

export const EventSchemaSlug = Schema.String.pipe(Schema.brand("EventSchemaSlug"));

export type EventSchemaSlug = typeof EventSchemaSlug.Type;

export const EntitySchemaSlug = Schema.String.pipe(Schema.brand("EntitySchemaSlug"));

export type EntitySchemaSlug = typeof EntitySchemaSlug.Type;

export const SandboxScriptId = Schema.String.pipe(Schema.brand("SandboxScriptId"));

export type SandboxScriptId = typeof SandboxScriptId.Type;

export const SandboxProviderId = Schema.String.pipe(Schema.brand("SandboxProviderId"));

export type SandboxProviderId = typeof SandboxProviderId.Type;

export const RelationshipSchemaSlug = Schema.String.pipe(Schema.brand("RelationshipSchemaSlug"));

export type RelationshipSchemaSlug = typeof RelationshipSchemaSlug.Type;

export const SignalSchemaSlug = Schema.String.pipe(Schema.brand("SignalSchemaSlug"));

export type SignalSchemaSlug = typeof SignalSchemaSlug.Type;

export const NotificationSubscriptionId = Schema.String.pipe(
	Schema.brand("NotificationSubscriptionId"),
);

export type NotificationSubscriptionId = typeof NotificationSubscriptionId.Type;

export const PluginId = Schema.String.pipe(Schema.brand("PluginId"));
export type PluginId = typeof PluginId.Type;
export const PluginRevisionId = Schema.String.pipe(Schema.brand("PluginRevisionId"));
export type PluginRevisionId = typeof PluginRevisionId.Type;
export const PluginConfigRevisionId = Schema.String.pipe(Schema.brand("PluginConfigRevisionId"));
export type PluginConfigRevisionId = typeof PluginConfigRevisionId.Type;
export const AutomationTriggerId = Schema.String.pipe(Schema.brand("AutomationTriggerId"));
export type AutomationTriggerId = typeof AutomationTriggerId.Type;
export const AutomationRunId = Schema.String.pipe(Schema.brand("AutomationRunId"));
export type AutomationRunId = typeof AutomationRunId.Type;
export const AutomationRunAttemptId = Schema.String.pipe(Schema.brand("AutomationRunAttemptId"));
export type AutomationRunAttemptId = typeof AutomationRunAttemptId.Type;
export const AutomationExecutionId = Schema.String.pipe(Schema.brand("AutomationExecutionId"));
export type AutomationExecutionId = typeof AutomationExecutionId.Type;
export const AutomationHookSlug = Schema.String.pipe(
	Schema.check(Schema.makeFilter((value) => /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(value))),
	Schema.brand("AutomationHookSlug"),
);
export type AutomationHookSlug = typeof AutomationHookSlug.Type;

export const Slug = Schema.String.pipe(
	Schema.check(
		Schema.makeFilter((value) =>
			/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value) ? true : "must be a non-empty kebab-case slug",
		),
	),
	Schema.brand("Slug"),
);

export type Slug = typeof Slug.Type;

export const RemoteImageUrl = HttpUrl.pipe(Schema.brand("RemoteImageUrl"));

export type RemoteImageUrl = typeof RemoteImageUrl.Type;
