import type { CommittedChanges } from "@ryot-app/contract/modules/changes/change-set";
import { EntityId } from "@ryot-app/contract/schema/brands";
import type { JsonValue } from "@ryot-app/contract/schema/json";
import {
	workoutDeleteRecipe,
	workoutEditorSaveRecipe,
} from "@ryot-app/fitness-plugin/contracts/operation-recipes";
import { exerciseKindSchema } from "@ryot-app/fitness-plugin/exercise-kinds";
import { WorkoutSetMeasurementsSchema } from "@ryot-app/fitness-plugin/workout-records";
import {
	requiredWorkoutMeasurementsByKind,
	WorkoutSetLotSchema,
} from "@ryot-app/fitness-plugin/workout-set";
import {
	MediaActivityDeleteInput,
	MediaActivityEditOutput,
	type MediaActivityEntry,
	MediaActivityLogInput,
	MediaActivityLogOutput,
} from "@ryot-app/media-plugin/shared/media-activity-operations";
import {
	MediaReviewCreateInput,
	MediaReviewDeleteInput,
	MediaReviewOutput,
} from "@ryot-app/media-plugin/shared/media-review-operations";
import { PLUGIN_PACKAGE_ID } from "@ryot-app/media-plugin/shared/plugin-identity";
import { defineOperationRecipe, type OperationRecipe } from "@ryot-app/plugin-kit/operations";
import { Effect, Predicate, Schema } from "effect";
import type { HttpClient } from "effect/http";

import type { Client } from "~/fixtures/kernel/auth";
import { invokeCommittingOperation } from "~/fixtures/kernel/operations";
import { workoutData, workoutOccurrence, workoutSet } from "~/fixtures/plugins/fitness";
import { requirePresent } from "~/support/assertions";
import type { E2eServices } from "~/support/e2e-runtime";
import { describe, it } from "~/support/effect-test";
import {
	appendReport,
	failureTag,
	impersonate,
	percentile,
	perfDatabase,
	statementCalls,
} from "~/support/perf";

const RUN_WARM_WRITES = process.env.RUN_WARM_WRITES === "1";
const OUT = String(process.env.WARM_WRITES_OUT);
const WARMUP = Number(process.env.WARM_WRITES_WARMUP ?? "3");
const SAMPLES = Number(process.env.WARM_WRITES_SAMPLES ?? "20");
const ONLY = process.env.WARM_WRITES_ONLY?.split(",").filter(Boolean);
const USER_RANKS = (process.env.WARM_WRITES_USER_RANKS ?? "0").split(",").map(Number);

const reviewCreate = defineOperationRecipe({
	output: MediaReviewOutput,
	packageId: PLUGIN_PACKAGE_ID,
	input: MediaReviewCreateInput,
	operationSlug: "media-review-create",
});
const reviewDelete = defineOperationRecipe({
	output: MediaReviewOutput,
	packageId: PLUGIN_PACKAGE_ID,
	input: MediaReviewDeleteInput,
	operationSlug: "media-review-delete",
});
const activityLog = defineOperationRecipe({
	packageId: PLUGIN_PACKAGE_ID,
	input: MediaActivityLogInput,
	output: MediaActivityLogOutput,
	operationSlug: "media-activity-log",
});
const activityDelete = defineOperationRecipe({
	packageId: PLUGIN_PACKAGE_ID,
	output: MediaActivityEditOutput,
	input: MediaActivityDeleteInput,
	operationSlug: "media-activity-delete",
});

type PerfDatabase = Effect.Success<typeof perfDatabase>;
type Write<A> = Effect.Effect<A, unknown, HttpClient.HttpClient>;

/** One write measured warm against existing history; `undo` restores the history after each sample. */
type Scenario = {
	readonly info: Readonly<Record<string, number>>;
	readonly undo: (client: Client) => Write<unknown>;
	readonly act: (client: Client) => Write<CommittedChanges>;
};

const submission = () => ({
	submissionId: crypto.randomUUID(),
	submittedAt: new Date().toISOString(),
});

