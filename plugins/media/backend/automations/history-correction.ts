import type { ScriptHost, UserCommandInput } from "@ryot-app/plugin-backend-sdk/core";
import type { Schema } from "@ryot-app/plugin-backend-sdk/effect";
import { Effect } from "@ryot-app/plugin-backend-sdk/effect";
import {
	and,
	castBoolean,
	castNumber,
	column,
	eq,
	executeRyotqlRecipe,
	jsonPath,
	literal,
	type Recipe,
} from "@ryot-app/plugin-backend-sdk/ryotql";
import type { JsonValue } from "@ryot-app/plugin-backend-sdk/wire";
import { EntityId, EventId } from "@ryot-app/plugin-kit/schema";

import type { HistoryCorrection } from "../../shared/history-correction";
import {
	CompletionEpisode,
	CompletionOccurrence,
	HistoryCoverage,
} from "../../shared/history-correction";
import {
	type EpisodicKindConfig,
	podcastEpisodicKindConfig,
	showEpisodicKindConfig,
} from "../../shared/lifecycle-expressions";
import { isPositional, positionalProperties } from "../../shared/media-schema-slugs";
import type { HistoryCorrectionRequest } from "../contracts/history-correction";
import {
	correctionCoverageRecipe,
	correctionInventoryRecipe,
	correctionRecordsRecipe,
	coverageBasisRecipe,
	historyCorrectionContextRecipe,
	type HistoryEvent,
	historyProperty,
	historyRecordRecipe,
	historySourceRecipe,
	progressCompletionBlockersRecipe,
} from "../contracts/history-correction-recipes";
import { MediaSandboxError } from "../lib/failures";

type Host = Pick<ScriptHost, "executeRyotql" | "commitUserChanges">;
type RecordRow<A> = Pick<HistoryEvent, "id" | "revision" | "occurredAt"> & {
	readonly properties: A;
};
type Request = typeof HistoryCorrectionRequest.Type;
type Context = Recipe.Success<typeof historyCorrectionContextRecipe>;
type Creates = Array<UserCommandInput["events"]["creates"][number]>;
type Changes = Array<UserCommandInput["events"]["changes"][number]>;

const propertiesMatch = (
	actual: Readonly<Record<string, JsonValue>>,
	expected: Readonly<Record<string, JsonValue>>,
) =>
	Object.keys(actual).length === Object.keys(expected).length &&
	Object.entries(expected).every(([key, value]) => actual[key] === value);

const occurrenceProperties = (id: string, occurrence: CompletionOccurrence) => ({
	completionKey: id,
	completionSilent: occurrence.silent,
	...(occurrence.expectedConsumedOn === undefined
		? {}
		: { consumedOn: occurrence.expectedConsumedOn }),
	...(occurrence.expectedDateUnknown === true ? { dateUnknown: true } : {}),
});

const occurrenceMatches = (id: string, occurrence: CompletionOccurrence, event: HistoryEvent) =>
	event.entityId === occurrence.entityId &&
	event.sessionEntityId === (occurrence.sessionEntityId ?? null) &&
	event.occurredAt === occurrence.expectedOccurredAt &&
	event.orderKey === occurrence.expectedOrderKey &&
	event.orderCreatedAt === occurrence.expectedOrderCreatedAt &&
	propertiesMatch(event.properties, occurrenceProperties(id, occurrence));

const expected = (libraryId: string, record: RecordRow<Readonly<Record<string, JsonValue>>>) => ({
	absentProperties: [],
	sessionEntityId: null,
	kind: "fields" as const,
	properties: record.properties,
	occurredAt: record.occurredAt,
	entityId: EntityId.make(libraryId),
});
const expectedEvent = (event: HistoryEvent) => ({
	absentProperties: [],
	kind: "fields" as const,
	properties: event.properties,
	occurredAt: event.occurredAt,
	entityId: EntityId.make(event.entityId),
	sessionEntityId: event.sessionEntityId === null ? null : EntityId.make(event.sessionEntityId),
});

