import { Result, Schema } from "@ryot-app/plugin-backend-sdk/effect";
import {
	and,
	ascending,
	castBoolean,
	castDate,
	castNumber,
	castText,
	column,
	count,
	countDistinct,
	defineRecipe,
	eq,
	exists,
	inArray,
	isNotNull,
	isNull,
	join,
	jsonPath,
	literal,
	maximum,
	neq,
	or,
	schemaOwnerPredicate,
	selectedField,
	selectedOptionalRow,
	selectedRows,
	table,
} from "@ryot-app/plugin-backend-sdk/ryotql";

import { CompletionOccurrence, HistoryCorrection } from "../../shared/history-correction";
import {
	episodicEpisodeQuery,
	type EpisodicKindConfig,
	orderExpressionsAreAfter,
	type Predicate,
	type TableReference,
} from "../../shared/lifecycle-expressions";

const HistoryEvent = Schema.Struct({
	id: Schema.String,
	revision: Schema.Int,
	entityId: Schema.String,
	orderKey: Schema.String,
	createdAt: Schema.String,
	occurredAt: Schema.String,
	orderCreatedAt: Schema.String,
	eventSchemaSlug: Schema.String,
	entitySchemaSlug: Schema.String,
	sessionEntityId: Schema.NullOr(Schema.String),
	properties: Schema.Record(Schema.String, Schema.Json),
});
export type HistoryEvent = typeof HistoryEvent.Type;

export const historyProperty = (event: TableReference, key: string) =>
	castText(jsonPath(column(event, "properties"), key));
const own = (event: TableReference) =>
	schemaOwnerPredicate(event, "eventSchemaPluginId", { kind: "self" });
const selection = (event: TableReference) => ({
	id: selectedField(column(event, "id"), Schema.String),
	revision: selectedField(column(event, "revision"), Schema.Int),
	occurredAt: selectedField(column(event, "occurredAt"), Schema.String),
});
const historySelection = (event: TableReference, entity: TableReference) => ({
	...selection(event),
	entityId: selectedField(column(event, "entityId"), Schema.String),
	orderKey: selectedField(column(event, "orderKey"), Schema.String),
	createdAt: selectedField(column(event, "createdAt"), Schema.String),
	orderCreatedAt: selectedField(column(event, "orderCreatedAt"), Schema.String),
	eventSchemaSlug: selectedField(column(event, "eventSchemaSlug"), Schema.String),
	entitySchemaSlug: selectedField(column(entity, "entitySchemaSlug"), Schema.String),
	properties: selectedField(column(event, "properties"), HistoryEvent.fields.properties),
	sessionEntityId: selectedField(column(event, "sessionEntityId"), Schema.NullOr(Schema.String)),
});

export const correctionRecordsRecipe = <A, I>(
	codec: Schema.Codec<A, I>,
	input: {
		libraryId: string;
		subjectEntityId: string;
		slug: string;
		after?: string | undefined;
		limit?: number | undefined;
		where?: ((event: TableReference) => Predicate) | undefined;
	},
) =>
	defineRecipe(() => {
		const event = table("event", "correctionRecord");
		return {
			map: ({ records }) => Result.succeed(records),
			queries: {
				records: selectedRows(event, {
					after: input.after,
					limit: input.limit ?? 100,
					orderBy: [ascending(column(event, "id"))],
					selection: {
						...selection(event),
						properties: selectedField(column(event, "properties"), codec),
					},
					where: and(
						own(event),
						eq(column(event, "entityId"), literal(input.libraryId)),
						eq(column(event, "eventSchemaSlug"), literal(input.slug)),
						eq(historyProperty(event, "subjectEntityId"), literal(input.subjectEntityId)),
						...(input.where ? [input.where(event)] : []),
					),
				}),
			},
		};
	})();