const commit = <Input, InputEncoded extends JsonValue, Output, OutputEncoded>(
	client: Client,
	recipe: OperationRecipe<Input, InputEncoded, Output, OutputEncoded>,
	input: Input,
) =>
	invokeCommittingOperation(client, recipe, input, { idempotencyKey: crypto.randomUUID() }).pipe(
		Effect.map(({ committed }) => committed),
	);

const eventIds = (changes: CommittedChanges) => changes.events.map(({ eventId }) => eventId);

const ReviewRows = Schema.Array(
	Schema.Struct({
		id: Schema.String,
		history: Schema.Finite,
		entityId: Schema.String,
		properties: Schema.Struct({
			isSpoiler: Schema.optional(Schema.Boolean),
			text: Schema.optional(Schema.NullOr(Schema.String)),
			rating: Schema.optional(Schema.NullOr(Schema.Finite)),
		}),
	}),
);
const HistoryRows = Schema.Array(Schema.Struct({ id: Schema.String, history: Schema.Finite }));
const EntityRows = Schema.Array(Schema.Struct({ id: Schema.String }));
const UserRows = Schema.Array(Schema.Struct({ userId: Schema.String }));
const SetRows = Schema.Array(
	Schema.Struct({
		entityId: EntityId,
		properties: Schema.Struct({
			...WorkoutSetMeasurementsSchema.fields,
			exerciseKind: exerciseKindSchema,
			restTime: Schema.optional(Schema.Finite),
			setLot: Schema.optional(WorkoutSetLotSchema),
			exerciseOrder: Schema.optional(Schema.Finite),
		}),
	}),
);
type StoredSet = (typeof SetRows.Type)[number];

/** Whether the editor would accept the set as new: older imports can lack a measurement. */
const complete = ({ properties }: StoredSet) =>
	requiredWorkoutMeasurementsByKind[properties.exerciseKind].every(
		(key) => properties[key] !== undefined,
	);

const reviewScenario = Effect.fn("reviewScenario")(function* (
	db: PerfDatabase,
	userId: string,
	schemaSlug: string,
	order: "asc" | "desc",
) {
	const target = (yield* db.query(
		ReviewRows,
		`select v.id, v.entity_id as "entityId", v.properties,
			(select count(*) from derived_value d where d.subject_entity_id = v.entity_id and d.kind = 'event')::float8 as history
		from event v join entity e on e.id = v.entity_id
		where v.user_id = $1 and v.event_schema_slug = 'review' and e.entity_schema_slug = $2
			and not (v.properties ? 'consumptionEventId')
			and (v.properties->>'rating' is not null or nullif(btrim(v.properties->>'text'), '') is not null)
		order by history ${order}, v.id limit 1`,
		[userId, schemaSlug],
	))[0];
	if (target === undefined) {
		return undefined;
	}
	const { properties } = target;
	let eventId = target.id;
	return {
		info: { subjectHistory: target.history },
		act: (client) => commit(client, reviewDelete, { ...submission(), eventId }),
		undo: (client) =>
			commit(client, reviewCreate, {
				entityId: target.entityId,
				text: properties.text ?? null,
				rating: properties.rating ?? null,
				isSpoiler: properties.isSpoiler ?? false,
			}).pipe(
				Effect.map((changes) => {
					eventId = requirePresent(eventIds(changes)[0], "Expected the re-created review");
				}),
			),
	} satisfies Scenario;
});

const activityScenario = (info: Scenario["info"], entry: MediaActivityEntry): Scenario => {
	let created: readonly string[] = [];
	return {
		info,
		undo: (client) => commit(client, activityDelete, { ...submission(), eventIds: created }),
		act: (client) =>
			commit(client, activityLog, { ...submission(), entry }).pipe(
				Effect.tap((changes) =>
					Effect.sync(() => {
						created = eventIds(changes);
					}),
				),
			),
	};
};

