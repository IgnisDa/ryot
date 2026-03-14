import { Schema } from "effect";

import { HttpUrl } from "./utils";

export const UserId = Schema.String.pipe(Schema.brand("UserId"));

export type UserId = typeof UserId.Type;

export const EventId = Schema.String.pipe(Schema.brand("EventId"));

export type EventId = typeof EventId.Type;

export const EntityId = Schema.String.pipe(Schema.brand("EntityId"));

export type EntityId = typeof EntityId.Type;

export const TrackerId = Schema.String.pipe(Schema.brand("TrackerId"));

export type TrackerId = typeof TrackerId.Type;

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

export const EventSchemaId = Schema.String.pipe(Schema.brand("EventSchemaId"));

export type EventSchemaId = typeof EventSchemaId.Type;

export const EntitySchemaId = Schema.String.pipe(Schema.brand("EntitySchemaId"));

export type EntitySchemaId = typeof EntitySchemaId.Type;

export const SandboxScriptId = Schema.String.pipe(Schema.brand("SandboxScriptId"));

export type SandboxScriptId = typeof SandboxScriptId.Type;

export const RelationshipSchemaId = Schema.String.pipe(Schema.brand("RelationshipSchemaId"));

export type RelationshipSchemaId = typeof RelationshipSchemaId.Type;

export const SignalId = Schema.String.pipe(Schema.brand("SignalId"));

export type SignalId = typeof SignalId.Type;

export const SignalSchemaId = Schema.String.pipe(Schema.brand("SignalSchemaId"));

export type SignalSchemaId = typeof SignalSchemaId.Type;

export const Slug = Schema.String.pipe(
	Schema.filter((value) =>
		/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value) ? true : "must be a non-empty kebab-case slug",
	),
	Schema.brand("Slug"),
);

export type Slug = typeof Slug.Type;

export const RemoteImageUrl = HttpUrl.pipe(Schema.brand("RemoteImageUrl"));

export type RemoteImageUrl = typeof RemoteImageUrl.Type;
