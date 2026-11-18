import { Result, Schema } from "@ryot-app/plugin-backend-sdk/effect";
import {
	and,
	ascending,
	castDate,
	castText,
	column,
	defineRecipe,
	eq,
	gte,
	inArray,
	isNull,
	join,
	jsonPath,
	literal,
	lte,
	not,
	or,
	parameters,
	schemaOwnerPredicate,
	selectedField,
	selectedOptionalRow,
	selectedRows,
	table,
} from "@ryot-app/plugin-backend-sdk/ryotql";

import { episodicEpisodeQuery, type EpisodicKindConfig } from "../../shared/lifecycle-expressions";
import { mediaFoldEventSchemaSlugs } from "../../shared/media-schema-slugs";
import { catalogMessage } from "../../shared/messages.generated";

const pageSize = 100;
export const mediaFoldSubjectRecipe = (() => {
	const inputParameters = parameters({
		fields: {
			subjectEntityId: {
				type: "string",
				validation: { required: true },
				label: catalogMessage("query-parameter.entity"),
				description: "Subject Entity Id for this selection",
			},
		},
	});
	const subject = table("entity", "foldSubject");
	return defineRecipe({
		parameters: inputParameters.schema,
		map: ({ subject: row }) => Result.succeed(row),
		queries: {
			subject: selectedOptionalRow(subject, {
				orderBy: [ascending(column(subject, "id"))],
				where: eq(column(subject, "id"), inputParameters.value("subjectEntityId")),
				selection: {
					entitySchemaSlug: selectedField(column(subject, "entitySchemaSlug"), Schema.String),
					properties: selectedField(
						column(subject, "properties"),
						Schema.Record(Schema.String, Schema.Json),
					),
				},
			}),
		},
	});
})();
/** Narrows the subject's fold events; each field adds one condition. */
export type MediaFoldEventFilter = {
	readonly entityId?: string;
	readonly from?: string;
	readonly until?: string;
	readonly slugs?: ReadonlyArray<string>;
	readonly unsourced?: boolean;
	readonly runs?: ReadonlyArray<string>;
	readonly excluded?: ReadonlyArray<string>;
	readonly limit?: number;
};

const sourceRun = (event: ReturnType<typeof table>) =>
	castText(jsonPath(column(event, "properties"), "sourceRun"));

/** Matches the kernel's fold subject: the subject's sessionless events and every event in its session. */
export const mediaFoldEventsRecipe = (filter: MediaFoldEventFilter = {}) => {
	const inputParameters = parameters({
		fields: {
			subjectEntityId: {
				type: "string",
				validation: { required: true },
				label: catalogMessage("query-parameter.entity"),
				description: "Subject Entity Id for this selection",
			},
		},
	});
	const event = table("event", "foldEvent");
	const entity = table("entity", "foldEventEntity");
	const at = (value: string) => castDate(literal(value));
	return defineRecipe({
		parameters: inputParameters.schema,
		map: ({ events }) => Result.succeed(events),
		queries: {
			events: selectedRows(event, {
				limit: filter.limit ?? pageSize,
				orderBy: [ascending(column(event, "id"))],
				joins: [join("inner", entity, eq(column(entity, "id"), column(event, "entityId")))],
				where: and(
					schemaOwnerPredicate(event, "eventSchemaPluginId", { kind: "self" }),
					inArray(
						column(event, "eventSchemaSlug"),
						(filter.slugs ?? mediaFoldEventSchemaSlugs).map(literal),
					),
					or(
						eq(column(event, "sessionEntityId"), inputParameters.value("subjectEntityId")),
						and(
							eq(column(event, "entityId"), inputParameters.value("subjectEntityId")),
							isNull(column(event, "sessionEntityId")),
						),
					),
					...(filter.entityId === undefined
						? []
						: [eq(column(event, "entityId"), literal(filter.entityId))]),
					...(filter.from === undefined ? [] : [gte(column(event, "occurredAt"), at(filter.from))]),
					...(filter.until === undefined ? [] : [lte(column(event, "occurredAt"), at(filter.until))]),
					...(filter.unsourced === true ? [isNull(sourceRun(event))] : []),
					...(filter.runs === undefined ? [] : [inArray(sourceRun(event), filter.runs.map(literal))]),
					...(filter.excluded === undefined || filter.excluded.length === 0
						? []
						: [not(inArray(column(event, "id"), filter.excluded.map(literal)))]),
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
	});
};
export const mediaFoldInventoryRecipe = (input: { readonly config: EpisodicKindConfig }) => {
	const inputParameters = parameters({
		fields: {
			subjectEntityId: {
				type: "string",
				validation: { required: true },
				label: catalogMessage("query-parameter.entity"),
				description: "Subject Entity Id for this selection",
			},
		},
	});
	const parent = table("entity", "foldInventoryParent");
	const episode = table("entity", "foldInventoryEpisode");
	const scope = episodicEpisodeQuery(input.config, parent, episode, "foldInventory");
	return defineRecipe({
		parameters: inputParameters.schema,
		map: ({ episodes }) => Result.succeed(episodes),
		queries: {
			episodes: selectedRows(episode, {
				limit: pageSize,
				where: scope.where,
				orderBy: [ascending(column(episode, "id"))],
				selection: { id: selectedField(column(episode, "id"), Schema.String) },
				joins: [
					join("inner", parent, eq(column(parent, "id"), inputParameters.value("subjectEntityId"))),
					...scope.joins,
				],
			}),
		},
	});
};
export const mediaFoldLibraryLinksRecipe = (() => {
	const inputParameters = parameters({
		fields: {
			subjectEntityId: {
				type: "string",
				validation: { required: true },
				label: catalogMessage("query-parameter.entity"),
				description: "Subject Entity Id for this selection",
			},
		},
	});
	const link = table("relationship", "foldLibraryLink");
	return defineRecipe({
		parameters: inputParameters.schema,
		map: ({ links }) => Result.succeed(links.items.map(({ id }) => id)),
		queries: {
			links: selectedRows(link, {
				limit: pageSize,
				orderBy: [ascending(column(link, "id"))],
				selection: { id: selectedField(column(link, "id"), Schema.String) },
				where: and(
					schemaOwnerPredicate(link, "relationshipSchemaPluginId", { kind: "self" }),
					eq(column(link, "sourceEntityId"), inputParameters.value("subjectEntityId")),
					eq(column(link, "relationshipSchemaSlug"), literal("in-media-library")),
				),
			}),
		},
	});
})();