const completionScenario = Effect.fn("completionScenario")(function* (
	db: PerfDatabase,
	userId: string,
	schemaSlug: string,
	order: "asc" | "desc",
) {
	const target = (yield* db.query(
		HistoryRows,
		`select e.id, count(v.id)::float8 as history from entity e
		join event v on v.entity_id = e.id and v.event_schema_slug = 'complete' and v.user_id = $1
		where e.entity_schema_slug = $2 group by e.id order by history ${order}, e.id limit 1`,
		[userId, schemaSlug],
	))[0];
	return target === undefined
		? undefined
		: activityScenario(
				{ entityCompletes: target.history },
				{ kind: "complete", entityId: target.id, when: { kind: "now" } },
			);
});

const latestEpisode = (db: PerfDatabase, showId: string) =>
	db
		.query(
			EntityRows,
			`select v.entity_id as id from event v
			join derived_value d on d.target_id = v.id
			join entity episode on episode.id = v.entity_id and episode.entity_schema_slug = 'show-episode'
			where d.subject_entity_id = $1 and v.event_schema_slug = 'complete'
			order by v.occurred_at desc nulls last limit 1`,
			[showId],
		)
		.pipe(Effect.map((rows) => rows[0]?.id));

const episodeScenario = Effect.fn("episodeScenario")(function* (
	db: PerfDatabase,
	show: undefined | (typeof HistoryRows.Type)[number],
) {
	const episodeId = show === undefined ? undefined : yield* latestEpisode(db, show.id);
	return show === undefined || episodeId === undefined
		? undefined
		: activityScenario(
				{ subjectHistory: show.history },
				{
					kind: "episodes",
					when: { kind: "now" },
					parentEntityId: show.id,
					episodeEntityIds: [episodeId],
				},
			);
});

const showByHistory = (db: PerfDatabase, userId: string, order: "asc" | "desc") =>
	db
		.query(
			HistoryRows,
			`select d.subject_entity_id as id, count(*)::float8 as history from derived_value d
			join entity s on s.id = d.subject_entity_id and s.entity_schema_slug = 'show'
			where d.kind = 'event' and d.user_id = $1 group by 1 order by history ${order}, 1 limit 1`,
			[userId],
		)
		.pipe(Effect.map((rows) => rows[0]));

const workoutScenario = (
	history: number,
	occurrences: ReadonlyArray<{
		readonly exerciseId: EntityId;
		readonly sets: readonly StoredSet[];
	}>,
): Scenario => {
	let workoutId: string | undefined;
	const sets = occurrences.reduce((total, occurrence) => total + occurrence.sets.length, 0);
	return {
		info: { sets, history, exercises: occurrences.length },
		undo: (client) =>
			commit(client, workoutDeleteRecipe, {
				...submission(),
				entityId: EntityId.make(requirePresent(workoutId, "Expected the saved workout")),
			}),
		act: (client) => {
			const endedAt = Date.now() - 5000;
			const startedAt = endedAt - 3_600_000;
			let index = 0;
			return commit(client, workoutEditorSaveRecipe, {
				...submission(),
				data: workoutData({
					name: "Measurement workout",
					endedAt: new Date(endedAt).toISOString(),
					startedAt: new Date(startedAt).toISOString(),
					occurrences: occurrences.map((occurrence) =>
						workoutOccurrence(
							occurrence.exerciseId,
							occurrence.sets.map(({ properties }) => {
								index += 1;
								const at = new Date(
									startedAt + (index / (sets + 1)) * (endedAt - startedAt),
								).toISOString();
								return workoutSet({
									occurredAt: at,
									confirmedAt: at,
									exerciseKind: properties.exerciseKind,
									...(properties.setLot === undefined ? {} : { setLot: properties.setLot }),
									...(properties.restTime === undefined ? {} : { restTime: properties.restTime }),
									measurements: {
										...(properties.reps === undefined ? {} : { reps: properties.reps }),
										...(properties.weight === undefined ? {} : { weight: properties.weight }),
										...(properties.duration === undefined ? {} : { duration: properties.duration }),
										...(properties.distance === undefined ? {} : { distance: properties.distance }),
									},
								});
							}),
						),
					),
				}),
			}).pipe(
				Effect.tap((changes) =>
					Effect.sync(() => {
						workoutId = changes.entityId;
					}),
				),
			);
		},
	};
};