export const historySourceRecipe = defineRecipe(
	(input: { entityId: string; progressOnly: boolean; after?: string | undefined }) => {
		const event = table("event", "correctionSource");
		const entity = table("entity", "correctionEntity");
		return {
			map: ({ events }) => Result.succeed(events),
			queries: {
				events: selectedRows(event, {
					limit: 1,
					after: input.after,
					selection: historySelection(event, entity),
					joins: [join("inner", entity, eq(column(entity, "id"), column(event, "entityId")))],
					orderBy: [
						ascending(column(event, "occurredAt")),
						ascending(column(event, "orderCreatedAt")),
						ascending(column(event, "orderKey")),
						ascending(column(event, "id")),
					],
					where: and(
						own(event),
						or(
							eq(column(event, "entityId"), literal(input.entityId)),
							eq(column(event, "sessionEntityId"), literal(input.entityId)),
						),
						inArray(
							column(event, "eventSchemaSlug"),
							(input.progressOnly ? ["progress"] : ["progress", "complete"]).map(literal),
						),
						or(
							neq(column(event, "entityId"), literal(input.entityId)),
							isNull(historyProperty(event, "completionKey")),
						),
					),
				}),
			},
		};
	},
);

export const historyRecordRecipe = defineRecipe(
	(input: { id?: string | undefined; occurrenceId?: string | undefined }) => {
		const event = table("event", "correctionEvent");
		const entity = table("entity", "correctionEventEntity");
		return {
			map: ({ event: record }) => Result.succeed(record),
			queries: {
				event: selectedOptionalRow(event, {
					orderBy: [ascending(column(event, "id"))],
					selection: historySelection(event, entity),
					joins: [join("inner", entity, eq(column(entity, "id"), column(event, "entityId")))],
					where: and(
						own(event),
						input.id
							? eq(column(event, "id"), literal(input.id))
							: and(
									eq(column(event, "eventSchemaSlug"), literal("complete")),
									eq(historyProperty(event, "completionKey"), literal(input.occurrenceId ?? "")),
								),
					),
				}),
			},
		};
	},
);

export const progressCompletionBlockersRecipe = defineRecipe(
	(input: { source: HistoryEvent; positional: boolean; libraryId: string; runKey: string }) => {
		const parent = table("entity", "progressSubject");
		const explicit = table("event", "explicitCompletion");
		const occurrence = table("event", "progressOccurrence");
		const later = orderExpressionsAreAfter(
			{
				id: column(explicit, "orderKey"),
				occurredAt: column(explicit, "occurredAt"),
				createdAt: column(explicit, "orderCreatedAt"),
			},
			{
				id: literal(input.source.orderKey),
				occurredAt: castDate(literal(input.source.occurredAt)),
				createdAt: castDate(literal(input.source.orderCreatedAt)),
			},
		);
		return {
			map: ({ blockers }) => Result.succeed(blockers),
			queries: {
				blockers: selectedOptionalRow(parent, {
					orderBy: [ascending(column(parent, "id"))],
					where: eq(column(parent, "id"), literal(input.source.entityId)),
					selection: {
						explicit: selectedField(
							exists(explicit, {
								where: and(
									own(explicit),
									eq(column(explicit, "entityId"), literal(input.source.entityId)),
									eq(column(explicit, "eventSchemaSlug"), literal("complete")),
									isNull(historyProperty(explicit, "completionKey")),
									or(
										eq(column(explicit, "occurredAt"), castDate(literal(input.source.occurredAt))),
										...(input.positional ? [later] : []),
									),
								),
							}),
							Schema.Boolean,
						),
						sameTime: selectedField(
							exists(occurrence, {
								where: and(
									own(occurrence),
									eq(column(occurrence, "entityId"), literal(input.libraryId)),
									eq(column(occurrence, "eventSchemaSlug"), literal("completion-occurrence")),
									eq(historyProperty(occurrence, "entityId"), literal(input.source.entityId)),
									eq(historyProperty(occurrence, "rule"), literal("progress")),
									eq(historyProperty(occurrence, "runKey"), literal(input.runKey)),
									eq(
										historyProperty(occurrence, "expectedOccurredAt"),
										literal(input.source.occurredAt),
									),
									neq(historyProperty(occurrence, "sourceEventId"), literal(input.source.id)),
								),
							}),
							Schema.Boolean,
						),
					},
				}),
			},
		};
	},
);

