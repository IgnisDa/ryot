import { reviewPropertyFields } from "@ryot-app/contract/modules/events/review";
import { kernelMessage, kernelText } from "@ryot-app/kernel-messages/message";
import {
	and,
	ascending,
	column,
	contains,
	countDistinct,
	document,
	entitySchemaPredicate,
	eq,
	field,
	literal,
	rows,
	schemaOwnerPredicate,
	table,
} from "@ryot-app/ryotql";
import { librarySearchQuery } from "@ryot-app/ryotql-recipes/library-search";
import { parameters } from "@ryot-app/ryotql/authoring";
import { Result } from "effect";

import { deriveSavedViewQueries } from "./saved-view-queries";
import type { DefinitionSource } from "./snapshot";

export const kernelNotificationHookSlug = "automation.notification";

const collectionSchema = {
	pluginId: null,
	icon: "folders",
	slug: "collection",
	name: kernelText("definition.entity-schema.collection"),
	propertiesSchema: {
		fields: {
			description: {
				type: "string" as const,
				description: "A short summary or description of this collection",
				label: kernelMessage("definition.property.collection-description"),
			},
			membershipFields: {
				type: "array" as const,
				label: kernelMessage("definition.property.membership-fields"),
				description: "Ordered field declarations for collection members",
				items: {
					properties: {},
					type: "object" as const,
					unknownKeys: "passthrough" as const,
					description: "Collection member field declaration",
					label: kernelMessage("definition.property.membership-field"),
				},
			},
		},
	},
	eventSchemas: [
		{
			pluginId: null,
			slug: "review",
			name: kernelText("definition.event-schema.review"),
			propertiesSchema: {
				fields: reviewPropertyFields("Your written thoughts or notes about this entity"),
			},
		},
		...(["Add", "Remove"] as const).map((operation) => ({
			pluginId: null,
			slug: `${operation.toLowerCase()}-entity-${operation === "Add" ? "to" : "from"}-collection`,
			name: kernelText(
				operation === "Add"
					? "definition.event-schema.add-entity-to-collection"
					: "definition.event-schema.remove-entity-from-collection",
			),
			propertiesSchema: {
				fields: {
					entitySchemaSlug: {
						type: "string" as const,
						validation: { required: true as const },
						label: kernelMessage("definition.property.entity-schema-slug"),
						description: `Schema slug of the entity ${operation === "Add" ? "added to" : "removed from"} the collection`,
					},
					entityId: {
						type: "string" as const,
						validation: { required: true as const },
						reference: { kind: "entity-id" as const },
						label: kernelMessage("definition.property.entity-id"),
						description: `ID of the entity ${operation === "Add" ? "added to" : "removed from"} the collection`,
					},
					relationshipProperties: {
						properties: {},
						type: "object" as const,
						unknownKeys: "passthrough" as const,
						label: kernelMessage("definition.property.relationship-properties"),
						description:
							operation === "Add"
								? "Properties of the membership relationship"
								: "Properties of the deleted membership relationship",
					},
					relationshipId: {
						type: "string" as const,
						validation: { required: true as const },
						reference: { kind: "relationship-id" as const },
						label: kernelMessage("definition.property.relationship-id"),
						description:
							operation === "Add"
								? "ID of the membership relationship"
								: "ID of the membership relationship that was deleted",
					},
				},
			},
		})),
	],
};

const collection = table("entity", "entity");
const collectionMembership = table("relationship", "collectionMembership");

const collectionParameters = parameters({
	fields: {
		searchText: {
			type: "string",
			defaultValue: "",
			description: "Collection name",
			label: kernelMessage("recipe.parameter.search"),
		},
	},
});
const collectionSettings = {
	pageSize: 20,
	addAction: null,
	defaultLayout: "grid",
	sourceName: "savedView",
	controls: { search: "searchText" },
	layouts: ["grid", "list", "table"],
	summary: { image: null, subtitle: null },
	subject: { entityAlias: "entity", schemas: [{ slug: "collection", owner: { kind: "kernel" } }] },
	tableColumns: [
		{ field: "name", displayKind: "text", label: kernelMessage("definition.table-column.name") },
		{
			field: "memberCount",
			displayKind: "number",
			label: kernelMessage("definition.table-column.items"),
		},
	],
} as const;
const collectionQuery = rows(collection, {
	orderBy: [ascending(column(collection, "name"))],
	where: and(
		entitySchemaPredicate(collection, "collection", { kind: "kernel" }),
		contains(column(collection, "name"), collectionParameters.value("searchText")),
	),
	fields: [
		field("entityId", column(collection, "id")),
		field("name", column(collection, "name")),
		field(
			"memberCount",
			countDistinct(collectionMembership, column(collectionMembership, "sourceEntityId"), {
				where: and(
					schemaOwnerPredicate(collectionMembership, "relationshipSchemaPluginId", {
						kind: "kernel",
					}),
					eq(column(collectionMembership, "targetEntityId"), column(collection, "id")),
					eq(column(collectionMembership, "relationshipSchemaSlug"), literal("member-of")),
				),
			}),
		),
		field("ownerPluginId", column(collection, "entitySchemaPluginId")),
		field("entitySchemaSlug", column(collection, "entitySchemaSlug")),
	],
});
const collectionDataSources = Result.getOrThrow(
	deriveSavedViewQueries({ kind: "kernel", name: "collection-browser" }, collectionSettings, {
		parameters: collectionParameters.schema,
		...document({
			savedView: collectionQuery,
			librarySearch: librarySearchQuery({
				entity: collection,
				source: collectionQuery,
				searchExpressions: [column(collection, "name")],
				search: collectionParameters.value("searchText"),
			}).document,
		}),
	}),
);

