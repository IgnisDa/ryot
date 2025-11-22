import { relations } from "drizzle-orm";

import { user } from "./auth";
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
	entitySchemaSandboxScripts: many(entitySchemaSandboxScript),
	trackerEntitySchemas: many(trackerEntitySchema),
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
	outgoingRelationships: many(relationship, { relationName: "sourceEntity" }),
	incomingRelationships: many(relationship, { relationName: "targetEntity" }),
	sessionEvents: many(event, { relationName: "sessionEntity" }),
	schema: one(entitySchema, { references: [entitySchema.id], fields: [entity.entitySchemaId] }),
	sandboxScript: one(sandboxScript, {
		references: [sandboxScript.id],
		fields: [entity.sandboxScriptId],
	}),
}));

export const eventRelations = relations(event, ({ one }) => ({
	user: one(user, { references: [user.id], fields: [event.userId] }),
	eventSchema: one(eventSchema, { references: [eventSchema.id], fields: [event.eventSchemaId] }),
	entity: one(entity, { references: [entity.id], fields: [event.entityId] }),
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
