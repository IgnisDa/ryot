import { inMemoryRyotql, type StoredTables } from "@ryot-app/ryotql-recipes/test-utils";

export const measurementTables: StoredTables = {
	eventScope: [
		{ revision: 4, id: "scope-1", entityId: "entry-1", eventSchemaPluginId: "fitness-owner" },
	],
	event: [
		{
			id: "reading-1",
			entityId: "weight",
			properties: { value: 70 },
			sessionEntityId: "entry-1",
			eventSchemaPluginId: "fitness-owner",
			eventSchemaSlug: "measurement-reading",
		},
		{
			id: "reading-2",
			entityId: "waist",
			properties: { value: 80 },
			sessionEntityId: "entry-1",
			eventSchemaPluginId: "fitness-owner",
			eventSchemaSlug: "measurement-reading",
		},
		{
			id: "reading-3",
			entityId: "weight",
			properties: { value: 72 },
			sessionEntityId: "entry-2",
			eventSchemaPluginId: "fitness-owner",
			eventSchemaSlug: "measurement-reading",
		},
		{
			id: "note-1",
			entityId: "exercise-1",
			eventSchemaSlug: "review",
			eventSchemaPluginId: "fitness-owner",
		},
		{
			id: "fake-reading",
			entityId: "exercise-1",
			eventSchemaPluginId: "fitness-owner",
			eventSchemaSlug: "measurement-reading",
		},
	],
	entity: [
		{
			id: "entry-1",
			userId: "user-1",
			name: "Measurement",
			entitySchemaPluginId: "fitness-owner",
			entitySchemaSlug: "measurement-entry",
			updatedAt: "2026-04-27T08:00:00.000Z",
			properties: { occurredAt: "2026-04-27T08:00:00.000Z" },
		},
		{
			id: "entry-2",
			userId: "user-1",
			name: "Measurement",
			entitySchemaPluginId: "fitness-owner",
			entitySchemaSlug: "measurement-entry",
			updatedAt: "2026-04-27T08:00:00.000Z",
			properties: { occurredAt: "2026-04-27T08:00:00.000Z" },
		},
		{ id: "weight", entitySchemaPluginId: "fitness-owner", entitySchemaSlug: "measurement-metric" },
		{ id: "waist", entitySchemaPluginId: "fitness-owner", entitySchemaSlug: "measurement-metric" },
		{ id: "exercise-1", entitySchemaSlug: "exercise", entitySchemaPluginId: "fitness-owner" },
		{
			id: "library",
			userId: "user-1",
			entitySchemaSlug: "fitness-library",
			entitySchemaPluginId: "fitness-owner",
		},
	],
};

export const executeMeasurementRyotql = inMemoryRyotql({
	pluginId: "fitness-owner",
	tables: measurementTables,
});