const writer = (libraryId: string, subjectEntityId: string) => {
	const creates: Creates = [];
	const changes: Changes = [];
	let sourceWrites = 0;
	const touches = (event: Pick<HistoryEvent, "entityId" | "sessionEntityId">) =>
		event.entityId === subjectEntityId || event.sessionEntityId === subjectEntityId;
	const create = (slug: string, properties: Readonly<Record<string, JsonValue>>) =>
		creates.push({
			properties,
			eventSchemaSlug: slug,
			entity: { kind: "root" },
			itemIdentity: `${slug}:${creates.length}`,
		});
	const replace = (
		record: RecordRow<Readonly<Record<string, JsonValue>>>,
		properties: Readonly<Record<string, JsonValue>>,
	) =>
		changes.push({
			kind: "update",
			itemIdentity: `replace:${record.id}`,
			item: {
				eventId: EventId.make(record.id),
				expected: expected(libraryId, record),
				patch: {
					properties: {
						set: properties,
						remove: Object.keys(record.properties).filter((key) => !Object.hasOwn(properties, key)),
					},
				},
			},
		});
	const remove = (record: RecordRow<Readonly<Record<string, JsonValue>>>) =>
		changes.push({
			kind: "delete",
			eventId: EventId.make(record.id),
			itemIdentity: `remove:${record.id}`,
			expected: expected(libraryId, record),
		});
	const removeOutput = (event: HistoryEvent) => {
		changes.push({
			kind: "delete",
			expected: expectedEvent(event),
			eventId: EventId.make(event.id),
			itemIdentity: `remove-output:${event.id}`,
		});
		if (touches(event)) {
			sourceWrites += 1;
		}
	};
	const override = (event: HistoryEvent) => {
		changes.push({
			kind: "update",
			itemIdentity: `override:${event.id}`,
			item: {
				expected: expectedEvent(event),
				eventId: EventId.make(event.id),
				patch: {
					orderAfter: null,
					properties: { set: {}, remove: ["completionKey", "completionSilent"] },
				},
			},
		});
		if (touches(event)) {
			sourceWrites += 1;
		}
	};
	const output = (
		occurrence: RecordRow<CompletionOccurrence>,
		value: CompletionOccurrence,
		anchor: HistoryEvent,
		actual: HistoryEvent | undefined,
	) => {
		if (value.status === "suppressed" || value.status === "overridden") {
			return;
		}
		const suffix = value.rule === "progress" ? "complete" : "parent";
		const properties = occurrenceProperties(occurrence.id, value);
		if (actual) {
			if (occurrenceMatches(occurrence.id, value, actual)) {
				return;
			}
			changes.push({
				kind: "update",
				itemIdentity: `repair:${actual.id}`,
				item: {
					expected: expectedEvent(actual),
					eventId: EventId.make(actual.id),
					patch: {
						occurredAt: anchor.occurredAt,
						orderAfter: { suffix, eventId: EventId.make(anchor.id) },
						properties: {
							set: properties,
							remove: Object.keys(actual.properties).filter(
								(key) => !Object.hasOwn(properties, key),
							),
						},
					},
				},
			});
			if (touches(actual)) {
				sourceWrites += 1;
			}
		} else {
			creates.push({
				properties,
				eventSchemaSlug: "complete",
				itemIdentity: `complete:${occurrence.id}`,
				entity: { kind: "existing", entityId: EntityId.make(value.entityId) },
				...(value.sessionEntityId === undefined
					? {}
					: {
							session: {
								kind: "existing" as const,
								entityId: EntityId.make(value.sessionEntityId),
							},
						}),
				occurredAt: anchor.occurredAt,
				orderAfter: { suffix, eventId: EventId.make(anchor.id) },
			});
			sourceWrites += 1;
		}
	};
	return {
		create,
		remove,
		output,
		creates,
		changes,
		replace,
		override,
		removeOutput,
		sourceWrites: () => sourceWrites,
	};
};