export const coverageBasisRecipe = defineRecipe(
	(input: {
		libraryId: string;
		subjectEntityId: string;
		sourceEventId: string;
		runKey: string;
	}) => {
		const occurrence = table("event", "coverageOccurrence");
		const episode = table("event", "coverageEvidence");
		return {
			map: ({ basis }) => Result.succeed(basis),
			queries: {
				basis: selectedOptionalRow(occurrence, {
					orderBy: [ascending(column(occurrence, "id"))],
					selection: {
						...selection(occurrence),
						properties: selectedField(column(occurrence, "properties"), CompletionOccurrence),
					},
					joins: [
						join(
							"inner",
							episode,
							and(
								own(episode),
								eq(column(episode, "entityId"), literal(input.libraryId)),
								eq(column(episode, "eventSchemaSlug"), literal("completion-episode")),
								eq(historyProperty(episode, "occurrenceId"), column(occurrence, "id")),
								eq(historyProperty(episode, "sourceEventId"), literal(input.sourceEventId)),
							),
						),
					],
					where: and(
						own(occurrence),
						eq(column(occurrence, "entityId"), literal(input.libraryId)),
						eq(column(occurrence, "eventSchemaSlug"), literal("completion-occurrence")),
						eq(historyProperty(occurrence, "subjectEntityId"), literal(input.subjectEntityId)),
						eq(historyProperty(occurrence, "rule"), literal("coverage")),
						eq(castBoolean(jsonPath(column(occurrence, "properties"), "frozen")), literal(true)),
						neq(historyProperty(occurrence, "runKey"), literal(input.runKey)),
					),
				}),
			},
		};
	},
);

export const historyCorrectionContextRecipe = defineRecipe(
	(input: { entityId: string; libraryId: string }) => {
		const scope = table("eventScope", "correctionScope");
		const evidenceScope = table("eventScope", "correctionEvidenceScope");
		const revision = table("dataRevision", "correctionData");
		const target = table("entity", "correctionTarget");
		const library = table("entity", "correctionLibrary");
		const work = table("event", "correctionWork");
		return {
			map: ({
				revisions,
				library: root,
				target: subject,
				work: checkpoint,
				scope: sourceScope,
				evidenceScope: evidence,
			}) =>
				Result.succeed({
					library: root,
					target: subject,
					work: checkpoint,
					evidenceRevision: evidence?.revision ?? 0,
					sourceRevision: sourceScope?.revision ?? 0,
					userRevision: revisions.items.find((row) => row.userId !== null)?.revision ?? 0,
					globalRevision: revisions.items.find((row) => row.userId === null)?.revision ?? 0,
				}),
			queries: {
				evidenceScope: selectedOptionalRow(evidenceScope, {
					orderBy: [ascending(column(evidenceScope, "id"))],
					selection: { revision: selectedField(column(evidenceScope, "revision"), Schema.Int) },
					where: and(
						own(evidenceScope),
						eq(column(evidenceScope, "entityId"), literal(input.libraryId)),
					),
				}),
				scope: selectedOptionalRow(scope, {
					orderBy: [ascending(column(scope, "id"))],
					selection: { revision: selectedField(column(scope, "revision"), Schema.Int) },
					where: and(
						schemaOwnerPredicate(scope, "eventSchemaPluginId", { kind: "self" }),
						eq(column(scope, "entityId"), literal(input.entityId)),
					),
				}),
				revisions: selectedRows(revision, {
					limit: 2,
					orderBy: [ascending(column(revision, "id"))],
					where: schemaOwnerPredicate(revision, "pluginId", { kind: "self" }),
					selection: {
						revision: selectedField(column(revision, "revision"), Schema.Int),
						userId: selectedField(column(revision, "userId"), Schema.NullOr(Schema.String)),
					},
				}),
				target: selectedOptionalRow(target, {
					orderBy: [ascending(column(target, "id"))],
					where: eq(column(target, "id"), literal(input.entityId)),
					selection: {
						schemaSlug: selectedField(column(target, "entitySchemaSlug"), Schema.String),
						properties: selectedField(
							column(target, "properties"),
							Schema.Record(Schema.String, Schema.Json),
						),
					},
				}),
				library: selectedOptionalRow(library, {
					orderBy: [ascending(column(library, "id"))],
					where: eq(column(library, "id"), literal(input.libraryId)),
					selection: {
						name: selectedField(column(library, "name"), Schema.String),
						updatedAt: selectedField(column(library, "updatedAt"), Schema.String),
						properties: selectedField(
							column(library, "properties"),
							Schema.Record(Schema.String, Schema.Json),
						),
					},
				}),
				work: selectedOptionalRow(work, {
					orderBy: [ascending(column(work, "id"))],
					selection: {
						...selection(work),
						properties: selectedField(column(work, "properties"), HistoryCorrection),
					},
					where: and(
						own(work),
						eq(column(work, "entityId"), literal(input.libraryId)),
						eq(column(work, "eventSchemaSlug"), literal("history-correction")),
						eq(historyProperty(work, "subjectEntityId"), literal(input.entityId)),
					),
				}),
			},
		};
	},
);

