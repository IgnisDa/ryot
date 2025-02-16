import { relations } from "drizzle-orm";
import { user } from "./auth";
import {
	entity,
	entitySchema,
	entitySchemaSandboxScript,
	event,
	eventSchema,
	facet,
	facetEntitySchema,
	relationship,
	sandboxScript,
	savedView,
} from "./tables";

export const facetRelations = relations(facet, ({ one, many }) => ({
	facetEntitySchemas: many(facetEntitySchema),
	user: one(user, {
		references: [user.id],
		fields: [facet.userId],
	}),
}));

export const facetEntitySchemaRelations = relations(
	facetEntitySchema,
	({ one }) => ({
		facet: one(facet, {
			references: [facet.id],
			fields: [facetEntitySchema.facetId],
		}),
		entitySchema: one(entitySchema, {
			references: [entitySchema.id],
			fields: [facetEntitySchema.entitySchemaId],
		}),
	}),
);

export const entitySchemaRelations = relations(
	entitySchema,
	({ one, many }) => ({
		entities: many(entity),
		eventSchemas: many(eventSchema),
		facetEntitySchemas: many(facetEntitySchema),
		entitySchemaSandboxScripts: many(entitySchemaSandboxScript),
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
		entitySchemaSandboxScripts: many(entitySchemaSandboxScript),
		user: one(user, {
			references: [user.id],
			fields: [sandboxScript.userId],
		}),
	}),
);

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
	detailsSandboxScript: one(sandboxScript, {
		references: [sandboxScript.id],
		fields: [entity.detailsSandboxScriptId],
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

export const relationshipRelations = relations(relationship, ({ one }) => ({
	user: one(user, {
		references: [user.id],
		fields: [relationship.userId],
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