const positive = (value: JsonValue | undefined) =>
	typeof value === "number" && value > 0 ? value : 0;
const preserveDecision = (value: CompletionOccurrence): CompletionOccurrence["status"] =>
	value.status === "suppressed" || value.status === "overridden" ? value.status : "active";
const validNext = (page: {
	readonly pageInfo: { readonly hasMore: boolean; readonly nextCursor: string | null };
}) => {
	if (page.pageInfo.hasMore && page.pageInfo.nextCursor === null) {
		throw new Error("History page has no continuation cursor");
	}
	return page.pageInfo.hasMore ? (page.pageInfo.nextCursor ?? undefined) : undefined;
};

export const advanceHistoryCorrection = Effect.fn("advanceHistoryCorrection")(function* (
	host: Host,
	input: Request,
	libraryId: string,
) {
	const context = yield* executeRyotqlRecipe(
		host.executeRyotql,
		historyCorrectionContextRecipe({ libraryId, entityId: input.entityId }),
	);
	if (!context.library || !context.target) {
		return yield* new MediaSandboxError({
			message: "History subject or media library is unavailable",
		});
	}
	const previous = context.work?.properties;
	const restart =
		previous === undefined ||
		previous.sourceRevision !== context.sourceRevision ||
		(input.force && previous.requestKey !== input.requestKey);
	if (!restart && previous.phase === "done") {
		return { nextKey: "", pending: false };
	}
	const next: HistoryCorrection =
		previous !== undefined && !restart
			? { ...previous }
			: {
					step: 0,
					cycle: 0,
					phase: "audit",
					workKey: input.workKey,
					requestKey: input.requestKey,
					subjectEntityId: input.entityId,
					liveSourceIds: input.liveSourceIds,
					sourceRevision: context.sourceRevision,
					runKey: `${input.requestKey}:${context.sourceRevision}`,
				};
	const state = { ...next };
	const write = writer(libraryId, input.entityId);
	const records = <A, I>(
		codec: Schema.Codec<A, I>,
		slug: string,
		options: Pick<Parameters<typeof correctionRecordsRecipe>[1], "where" | "after" | "limit"> = {},
	) =>
		executeRyotqlRecipe(
			host.executeRyotql,
			correctionRecordsRecipe(codec, {
				slug,
				libraryId,
				subjectEntityId: input.entityId,
				...options,
			}),
		);
	const occurrence = (id: string) =>
		records(CompletionOccurrence, "completion-occurrence", {
			limit: 1,
			where: (event) => eq(column(event, "id"), literal(id)),
		}).pipe(Effect.map((page) => page.items[0]));
	const actual = (id: string) =>
		executeRyotqlRecipe(host.executeRyotql, historyRecordRecipe({ occurrenceId: id }));
	let config: EpisodicKindConfig | undefined;
	if (context.target.schemaSlug === "show") {
		config = showEpisodicKindConfig;
	}
	if (context.target.schemaSlug === "podcast") {
		config = podcastEpisodicKindConfig;
	}
	const changePhase = (phase: HistoryCorrection["phase"]) => {
		state.phase = phase;
		delete state.after;
	};
	const advanceCursor = (after: string | undefined) => {
		if (after === undefined) {
			delete state.after;
		} else {
			state.after = after;
		}
	};
	const finishCoverageItem = (page: {
		readonly pageInfo: { readonly hasMore: boolean; readonly nextCursor: string | null };
	}) => {
		advanceCursor(validNext(page));
		if (state.after === undefined) {
			changePhase("sweep");
		}
	};
	const deactivate = Effect.fnUntraced(function* (row: RecordRow<CompletionOccurrence>) {
		if (row.properties.status !== "active") {
			return;
		}
		const output = yield* actual(row.id);
		if (output) {
			write.removeOutput(output);
		}
		write.replace(row, { ...row.properties, status: "inactive" });
	});
	if (!restart) {
		if (state.phase === "audit" || state.phase === "prune" || state.phase === "sweep") {
			const phase = state.phase;
			const page = yield* records(CompletionOccurrence, "completion-occurrence", {
				limit: 1,
				after: state.after,
				...(phase === "prune"
					? {
							where: (event: Parameters<typeof historyProperty>[0]) =>
								eq(historyProperty(event, "rule"), literal("progress")),
						}
					: {}),
			});
			const row = page.items[0];
			if (row) {
				if (phase === "audit" && row.properties.status === "active") {
					const output = yield* actual(row.id);
					if (!output) {
						write.replace(row, { ...row.properties, status: "suppressed" });
					} else if (!occurrenceMatches(row.id, row.properties, output)) {
						write.override(output);
						write.replace(row, { ...row.properties, status: "overridden" });
					}
				} else if (phase !== "audit" && row.properties.runKey !== state.runKey) {
					yield* deactivate(row);
				}
			}
			advanceCursor(validNext(page));
			if (state.after === undefined) {
				if (phase === "audit") {
					changePhase("progress");
				} else if (phase === "prune") {
					changePhase(config ? "coverage" : "clear");
				} else {
					changePhase("clear");
					state.coverageFinished = true;
				}
			}
		} else if (state.phase === "progress") {
			const page = yield* executeRyotqlRecipe(
				host.executeRyotql,
				historySourceRecipe({ progressOnly: true, after: state.after, entityId: input.entityId }),
			);
			const source = page.items[0];
			let advance = true;
			if (source) {
				const saved = yield* records(CompletionOccurrence, "completion-occurrence", {
					limit: 1,
					where: (event) =>
						and(
							eq(historyProperty(event, "rule"), literal("progress")),
							eq(historyProperty(event, "sourceEventId"), literal(source.id)),
						),
				});
				const row = saved.items[0];
				const positional = isPositional(source.entitySchemaSlug);
				const position = positional ? positionalProperties[source.entitySchemaSlug] : undefined;
				let total = position ? positive(context.target.properties[position.total]) : 0;
				if (row?.properties.frozen) {
					total = row.properties.total;
				}
				const blockers = yield* executeRyotqlRecipe(
					host.executeRyotql,
					progressCompletionBlockersRecipe({
						source,
						libraryId,
						runKey: state.runKey,
						positional: positional && row?.properties.frozen !== true,
					}),
				);
				const full =
					(source.properties["progressPercent"] === 100 ||
						(position !== undefined &&
							total > 0 &&
							positive(source.properties[position.position]) >= total)) &&
					blockers?.explicit !== true &&
					(!positional || blockers?.sameTime !== true);
				if (!row) {
					write.create("completion-occurrence", {
						total,
						frozen: false,
						rule: "progress",
						status: "inactive",
						runKey: state.runKey,
						sourceEventId: source.id,
						entityId: source.entityId,
						subjectEntityId: input.entityId,
						silent: !full || source.revision !== 0 || !state.liveSourceIds.includes(source.id),
						...(source.sessionEntityId === null ? {} : { sessionEntityId: source.sessionEntityId }),
					});
					advance = false;
				} else if (full) {
					const output = yield* actual(row.id);
					const value = {
						...row.properties,
						total,
						frozen: true,
						runKey: state.runKey,
						expectedOccurredAt: source.occurredAt,
						status: preserveDecision(row.properties),
						expectedOrderCreatedAt: source.orderCreatedAt,
						expectedOrderKey: `${source.orderKey}~complete`,
						silent: output
							? row.properties.silent
							: row.properties.silent || row.properties.frozen || source.revision !== 0,
						...(typeof source.properties["consumedOn"] === "string"
							? { expectedConsumedOn: source.properties["consumedOn"] }
							: {}),
						...(source.properties["dateUnknown"] === true ? { expectedDateUnknown: true } : {}),
					};
					if (typeof source.properties["consumedOn"] !== "string") {
						delete value.expectedConsumedOn;
					}
					if (source.properties["dateUnknown"] !== true) {
						delete value.expectedDateUnknown;
					}
					write.output(row, value, source, output);
					write.replace(row, value);
				} else {
					yield* deactivate(row);
				}
			}
			if (advance) {
				advanceCursor(validNext(page));
				if (state.after === undefined) {
					changePhase("prune");
				}
			}
		} else if (state.phase === "coverage" && config) {
			const page = yield* executeRyotqlRecipe(
				host.executeRyotql,
				historySourceRecipe({ after: state.after, progressOnly: false, entityId: input.entityId }),
			);
			const source = page.items[0];
			if (!source) {
				changePhase("sweep");
			} else if (source.entityId === input.entityId) {
				if (source.eventSchemaSlug === "complete") {
					state.phase = "clear";
					state.cycle += 1;
					delete state.basisId;
				}
				finishCoverageItem(page);
			} else {
				const saved = yield* records(HistoryCoverage, "history-coverage", {
					limit: 1,
					where: (event) =>
						and(
							eq(historyProperty(event, "runKey"), literal(state.runKey)),
							eq(castNumber(jsonPath(column(event, "properties"), "cycle")), literal(state.cycle)),
							eq(historyProperty(event, "episodeId"), literal(source.entityId)),
						),
				});
				const scratch = saved.items[0];
				if (source.eventSchemaSlug === "progress") {
					if (scratch) {
						write.remove(scratch);
					}
					finishCoverageItem(page);
				} else {
					let sourceId = source.id;
					const key = source.properties["completionKey"];
					if (typeof key === "string") {
						const evidence = yield* occurrence(key);
						if (!evidence?.properties.sourceEventId) {
							return yield* new MediaSandboxError({
								message: "Episode completion evidence is unavailable",
							});
						}
						sourceId = evidence.properties.sourceEventId;
					}
					const coverageProperties = {
						cycle: state.cycle,
						runKey: state.runKey,
						sourceEventId: sourceId,
						episodeId: source.entityId,
						subjectEntityId: input.entityId,
						...(typeof source.properties["consumedOn"] === "string"
							? { consumedOn: source.properties["consumedOn"] }
							: {}),
						...(source.properties["dateUnknown"] === true ? { dateUnknown: true } : {}),
					};
					const captured =
						scratch !== undefined && propertiesMatch(scratch.properties, coverageProperties);
					if (!captured) {
						if (scratch) {
							write.replace(scratch, coverageProperties);
						} else {
							write.create("history-coverage", coverageProperties);
						}
					}
					if (captured) {
						if (!state.basisId) {
							const basis = yield* executeRyotqlRecipe(
								host.executeRyotql,
								coverageBasisRecipe({
									libraryId,
									runKey: state.runKey,
									sourceEventId: sourceId,
									subjectEntityId: input.entityId,
								}),
							);
							if (basis) {
								state.basisId = basis.id;
							}
						}
						let coverage = yield* executeRyotqlRecipe(
							host.executeRyotql,
							correctionCoverageRecipe({
								config,
								libraryId,
								cycle: state.cycle,
								runKey: state.runKey,
								basisId: state.basisId,
								subjectEntityId: input.entityId,
								liveSourceIds: state.liveSourceIds,
							}),
						);
						if (state.basisId && coverage?.supportCount === 0) {
							delete state.basisId;
							coverage = yield* executeRyotqlRecipe(
								host.executeRyotql,
								correctionCoverageRecipe({
									config,
									libraryId,
									cycle: state.cycle,
									runKey: state.runKey,
									subjectEntityId: input.entityId,
									liveSourceIds: state.liveSourceIds,
								}),
							);
						}
						const productionStatus = context.target.properties["productionStatus"];
						const terminal =
							typeof productionStatus === "string" &&
							["ended", "canceled", "cancelled"].includes(productionStatus.trim().toLowerCase());
						if (
							coverage &&
							coverage.required > 0 &&
							coverage.required === coverage.covered &&
							(terminal || state.basisId !== undefined)
						) {
							state.closingEventId = source.id;
							state.coverageFinished = !page.pageInfo.hasMore;
							advanceCursor(validNext(page));
							if (!state.basisId) {
								const candidate = yield* records(CompletionOccurrence, "completion-occurrence", {
									limit: 1,
									where: (event) =>
										and(
											eq(historyProperty(event, "rule"), literal("coverage")),
											eq(historyProperty(event, "sourceEventId"), literal(sourceId)),
											eq(
												castBoolean(jsonPath(column(event, "properties"), "frozen")),
												literal(false),
											),
										),
								});
								if (candidate.items[0]) {
									state.basisId = candidate.items[0].id;
								} else {
									write.create("completion-occurrence", {
										total: 0,
										frozen: false,
										rule: "coverage",
										status: "building",
										runKey: state.runKey,
										sourceEventId: sourceId,
										entityId: input.entityId,
										silent: coverage.live === 0,
										sessionEntityId: input.entityId,
										subjectEntityId: input.entityId,
									});
									delete state.closingEventId;
									delete state.coverageFinished;
									advanceCursor(previous.after);
								}
							}
							if (state.basisId) {
								const basis = yield* occurrence(state.basisId);
								state.phase = basis?.properties.frozen ? "snapshot" : "reset-snapshot";
								state.globalRevision = context.globalRevision;
								state.userRevision = context.userRevision;
							}
							delete state.evidenceAfter;
						} else {
							finishCoverageItem(page);
						}
					}
				}
			}
		} else if (
			(state.phase === "reset-snapshot" ||
				state.phase === "snapshot" ||
				state.phase === "publish") &&
			config &&
			state.basisId
		) {
			const basis = yield* occurrence(state.basisId);
			if (!basis) {
				return yield* new MediaSandboxError({ message: "Completion occurrence is unavailable" });
			}
			if (state.phase === "reset-snapshot") {
				const page = yield* records(CompletionEpisode, "completion-episode", {
					where: (event) => eq(historyProperty(event, "occurrenceId"), literal(basis.id)),
				});
				for (const row of page.items) {
					write.remove(row);
				}
				state.globalRevision = context.globalRevision;
				state.userRevision = context.userRevision;
				if (!page.pageInfo.hasMore) {
					state.phase = "snapshot";
					delete state.evidenceAfter;
				}
			} else if (
				!basis.properties.frozen &&
				(state.globalRevision !== context.globalRevision ||
					state.userRevision !== context.userRevision)
			) {
				state.phase = "reset-snapshot";
				delete state.evidenceAfter;
			} else if (state.phase === "snapshot") {
				const page = yield* executeRyotqlRecipe(
					host.executeRyotql,
					correctionInventoryRecipe({
						config,
						libraryId,
						cycle: state.cycle,
						runKey: state.runKey,
						subjectEntityId: input.entityId,
						...(basis.properties.frozen ? { basisId: basis.id } : {}),
						after: state.evidenceAfter,
					}),
				);
				for (const row of page.items) {
					const properties = {
						occurrenceId: basis.id,
						episodeId: row.episodeId,
						subjectEntityId: input.entityId,
						...(row.sourceEventId === null ? {} : { sourceEventId: row.sourceEventId }),
					};
					if (basis.properties.frozen) {
						const saved = yield* records(CompletionEpisode, "completion-episode", {
							limit: 1,
							where: (event) => eq(column(event, "id"), literal(row.id)),
						});
						if (!saved.items[0]) {
							return yield* new MediaSandboxError({
								message: "Required episode evidence is unavailable",
							});
						}
						write.replace(saved.items[0], properties);
					} else {
						write.create("completion-episode", properties);
					}
				}
				const after = validNext(page);
				if (after === undefined) {
					delete state.evidenceAfter;
				} else {
					state.evidenceAfter = after;
				}
				if (state.evidenceAfter === undefined) {
					state.phase = "publish";
				}
			} else {
				const coverage = yield* executeRyotqlRecipe(
					host.executeRyotql,
					correctionCoverageRecipe({
						config,
						libraryId,
						basisId: basis.id,
						cycle: state.cycle,
						runKey: state.runKey,
						subjectEntityId: input.entityId,
					}),
				);
				const closing = state.closingEventId
					? yield* executeRyotqlRecipe(
							host.executeRyotql,
							historyRecordRecipe({ id: state.closingEventId }),
						)
					: null;
				if (!closing || !coverage) {
					return yield* new MediaSandboxError({ message: "Closing coverage is unavailable" });
				}
				if (coverage.required > 0 && coverage.required === coverage.covered) {
					const output = yield* actual(basis.id);
					const value = {
						...basis.properties,
						frozen: true,
						runKey: state.runKey,
						expectedOccurredAt: closing.occurredAt,
						status: preserveDecision(basis.properties),
						expectedOrderKey: `${closing.orderKey}~parent`,
						expectedOrderCreatedAt: closing.orderCreatedAt,
						silent: output
							? basis.properties.silent
							: basis.properties.frozen || basis.properties.silent,
					};
					if (
						coverage.sourceCount === 1 &&
						coverage.sourced === coverage.required &&
						coverage.consumedOn !== null
					) {
						value.expectedConsumedOn = coverage.consumedOn;
					} else {
						delete value.expectedConsumedOn;
					}
					if (coverage.unknown === coverage.required) {
						value.expectedDateUnknown = true;
					} else {
						delete value.expectedDateUnknown;
					}
					write.output(basis, value, closing, output);
					write.replace(basis, value);
					state.cycle += 1;
					state.phase = "clear";
				} else {
					state.phase = state.coverageFinished ? "sweep" : "coverage";
				}
				delete state.basisId;
				delete state.closingEventId;
				delete state.evidenceAfter;
				delete state.globalRevision;
				delete state.userRevision;
			}
		} else if (state.phase === "clear") {
			const page = yield* records(HistoryCoverage, "history-coverage");
			for (const row of page.items) {
				write.remove(row);
			}
			if (!page.pageInfo.hasMore) {
				if (!config || state.coverageFinished) {
					changePhase("done");
				} else {
					state.phase = "coverage";
				}
			}
		} else {
			return yield* new MediaSandboxError({ message: "History correction phase is invalid" });
		}
	}
	state.step += 1;
	state.workKey = input.workKey;
	state.sourceRevision = context.sourceRevision + write.sourceWrites();
	if (context.work) {
		write.replace(context.work, state);
	} else {
		write.create("history-correction", state);
	}
	yield* commitStep(host, libraryId, input.entityId, context, write);
	return {
		pending: state.phase !== "done",
		nextKey: `${input.entityId}:${state.runKey}:${state.step}`,
	};
});

const commitStep = Effect.fn("commitHistoryCorrectionStep")(function* (
	host: Host,
	libraryId: string,
	entityId: string,
	context: Context,
	write: ReturnType<typeof writer>,
) {
	const library = context.library;
	if (!library) {
		return yield* new MediaSandboxError({ message: "Media library is unavailable" });
	}
	yield* host.commitUserChanges({
		relationships: [],
		dataBaseline: { userRevision: context.userRevision, globalRevision: context.globalRevision },
		events: {
			creates: write.creates,
			changes: write.changes,
			baselines: [
				{ revision: context.sourceRevision, entityId: EntityId.make(entityId) },
				{ revision: context.evidenceRevision, entityId: EntityId.make(libraryId) },
			],
		},
		entity: {
			name: library.name,
			properties: library.properties,
			entitySchemaSlug: "media-library",
			target: {
				kind: "update",
				entityId: EntityId.make(libraryId),
				expected: {
					name: library.name,
					updatedAt: library.updatedAt,
					properties: library.properties,
				},
			},
		},
	});
	return undefined;
});