const requiredEpisodes = (
	parent: TableReference,
	input: {
		config: EpisodicKindConfig;
		subjectEntityId: string;
		libraryId: string;
		basisId?: string | undefined;
	},
) => {
	if (input.basisId) {
		const evidence = table("event", "requiredEvidence");
		return {
			joins: [],
			from: evidence,
			episodeId: historyProperty(evidence, "episodeId"),
			where: and(
				own(evidence),
				eq(column(evidence, "entityId"), literal(input.libraryId)),
				eq(column(evidence, "eventSchemaSlug"), literal("completion-episode")),
				eq(historyProperty(evidence, "occurrenceId"), literal(input.basisId)),
			),
		};
	}
	const episode = table("entity", "requiredEpisode");
	const scope = episodicEpisodeQuery(input.config, parent, episode, "requiredInventory");
	return { from: episode, episodeId: column(episode, "id"), ...scope };
};

export const correctionCoverageRecipe = defineRecipe(
	(input: {
		libraryId: string;
		subjectEntityId: string;
		runKey: string;
		cycle: number;
		config: EpisodicKindConfig;
		basisId?: string | undefined;
		liveSourceIds?: readonly string[] | undefined;
	}) => {
		const parent = table("entity", "coverageParent");
		const required = requiredEpisodes(parent, input);
		const scratch = table("event", "coveredEpisode");
		const covered = and(
			own(scratch),
			eq(column(scratch, "entityId"), literal(input.libraryId)),
			eq(column(scratch, "eventSchemaSlug"), literal("history-coverage")),
			eq(historyProperty(scratch, "subjectEntityId"), literal(input.subjectEntityId)),
			eq(historyProperty(scratch, "runKey"), literal(input.runKey)),
			eq(castNumber(jsonPath(column(scratch, "properties"), "cycle")), literal(input.cycle)),
		);
		const requiredCovered = exists(scratch, {
			where: and(covered, eq(historyProperty(scratch, "episodeId"), required.episodeId)),
		});
		const contributing = and(
			covered,
			exists(required.from, {
				joins: required.joins,
				where: and(required.where, eq(required.episodeId, historyProperty(scratch, "episodeId"))),
			}),
		);
		return {
			map: ({ coverage }) => Result.succeed(coverage),
			queries: {
				coverage: selectedOptionalRow(parent, {
					orderBy: [ascending(column(parent, "id"))],
					where: eq(column(parent, "id"), literal(input.subjectEntityId)),
					selection: {
						required: selectedField(
							count(required.from, { joins: required.joins, where: required.where }),
							Schema.Int,
						),
						consumedOn: selectedField(
							maximum(scratch, historyProperty(scratch, "consumedOn"), { where: contributing }),
							Schema.NullOr(Schema.String),
						),
						sourceCount: selectedField(
							countDistinct(scratch, historyProperty(scratch, "consumedOn"), {
								where: contributing,
							}),
							Schema.Int,
						),
						sourced: selectedField(
							count(scratch, {
								where: and(contributing, isNotNull(historyProperty(scratch, "consumedOn"))),
							}),
							Schema.Int,
						),
						covered: selectedField(
							count(required.from, {
								joins: required.joins,
								where: and(required.where, requiredCovered),
							}),
							Schema.Int,
						),
						unknown: selectedField(
							count(scratch, {
								where: and(
									contributing,
									eq(
										castBoolean(jsonPath(column(scratch, "properties"), "dateUnknown")),
										literal(true),
									),
								),
							}),
							Schema.Int,
						),
						live: selectedField(
							count(scratch, {
								where: and(
									contributing,
									inArray(
										historyProperty(scratch, "sourceEventId"),
										(input.liveSourceIds ?? []).map(literal),
									),
								),
							}),
							Schema.Int,
						),
						supportCount: selectedField(
							input.basisId
								? count(scratch, {
										where: and(
											covered,
											exists(required.from, {
												joins: required.joins,
												where: and(
													required.where,
													eq(required.episodeId, historyProperty(scratch, "episodeId")),
													eq(
														historyProperty(required.from, "sourceEventId"),
														historyProperty(scratch, "sourceEventId"),
													),
												),
											}),
										),
									})
								: literal(0),
							Schema.Int,
						),
					},
				}),
			},
		};
	},
);

