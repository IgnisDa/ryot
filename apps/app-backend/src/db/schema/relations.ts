import { relations } from "drizzle-orm";
import { user } from "./auth";
import {
	appConfig,
	entity,
	entitySchema,
	entitySchemaSandboxScript,
	event,
	relationship,
	sandboxScript,
	savedView,
} from "./tables";

export const entitySchemaRelations = relations(
	entitySchema,
	({ one, many }) => ({
		entitySchemaSandboxScripts: many(entitySchemaSandboxScript),
		entities: many(entity),
		user: one(user, {
			references: [user.id],
			fields: [entitySchema.userId],
		}),
	}),
);

export const sandboxScriptRelations = relations(
	sandboxScript,
	({ one, many }) => ({
		entities: many(entity),
		detailsEntitySchemaSandboxScripts: many(entitySchemaSandboxScript, {
			relationName: "detailsSandboxScript",
		}),
		searchEntitySchemaSandboxScripts: many(entitySchemaSandboxScript, {
			relationName: "searchSandboxScript",
		}),
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
		searchSandboxScript: one(sandboxScript, {
			references: [sandboxScript.id],
			relationName: "searchSandboxScript",
			fields: [entitySchemaSandboxScript.searchSandboxScriptId],
		}),
		detailsSandboxScript: one(sandboxScript, {
			references: [sandboxScript.id],
			relationName: "detailsSandboxScript",
			fields: [entitySchemaSandboxScript.detailsSandboxScriptId],
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

export const appConfigRelations = relations(appConfig, ({ one }) => ({
	updatedByUser: one(user, {
		references: [user.id],
		fields: [appConfig.updatedByUserId],
	}),
}));
