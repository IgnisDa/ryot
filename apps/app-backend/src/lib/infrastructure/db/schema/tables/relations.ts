import { relations } from "drizzle-orm";

import { user } from "./auth";
import { signal, signalRecipient, signalSchema } from "./automations";
import {
	entitySchema,
	entitySchemaSandboxScript,
	sandboxScript,
	tracker,
	trackerEntitySchema,
} from "./core";
import { entity, relationship, relationshipSchema } from "./entities";
import { event, eventSchema } from "./events";
import { importRun, importRunFailure, integration } from "./imports";
import { notificationChannel } from "./notifications";
import { savedView } from "./views";

export const trackerRelations = relations(tracker, ({ one, many }) => ({
	trackerEntitySchemas: many(trackerEntitySchema),
	user: one(user, { references: [user.id], fields: [tracker.userId] }),
}));

export const trackerEntitySchemaRelations = relations(trackerEntitySchema, ({ one }) => ({
	tracker: one(tracker, { references: [tracker.id], fields: [trackerEntitySchema.trackerId] }),
	entitySchema: one(entitySchema, {
		references: [entitySchema.id],
		fields: [trackerEntitySchema.entitySchemaId],
	}),
}));

export const entitySchemaRelations = relations(entitySchema, ({ one, many }) => ({
	entities: many(entity),
	eventSchemas: many(eventSchema),
	trackerEntitySchemas: many(trackerEntitySchema),
	entitySchemaSandboxScripts: many(entitySchemaSandboxScript),
	user: one(user, { references: [user.id], fields: [entitySchema.userId] }),
	sourceRelationshipSchemas: many(relationshipSchema, {
		relationName: "sourceEntitySchema",
	}),
	targetRelationshipSchemas: many(relationshipSchema, {
		relationName: "targetEntitySchema",
	}),
}));

export const eventSchemaRelations = relations(eventSchema, ({ one, many }) => ({
	events: many(event),
	entitySchema: one(entitySchema, {
		references: [entitySchema.id],
		fields: [eventSchema.entitySchemaId],
	}),
}));

export const sandboxScriptRelations = relations(sandboxScript, ({ one, many }) => ({
	entities: many(entity),
	entityScriptLinks: many(entitySchemaSandboxScript),
	user: one(user, { references: [user.id], fields: [sandboxScript.userId] }),
}));

export const entitySchemaSandboxScriptRelations = relations(
	entitySchemaSandboxScript,
	({ one }) => ({
		entitySchema: one(entitySchema, {
			references: [entitySchema.id],
			fields: [entitySchemaSandboxScript.entitySchemaId],
		}),
		sandboxScript: one(sandboxScript, {
			references: [sandboxScript.id],
			fields: [entitySchemaSandboxScript.sandboxScriptId],
		}),
	}),
);

export const entityRelations = relations(entity, ({ one, many }) => ({
	events: many(event),
	user: one(user, { references: [user.id], fields: [entity.userId] }),
	sessionEvents: many(event, { relationName: "sessionEntity" }),
	outgoingRelationships: many(relationship, { relationName: "sourceEntity" }),
	incomingRelationships: many(relationship, { relationName: "targetEntity" }),
	schema: one(entitySchema, { references: [entitySchema.id], fields: [entity.entitySchemaId] }),
	sandboxScript: one(sandboxScript, {
		references: [sandboxScript.id],
		fields: [entity.sandboxScriptId],
	}),
}));

export const eventRelations = relations(event, ({ one }) => ({
	user: one(user, { references: [user.id], fields: [event.userId] }),
	entity: one(entity, { references: [entity.id], fields: [event.entityId] }),
	eventSchema: one(eventSchema, { references: [eventSchema.id], fields: [event.eventSchemaId] }),
	sessionEntity: one(entity, {
		references: [entity.id],
		relationName: "sessionEntity",
		fields: [event.sessionEntityId],
	}),
}));

export const relationshipSchemaRelations = relations(relationshipSchema, ({ one, many }) => ({
	relationships: many(relationship),
	user: one(user, { references: [user.id], fields: [relationshipSchema.userId] }),
	sourceEntitySchema: one(entitySchema, {
		references: [entitySchema.id],
		relationName: "sourceEntitySchema",
		fields: [relationshipSchema.sourceEntitySchemaId],
	}),
	targetEntitySchema: one(entitySchema, {
		references: [entitySchema.id],
		relationName: "targetEntitySchema",
		fields: [relationshipSchema.targetEntitySchemaId],
	}),
}));

export const relationshipRelations = relations(relationship, ({ one }) => ({
	user: one(user, { references: [user.id], fields: [relationship.userId] }),
	relationshipSchema: one(relationshipSchema, {
		references: [relationshipSchema.id],
		fields: [relationship.relationshipSchemaId],
	}),
	sourceEntity: one(entity, {
		references: [entity.id],
		relationName: "sourceEntity",
		fields: [relationship.sourceEntityId],
	}),
	targetEntity: one(entity, {
		references: [entity.id],
		relationName: "targetEntity",
		fields: [relationship.targetEntityId],
	}),
}));

export const savedViewRelations = relations(savedView, ({ one }) => ({
	user: one(user, { references: [user.id], fields: [savedView.userId] }),
}));

export const integrationRelations = relations(integration, ({ one, many }) => ({
	importRuns: many(importRun),
	user: one(user, { references: [user.id], fields: [integration.userId] }),
}));

export const importRunRelations = relations(importRun, ({ one, many }) => ({
	failures: many(importRunFailure),
	user: one(user, { references: [user.id], fields: [importRun.userId] }),
	integration: one(integration, {
		references: [integration.id],
		fields: [importRun.integrationId],
	}),
}));

export const importRunFailureRelations = relations(importRunFailure, ({ one }) => ({
	run: one(importRun, { references: [importRun.id], fields: [importRunFailure.runId] }),
}));

export const notificationChannelRelations = relations(notificationChannel, ({ one }) => ({
	user: one(user, { references: [user.id], fields: [notificationChannel.userId] }),
}));

export const signalSchemaRelations = relations(signalSchema, ({ one, many }) => ({
	signals: many(signal),
	user: one(user, { references: [user.id], fields: [signalSchema.userId] }),
}));

export const signalRelations = relations(signal, ({ one, many }) => ({
	recipients: many(signalRecipient),
	actor: one(user, { references: [user.id], fields: [signal.actorUserId] }),
	subject: one(entity, { references: [entity.id], fields: [signal.subjectEntityId] }),
	schema: one(signalSchema, {
		references: [signalSchema.id],
		fields: [signal.signalSchemaId],
	}),
}));

export const signalRecipientRelations = relations(signalRecipient, ({ one }) => ({
	user: one(user, { references: [user.id], fields: [signalRecipient.userId] }),
	signal: one(signal, { references: [signal.id], fields: [signalRecipient.signalId] }),
}));
