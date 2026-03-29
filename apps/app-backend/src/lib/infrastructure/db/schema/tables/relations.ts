import { relations } from "drizzle-orm";

import { user } from "./auth";
import { signal, signalRecipient } from "./automations";
import { pluginState, sandboxScript } from "./core";
import { entity, relationship } from "./entities";
import { event } from "./events";
import { importRun, importRunFailure, integration } from "./imports";
import { notificationChannel } from "./notifications";
import { savedView, savedViewState } from "./views";

export const pluginStateRelations = relations(pluginState, ({ one }) => ({
	user: one(user, { references: [user.id], fields: [pluginState.userId] }),
}));

export const sandboxScriptRelations = relations(sandboxScript, ({ one, many }) => ({
	entities: many(entity),
	user: one(user, { references: [user.id], fields: [sandboxScript.userId] }),
}));

export const entityRelations = relations(entity, ({ one, many }) => ({
	events: many(event),
	user: one(user, { references: [user.id], fields: [entity.userId] }),
	sessionEvents: many(event, { relationName: "sessionEntity" }),
	outgoingRelationships: many(relationship, { relationName: "sourceEntity" }),
	incomingRelationships: many(relationship, { relationName: "targetEntity" }),
	sandboxScript: one(sandboxScript, {
		references: [sandboxScript.id],
		fields: [entity.sandboxScriptId],
	}),
}));

export const eventRelations = relations(event, ({ one }) => ({
	user: one(user, { references: [user.id], fields: [event.userId] }),
	entity: one(entity, { references: [entity.id], fields: [event.entityId] }),
	sessionEntity: one(entity, {
		references: [entity.id],
		relationName: "sessionEntity",
		fields: [event.sessionEntityId],
	}),
}));

export const relationshipRelations = relations(relationship, ({ one }) => ({
	user: one(user, { references: [user.id], fields: [relationship.userId] }),
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

export const savedViewStateRelations = relations(savedViewState, ({ one }) => ({
	user: one(user, { references: [user.id], fields: [savedViewState.userId] }),
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

export const signalRelations = relations(signal, ({ one, many }) => ({
	recipients: many(signalRecipient),
	actor: one(user, { references: [user.id], fields: [signal.actorUserId] }),
	subject: one(entity, { references: [entity.id], fields: [signal.subjectEntityId] }),
}));

export const signalRecipientRelations = relations(signalRecipient, ({ one }) => ({
	user: one(user, { references: [user.id], fields: [signalRecipient.userId] }),
	signal: one(signal, { references: [signal.id], fields: [signalRecipient.signalId] }),
}));
