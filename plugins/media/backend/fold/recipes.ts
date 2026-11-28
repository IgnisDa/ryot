import { Result, Schema } from "@ryot-app/plugin-backend-sdk/effect";
import {
	and,
	ascending,
	castText,
	column,
	defineRecipe,
	eq,
	foldEventImageSelection,
	foldSubjectEventPredicate,
	gte,
	inArray,
	join,
	jsonPath,
	literal,
	lte,
	not,
	parameters,
	schemaOwnerPredicate,
	selectedField,
	selectedOptionalRow,
	selectedRows,
	table,
} from "@ryot-app/plugin-backend-sdk/ryotql";
import { RelationshipId } from "@ryot-app/plugin-kit/schema";

import {
	currentCycleEpisodeState,
	episodicEpisodeQuery,
	type EpisodicKindConfig,
	podcastEpisodicKindConfig,
	showEpisodicKindConfig,
} from "../../shared/lifecycle-expressions";
import {
	mediaFoldEventSchemaSlugs,
	mediaLibraryMemberEntitySchemaSlugs,
} from "../../shared/media-schema-slugs";
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
const mediaFolds = mediaLibraryMemberEntitySchemaSlugs.map((entitySchemaSlug) => ({
	entitySchemaSlug,
	eventSchemaSlugs: mediaFoldEventSchemaSlugs,
}));

const sourceRun = (event: ReturnType<typeof table>) =>
	castText(jsonPath(column(event, "properties"), "sourceRun"));

const listed = (label: Parameters<typeof catalogMessage>[0], description: string) => ({
	description,
	type: "array" as const,
	label: catalogMessage(label),
	items: { description, type: "string" as const, label: catalogMessage("query-parameter.id") },
});

/** The subject's fold events, each set parameter adding one condition, in pages of up to 100. */
export const mediaFoldEventsRecipe = (() => {
	const inputParameters = parameters({
		fields: {
			excluded: listed("query-parameter.events", "Events to leave out"),
			slugs: listed("query-parameter.event-schemas", "Event schemas to read"),
			runs: listed("query-parameter.source-runs", "Source runs the events came from"),
			from: {
				type: "datetime",
				description: "Earliest occurrence to read",
				label: catalogMessage("query-parameter.from"),
			},
			until: {
				type: "datetime",
				description: "Latest occurrence to read",
				label: catalogMessage("query-parameter.until"),
			},
			entityId: {
				type: "string",
				description: "Entity whose events to read",
				label: catalogMessage("query-parameter.entity"),
			},
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
	return defineRecipe({
		parameters: inputParameters.schema,
		map: ({ events }) => Result.succeed(events),
		queries: {
			events: selectedRows(event, {
				limit: pageSize,
				orderBy: [ascending(column(event, "id"))],
				selection: foldEventImageSelection(event, entity),
				joins: [join("inner", entity, eq(column(entity, "id"), column(event, "entityId")))],
				where: and(
					foldSubjectEventPredicate(event, {
						folds: mediaFolds,
						eventSchemaSlugs: mediaFoldEventSchemaSlugs,
						subject: inputParameters.value("subjectEntityId"),
					}),
					inputParameters.whenSet(
						"slugs",
						inArray(column(event, "eventSchemaSlug"), inputParameters.list("slugs")),
					),
					inputParameters.whenSet(
						"entityId",
						eq(column(event, "entityId"), inputParameters.value("entityId")),
					),
					inputParameters.whenSet(
						"from",
						gte(column(event, "occurredAt"), inputParameters.value("from")),
					),
					inputParameters.whenSet(
						"until",
						lte(column(event, "occurredAt"), inputParameters.value("until")),
					),
					inputParameters.whenSet("runs", inArray(sourceRun(event), inputParameters.list("runs"))),
					inputParameters.whenSet(
						"excluded",
						not(inArray(column(event, "id"), inputParameters.list("excluded"))),
					),
				),
			}),
		},
	});
})();

const subjectParameter = {
	type: "string",
	validation: { required: true },
	label: catalogMessage("query-parameter.entity"),
	description: "Subject Entity Id for this selection",
} as const;

const episodicRecipes = (config: EpisodicKindConfig) => {
	const inventoryParameters = parameters({ fields: { subjectEntityId: subjectParameter } });
	const inventoryParent = table("entity", "foldInventoryParent");
	const inventoryEpisode = table("entity", "foldInventoryEpisode");
	const inventoryScope = episodicEpisodeQuery(
		config,
		inventoryParent,
		inventoryEpisode,
		"foldInventory",
	);
	const uncoveredParameters = parameters({
		fields: {
			subjectEntityId: subjectParameter,
			excluded: listed("query-parameter.episodes", "Episodes to leave out"),
		},
	});
	const uncoveredParent = table("entity", "foldUncoveredParent");
	const uncoveredEpisode = table("entity", "foldUncoveredEpisode");
	const uncoveredScope = episodicEpisodeQuery(
		config,
		uncoveredParent,
		uncoveredEpisode,
		"foldUncovered",
	);
	return {
		config,
		inventory: defineRecipe({
			parameters: inventoryParameters.schema,
			map: ({ episodes }) => Result.succeed(episodes),
			queries: {
				episodes: selectedRows(inventoryEpisode, {
					limit: pageSize,
					where: inventoryScope.where,
					orderBy: [ascending(column(inventoryEpisode, "id"))],
					selection: { id: selectedField(column(inventoryEpisode, "id"), Schema.String) },
					joins: [
						join(
							"inner",
							inventoryParent,
							eq(column(inventoryParent, "id"), inventoryParameters.value("subjectEntityId")),
						),
						...inventoryScope.joins,
					],
				}),
			},
		}),
		/** One required episode of the subject, other than `excluded`, that its current cycle has not completed. */
		uncovered: defineRecipe({
			parameters: uncoveredParameters.schema,
			map: ({ episodes }) => Result.succeed(episodes.items.length > 0),
			queries: {
				episodes: selectedRows(uncoveredEpisode, {
					limit: 1,
					orderBy: [ascending(column(uncoveredEpisode, "id"))],
					selection: { id: selectedField(column(uncoveredEpisode, "id"), Schema.String) },
					joins: [
						join(
							"inner",
							uncoveredParent,
							eq(column(uncoveredParent, "id"), uncoveredParameters.value("subjectEntityId")),
						),
						...uncoveredScope.joins,
					],
					where: and(
						uncoveredScope.where,
						not(
							eq(
								currentCycleEpisodeState(uncoveredEpisode, uncoveredParent, "foldUncoveredCurrent"),
								literal("complete"),
							),
						),
						uncoveredParameters.whenSet(
							"excluded",
							not(inArray(column(uncoveredEpisode, "id"), uncoveredParameters.list("excluded"))),
						),
					),
				}),
			},
		}),
	};
};

/** The inventory and coverage reads of each episodic subject kind. */
export const mediaFoldEpisodicRecipes = [showEpisodicKindConfig, podcastEpisodicKindConfig].map(
	episodicRecipes,
);

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
				selection: { id: selectedField(column(link, "id"), RelationshipId) },
				where: and(
					schemaOwnerPredicate(link, "relationshipSchemaPluginId", { kind: "self" }),
					eq(column(link, "sourceEntityId"), inputParameters.value("subjectEntityId")),
					eq(column(link, "relationshipSchemaSlug"), literal("in-media-library")),
				),
			}),
		},
	});
})();
