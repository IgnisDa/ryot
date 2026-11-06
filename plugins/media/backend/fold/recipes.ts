import { Result, Schema } from "@ryot-app/plugin-backend-sdk/effect";
import {
	and,
	ascending,
	column,
	defineRecipe,
	eq,
	inArray,
	isNull,
	join,
	literal,
	or,
	schemaOwnerPredicate,
	selectedField,
	selectedOptionalRow,
	selectedRows,
	table,
} from "@ryot-app/plugin-backend-sdk/ryotql";

import { episodicEpisodeQuery, type EpisodicKindConfig } from "../../shared/lifecycle-expressions";
import { mediaFoldEventSchemaSlugs } from "../../shared/media-schema-slugs";

const pageSize = 100;

export const mediaFoldSubjectRecipe = defineRecipe(
	(input: { readonly subjectEntityId: string }) => {
		const subject = table("entity", "foldSubject");
		return {
			map: ({ subject: row }) => Result.succeed(row),
			queries: {
				subject: selectedOptionalRow(subject, {
					orderBy: [ascending(column(subject, "id"))],
					where: eq(column(subject, "id"), literal(input.subjectEntityId)),
					selection: {
						entitySchemaSlug: selectedField(column(subject, "entitySchemaSlug"), Schema.String),
						properties: selectedField(
							column(subject, "properties"),
							Schema.Record(Schema.String, Schema.Json),
						),
					},
				}),
			},
		};
	},
);

/** Matches the kernel's fold subject: the subject's sessionless events and every event in its session. */
export const mediaFoldEventsRecipe = defineRecipe(
	(input: { readonly subjectEntityId: string; readonly after?: string | undefined }) => {
		const event = table("event", "foldEvent");
		const entity = table("entity", "foldEventEntity");
		return {
			map: ({ events }) => Result.succeed(events),
			queries: {
				events: selectedRows(event, {
					limit: pageSize,
					after: input.after,
					orderBy: [ascending(column(event, "id"))],
					joins: [join("inner", entity, eq(column(entity, "id"), column(event, "entityId")))],
					where: and(
						schemaOwnerPredicate(event, "eventSchemaPluginId", { kind: "self" }),
						inArray(column(event, "eventSchemaSlug"), mediaFoldEventSchemaSlugs.map(literal)),
						or(
							eq(column(event, "sessionEntityId"), literal(input.subjectEntityId)),
							and(
								eq(column(event, "entityId"), literal(input.subjectEntityId)),
								isNull(column(event, "sessionEntityId")),
							),
						),
					),
					selection: {
						id: selectedField(column(event, "id"), Schema.String),
						revision: selectedField(column(event, "revision"), Schema.Int),
						entityId: selectedField(column(event, "entityId"), Schema.String),
						orderKey: selectedField(column(event, "orderKey"), Schema.String),
						occurredAt: selectedField(column(event, "occurredAt"), Schema.String),
						orderCreatedAt: selectedField(column(event, "orderCreatedAt"), Schema.String),
						eventSchemaSlug: selectedField(column(event, "eventSchemaSlug"), Schema.String),
						entitySchemaSlug: selectedField(column(entity, "entitySchemaSlug"), Schema.String),
						sessionEntityId: selectedField(
							column(event, "sessionEntityId"),
							Schema.NullOr(Schema.String),
						),
						properties: selectedField(
							column(event, "properties"),
							Schema.Record(Schema.String, Schema.Json),
						),
					},
				}),
			},
		};
	},
);

export const mediaFoldInventoryRecipe = defineRecipe(
	(input: {
		readonly subjectEntityId: string;
		readonly config: EpisodicKindConfig;
		readonly after?: string | undefined;
	}) => {
		const parent = table("entity", "foldInventoryParent");
		const episode = table("entity", "foldInventoryEpisode");
		const scope = episodicEpisodeQuery(input.config, parent, episode, "foldInventory");
		return {
			map: ({ episodes }) => Result.succeed(episodes),
			queries: {
				episodes: selectedRows(episode, {
					limit: pageSize,
					after: input.after,
					where: scope.where,
					orderBy: [ascending(column(episode, "id"))],
					selection: { id: selectedField(column(episode, "id"), Schema.String) },
					joins: [
						join("inner", parent, eq(column(parent, "id"), literal(input.subjectEntityId))),
						...scope.joins,
					],
				}),
			},
		};
	},
);

export const mediaFoldLibraryLinksRecipe = defineRecipe(
	(input: { readonly subjectEntityId: string }) => {
		const link = table("relationship", "foldLibraryLink");
		return {
			map: ({ links }) => Result.succeed(links.items.map(({ id }) => id)),
			queries: {
				links: selectedRows(link, {
					limit: pageSize,
					orderBy: [ascending(column(link, "id"))],
					selection: { id: selectedField(column(link, "id"), Schema.String) },
					where: and(
						schemaOwnerPredicate(link, "relationshipSchemaPluginId", { kind: "self" }),
						eq(column(link, "sourceEntityId"), literal(input.subjectEntityId)),
						eq(column(link, "relationshipSchemaSlug"), literal("in-media-library")),
					),
				}),
			},
		};
	},
);