export const correctionInventoryRecipe = defineRecipe(
	(input: {
		libraryId: string;
		subjectEntityId: string;
		runKey: string;
		cycle: number;
		config: EpisodicKindConfig;
		basisId?: string | undefined;
		after?: string | undefined;
	}) => {
		const parent = table("entity", "snapshotParent");
		const required = requiredEpisodes(parent, input);
		const scratch = table("event", "snapshotCoverage");
		const coverageId = historyProperty(scratch, "episodeId");
		return {
			map: ({ episodes }) => Result.succeed(episodes),
			queries: {
				episodes: selectedRows(required.from, {
					limit: 50,
					after: input.after,
					where: required.where,
					orderBy: [ascending(column(required.from, "id"))],
					selection: {
						episodeId: selectedField(required.episodeId, Schema.String),
						id: selectedField(column(required.from, "id"), Schema.String),
						sourceEventId: selectedField(
							historyProperty(scratch, "sourceEventId"),
							Schema.NullOr(Schema.String),
						),
					},
					joins: [
						join("inner", parent, eq(column(parent, "id"), literal(input.subjectEntityId))),
						...required.joins,
						join(
							"left",
							scratch,
							and(
								own(scratch),
								eq(column(scratch, "entityId"), literal(input.libraryId)),
								eq(column(scratch, "eventSchemaSlug"), literal("history-coverage")),
								eq(historyProperty(scratch, "subjectEntityId"), literal(input.subjectEntityId)),
								eq(historyProperty(scratch, "runKey"), literal(input.runKey)),
								eq(
									castNumber(jsonPath(column(scratch, "properties"), "cycle")),
									literal(input.cycle),
								),
								eq(coverageId, required.episodeId),
							),
						),
					],
				}),
			},
		};
	},
);