const exerciseScenario = Effect.fn("exerciseScenario")(function* (
	db: PerfDatabase,
	userId: string,
	order: "asc" | "desc",
) {
	const exercise = (yield* db.query(
		HistoryRows,
		`select entity_id as id, count(*)::float8 as history from event
		where user_id = $1 and event_schema_slug = 'workout-set' and properties->>'exerciseKind' = 'reps_and_weight'
		group by 1 order by history ${order}, 1 limit 1`,
		[userId],
	))[0];
	if (exercise === undefined) {
		return undefined;
	}
	const sets = yield* db.query(
		SetRows,
		`select entity_id as "entityId", properties from event
		where event_schema_slug = 'workout-set' and entity_id = $1 order by occurred_at desc nulls last limit 20`,
		[exercise.id],
	);
	const recent = sets.filter(complete);
	return recent.length === 0
		? undefined
		: workoutScenario(exercise.history, [
				{
					exerciseId: EntityId.make(exercise.id),
					sets: Array.from({ length: 3 }, (_, index) =>
						requirePresent(recent[index] ?? recent[0], "Expected a set"),
					),
				},
			]);
});

const repeatLatestScenario = Effect.fn("repeatLatestScenario")(function* (
	db: PerfDatabase,
	userId: string,
) {
	const workouts = yield* db.query(
		EntityRows,
		`select e.id from entity e where e.user_id = $1 and e.entity_schema_slug = 'workout'
			and exists (select 1 from event s where s.session_entity_id = e.id and s.event_schema_slug = 'workout-set')
		order by e.occurs_at desc nulls last limit 20`,
		[userId],
	);
	let sets: readonly StoredSet[] = [];
	for (const workout of workouts) {
		sets = yield* db.query(
			SetRows,
			`select entity_id as "entityId", properties from event
			where session_entity_id = $1 and event_schema_slug = 'workout-set'
			order by (properties->>'exerciseOrder')::int, (properties->>'setOrder')::int`,
			[workout.id],
		);
		if (sets.every(complete)) {
			break;
		}
	}
	if (sets.length === 0 || !sets.every(complete)) {
		return undefined;
	}
	const occurrences = new Map<number, { sets: StoredSet[]; exerciseId: EntityId }>();
	for (const set of sets) {
		const order = set.properties.exerciseOrder ?? 0;
		const occurrence = occurrences.get(order) ?? { sets: [], exerciseId: set.entityId };
		occurrence.sets.push(set);
		occurrences.set(order, occurrence);
	}
	return workoutScenario(sets.length, [...occurrences.values()]);
});

const scenarios = (db: PerfDatabase, userId: string) =>
	({
		"workout-save:repeat-latest": repeatLatestScenario(db, userId),
		"workout-save:exercise-long": exerciseScenario(db, userId, "desc"),
		"workout-save:exercise-short": exerciseScenario(db, userId, "asc"),
		"review-delete:show-long": reviewScenario(db, userId, "show", "desc"),
		"review-delete:movie-short": reviewScenario(db, userId, "movie", "asc"),
		"progress-log:movie-short": completionScenario(db, userId, "movie", "asc"),
		"progress-log:music-long": completionScenario(db, userId, "music", "desc"),
		"progress-log:show-long": showByHistory(db, userId, "desc").pipe(
			Effect.flatMap((show) => episodeScenario(db, show)),
		),
		"progress-log:show-short": showByHistory(db, userId, "asc").pipe(
			Effect.flatMap((show) => episodeScenario(db, show)),
		),
	}) satisfies Record<string, Effect.Effect<Scenario | undefined, unknown, unknown>>;

type Session = { client: Client; readonly renew: Effect.Effect<Client, unknown, E2eServices> };