export const kernelDefinitionSource = (): DefinitionSource => ({
	calendarSources: [],
	entitySchemas: [collectionSchema],
	relationshipSchemas: [
		{
			pluginId: null,
			slug: "member-of",
			sourceEntitySchemaSlug: null,
			targetEntitySchemaSlug: "collection",
			name: kernelText("definition.relationship-schema.member-of"),
			propertiesSchema: {
				unknownKeys: "passthrough",
				fields: {
					rank: {
						type: "integer",
						defaultValue: 0,
						label: kernelMessage("definition.property.rank"),
						description: "Sort order of this entity within the collection",
					},
				},
			},
		},
	],
	savedViews: [
		{
			sortOrder: 0,
			pluginId: null,
			slug: "collections",
			icon: collectionSchema.icon,
			settings: collectionSettings,
			dataSources: collectionDataSources,
			renderer: { kind: "kernel", name: "collection-browser" },
			name: kernelText("definition.saved-view.all-collections"),
		},
		{
			sortOrder: 1,
			settings: {},
			pluginId: null,
			slug: "calendar",
			icon: "calendar",
			dataSources: null,
			renderer: { kind: "kernel", name: "calendar" },
			name: kernelText("definition.saved-view.calendar"),
		},
		{
			sortOrder: 2,
			settings: {},
			pluginId: null,
			slug: "analytics",
			dataSources: null,
			icon: "chart-column",
			renderer: { kind: "kernel", name: "analytics" },
			name: kernelText("definition.saved-view.analytics"),
		},
	],

	signalSchemas: [
		{
			pluginId: null,
			slug: "reminder.due",
			catalogState: "active",
			audiencePolicy: { kind: "actor" },
			notificationHookSlug: kernelNotificationHookSlug,
			name: kernelText("definition.signal-schema.reminder-due"),
			propertiesSchema: {
				unknownKeys: "strict",
				fields: {
					entityId: {
						type: "string",
						validation: { required: true },
						description: "Target entity identity",
						label: kernelMessage("definition.property.entity"),
					},
					timezone: {
						type: "string",
						validation: { required: true },
						description: "Selected IANA timezone",
						label: kernelMessage("definition.property.timezone"),
					},
					dueAt: {
						type: "string",
						validation: { required: true },
						description: "Fixed UTC due instant",
						label: kernelMessage("definition.property.scheduled-time"),
					},
					message: {
						type: "string",
						validation: { required: true },
						description: "Authored reminder text",
						label: kernelMessage("definition.property.reminder-message"),
					},
					reminderId: {
						type: "string",
						validation: { required: true },
						description: "Independent reminder occurrence",
						label: kernelMessage("definition.property.reminder-id"),
					},
				},
			},
		},
		{
			pluginId: null,
			catalogState: "active",
			slug: "integration.disabled",
			audiencePolicy: { kind: "actor" },
			notificationHookSlug: kernelNotificationHookSlug,
			name: kernelText("definition.signal-schema.integration-disabled"),
			propertiesSchema: {
				unknownKeys: "strict",
				fields: {
					integrationId: {
						type: "string",
						validation: { required: true },
						description: "Disabled integration ID",
						label: kernelMessage("definition.property.integration-id"),
					},
					providerName: {
						properties: {},
						type: "object",
						unknownKeys: "passthrough",
						validation: { required: true },
						label: kernelMessage("definition.property.provider-name"),
						description: "The disabled integration provider's name, as a stamped message",
					},
				},
			},
		},
	],
});
