import { relations } from "drizzle-orm";
import { user } from "./auth";
import {
	entity,
	entitySchema,
	entitySchemaScript,
	event,
	eventSchema,
	relationship,
	relationshipSchema,
	sandboxScript,
	savedView,
	tracker,
	trackerEntitySchema,
} from "./tables";

export const trackerRelations = relations(tracker, ({ one, many }) => ({
	trackerEntitySchemas: many(trackerEntitySchema),
	user: one(user, {
		references: [user.id],
		fields: [tracker.userId],
	}),
}));

export const trackerEntitySchemaRelations = relations(
	trackerEntitySchema,
	({ one }) => ({
		tracker: one(tracker, {
			references: [tracker.id],
			fields: [trackerEntitySchema.trackerId],
		}),
		entitySchema: one(entitySchema, {
			references: [entitySchema.id],
			fields: [trackerEntitySchema.entitySchemaId],
		}),
	}),
);

export const entitySchemaRelations = relations(
	entitySchema,
	({ one, many }) => ({
		entities: many(entity),
		eventSchemas: many(eventSchema),
		entitySchemaScripts: many(entitySchemaScript),
		trackerEntitySchemas: many(trackerEntitySchema),
		sourceRelationshipSchemas: many(relationshipSchema, {
			relationName: "sourceEntitySchema",
		}),
		targetRelationshipSchemas: many(relationshipSchema, {
			relationName: "targetEntitySchema",
		}),
		user: one(user, {
			references: [user.id],
			fields: [entitySchema.userId],
		}),
	}),
);

export const eventSchemaRelations = relations(eventSchema, ({ one, many }) => ({
	events: many(event),
	entitySchema: one(entitySchema, {
		references: [entitySchema.id],
		fields: [eventSchema.entitySchemaId],
	}),
}));

export const sandboxScriptRelations = relations(
	sandboxScript,
	({ one, many }) => ({
		entities: many(entity),
		entityScriptLinks: many(entitySchemaScript),
		user: one(user, {
			references: [user.id],
			fields: [sandboxScript.userId],
		}),
	}),
);

export const entitySchemaScriptRelations = relations(
	entitySchemaScript,
	({ one }) => ({
		entitySchema: one(entitySchema, {
			references: [entitySchema.id],
			fields: [entitySchemaScript.entitySchemaId],
		}),
		sandboxScript: one(sandboxScript, {
			references: [sandboxScript.id],
			fields: [entitySchemaScript.sandboxScriptId],
		}),
	}),
);

export const entityRelations = relations(entity, ({ one, many }) => ({
	events: many(event),
	outgoingRelationships: many(relationship, {
		relationName: "sourceEntity",
	}),
	incomingRelationships: many(relationship, {
		relationName: "targetEntity",
	}),
	sessionEvents: many(event, {
		relationName: "sessionEntity",
	}),
	schema: one(entitySchema, {
		references: [entitySchema.id],
		fields: [entity.entitySchemaId],
	}),
	sandboxScript: one(sandboxScript, {
		references: [sandboxScript.id],
		fields: [entity.sandboxScriptId],
	}),
	user: one(user, {
		references: [user.id],
		fields: [entity.userId],
	}),
}));

export const eventRelations = relations(event, ({ one }) => ({
	user: one(user, {
		references: [user.id],
		fields: [event.userId],
	}),
	eventSchema: one(eventSchema, {
		references: [eventSchema.id],
		fields: [event.eventSchemaId],
	}),
	entity: one(entity, {
		references: [entity.id],
		fields: [event.entityId],
	}),
	sessionEntity: one(entity, {
		references: [entity.id],
		relationName: "sessionEntity",
		fields: [event.sessionEntityId],
	}),
}));

export const relationshipSchemaRelations = relations(
	relationshipSchema,
	({ one, many }) => ({
		relationships: many(relationship),
		user: one(user, {
			references: [user.id],
			fields: [relationshipSchema.userId],
		}),
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
	}),
);

export const relationshipRelations = relations(relationship, ({ one }) => ({
	user: one(user, {
		references: [user.id],
		fields: [relationship.userId],
	}),
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
	user: one(user, {
		references: [user.id],
		fields: [savedView.userId],
	}),
}));