/** Runs a write as the session's user, signing in again once when its token has expired. */
const authorized = <A>(session: Session, write: (client: Client) => Write<A>) =>
	write(session.client).pipe(
		Effect.catchIf(
			(error) => Predicate.isTagged(error, "AuthUnauthorized"),
			() =>
				session.renew.pipe(
					Effect.tap((client) =>
						Effect.sync(() => {
							session.client = client;
						}),
					),
					Effect.flatMap(write),
				),
		),
	);

/**
 * Times a scenario as the session's user. `quiet` waits for the database to settle between samples;
 * users measured together cannot wait for each other, so their statement counts include each other's.
 */
const measure = Effect.fn("measure")(function* (
	db: PerfDatabase,
	name: string,
	scenario: Scenario,
	user: { readonly rank: number; readonly session: Session; readonly quiet: Effect.Effect<void> },
) {
	const { rank, quiet, session } = user;
	const samples: Array<{ ms: number; calls: number; execMs: number; aftermath: number }> = [];
	yield* quiet;
	for (let index = 0; index < WARMUP + SAMPLES; index++) {
		const before = statementCalls(yield* db.statements);
		const startedAt = performance.now();
		const outcome = yield* authorized(session, scenario.act).pipe(
			Effect.as("ok"),
			Effect.catchCause((cause) => Effect.succeed(failureTag(cause))),
		);
		const ms = performance.now() - startedAt;
		const after = statementCalls(yield* db.statements);
		if (outcome !== "ok") {
			yield* appendReport(OUT, { name, rank, outcome, info: scenario.info, failedSample: index });
			return;
		}
		yield* quiet;
		const settled = statementCalls(yield* db.statements);
		if (index >= WARMUP) {
			samples.push({
				ms,
				calls: after.calls - before.calls,
				execMs: after.execMs - before.execMs,
				aftermath: settled.calls - before.calls,
			});
		}
		yield* authorized(session, scenario.undo);
		yield* quiet;
	}
	yield* appendReport(OUT, {
		name,
		rank,
		n: samples.length,
		info: scenario.info,
		statementsMax: Math.max(...samples.map((sample) => sample.calls)),
		statementsP50: percentile(
			samples.map((sample) => sample.calls),
			0.5,
		),
		aftermathP50: percentile(
			samples.map((sample) => sample.aftermath),
			0.5,
		),
		rttP50: Math.round(
			percentile(
				samples.map((sample) => sample.ms),
				0.5,
			),
		),
		rttP95: Math.round(
			percentile(
				samples.map((sample) => sample.ms),
				0.95,
			),
		),
		execMsP50: Math.round(
			percentile(
				samples.map((sample) => sample.execMs),
				0.5,
			),
		),
	});
});

describe.skipIf(!RUN_WARM_WRITES)("warm writes", () => {
	it.live("times writes against a restored library's longest and shortest histories", () =>
		Effect.gen(function* () {
			const db = yield* perfDatabase;
			const ranked = yield* db.query(
				UserRows,
				`select e.user_id as "userId" from event e join "user" u on u.id = e.user_id
				where u.disabled_at is null group by 1 order by count(*) desc, 1 limit $1`,
				[Math.max(...USER_RANKS) + 1],
			);
			const quiet = USER_RANKS.length === 1 ? db.quiet : Effect.void;
			yield* Effect.forEach(
				USER_RANKS,
				(rank) =>
					Effect.gen(function* () {
						const { userId } = requirePresent(
							ranked[rank],
							"the restored database has no such user",
						);
						const session: Session = {
							renew: impersonate(userId),
							client: yield* impersonate(userId),
						};
						for (const [name, prepare] of Object.entries(scenarios(db, userId))) {
							if (ONLY !== undefined && !ONLY.some((prefix) => name.startsWith(prefix))) {
								continue;
							}
							const scenario = yield* prepare;
							yield* scenario === undefined
								? appendReport(OUT, { name, rank, outcome: "no-target" })
								: measure(db, name, scenario, { rank, quiet, session });
						}
					}),
				{ discard: true, concurrency: "unbounded" },
			);
		}),
	);
});
