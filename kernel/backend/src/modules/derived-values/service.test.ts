import { expect } from "bun:test";

import { DbError } from "@ryot-app/contract/errors";
import {
	type FoldEventChange,
	type FoldEventImage,
	FoldInput,
	type FoldRefresh,
	type FoldSubjectInput,
} from "@ryot-app/contract/modules/events/folds";
import {
	EntityId,
	EntitySchemaSlug,
	EventId,
	EventSchemaSlug,
	PluginId,
	type PluginPackageId,
	UserId,
} from "@ryot-app/contract/schema/brands";
import { TimeZone } from "@ryot-app/contract/schema/time-zone";
import { IsoUtcString } from "@ryot-app/contract/schema/utils";
import { testPluginPackageId } from "@ryot-app/contract/testing";
import { KERNEL_NAMESPACE } from "@ryot-app/i18n/message";
import {
	SANDBOX_LIMITS,
	sandboxContextBytes,
	sandboxContextError,
} from "@ryot-app/sandbox/protocol/limits";
import { assert } from "@ryot-app/testing/assert";
import { assertExitFails } from "@ryot-app/testing/effect-assertions";
import { randomUuid } from "@ryot-app/testing/random";
import { testTimeout } from "@ryot-app/testing/test-timeout";
import { layer } from "@voila.dev/effect-bun-test";
import { and, eq } from "drizzle-orm";
import { Context, DateTime, Effect, Layer, Option, Ref, Schema } from "effect";
import type { SecureRandom } from "effect/crypto";
import { TestClock } from "effect/testing";

import { noLifecycleWorkLayer } from "#modules/automations/lifecycle.test-support";
import { EntitiesRepository } from "#modules/entities/repository";
import { EventMutationsLive } from "#modules/events/layer";
import { EventMutations } from "#modules/events/mutations";
import { EventsRepository } from "#modules/events/repository";
import {
	installRevisionPackage,
	revisionDatabaseLayer,
	revisionPackage,
} from "#modules/plugins/packages/revision.test-support";
import { type ScriptCall, ScriptCalls } from "#modules/scripts/executions/calls";
import { FoldScriptsLive } from "#modules/scripts/executions/fold-scripts";
import { DatabaseSession } from "#platform/db/session";
import { WriteTransaction } from "#platform/db/write-transaction";
import { JobQueue } from "#platform/jobs/queue";
import { JobHandlers } from "#platform/jobs/worker";
import * as tables from "#schema/tables/combined";
import { makeAppConfigLayer } from "#testing/effect";

import { FoldJobsLive } from "./jobs";
import { FoldJob, FoldMarks } from "./marks";
import { type ApplyFoldChanges, type FoldMode, Folds, type FoldWriter } from "./service";

const userId = UserId.make("owner");

const authoredSchema = {
	fields: {
		value: { description: "Value", type: "string" as const, label: { key: "test.value" } },
	},
};

const propertiesSchema = {
	fields: {
		value: {
			description: "Value",
			type: "string" as const,
			label: { key: "test.value", namespace: KERNEL_NAMESPACE },
		},
	},
};

const eventSchemaName = { key: "test.changed", namespace: KERNEL_NAMESPACE };

/** A revision whose entity folds its `changed` events, each of which projects the value it carries. */
const foldedPackage = (packageId: PluginPackageId, version: string, scriptHash = "fold") => {
	const plugin = revisionPackage("folded", "v1", "folded-entity", packageId);
	const [entity] = plugin.manifest.entitySchemas;
	assert(entity);
	const manifest = {
		...plugin.manifest,
		entitySchemas: [
			{
				...entity,
				fold: { scriptSlug: "folded.task", eventSchemaSlugs: ["changed"] as const },
				eventSchemas: [
					{
						slug: "changed",
						name: { key: "test.changed" },
						propertiesSchema: authoredSchema,
						projection: { propertiesSchema: authoredSchema },
					},
				],
			},
		],
	};
	return {
		...plugin,
		manifest,
		contentHash: `folded-${version}`,
		scripts: plugin.scripts.map((script) =>
			script.slug === "folded.task"
				? Object.assign({}, script, { contentHash: scriptHash })
				: script,
		),
	};
};

const FoldCount = Schema.Struct({ runs: Schema.Int });

type Recorded = {
	readonly subjectEntityId: string;
	readonly changes: null | ReadonlyArray<FoldEventChange>;
};

/** The fold the current test installed; every script call runs it. */
class InstalledFold extends Context.Service<
	InstalledFold,
	Ref.Ref<ScriptCalls["Service"]["run"]>
>()("@ryot-app/kernel-backend/modules/derived-values/service.test/InstalledFold") {}

const installedFoldCalls = Layer.effect(
	ScriptCalls,
	Effect.map(InstalledFold, (installed) => ({
		run: (call: ScriptCall) => Effect.flatMap(Ref.get(installed), (run) => run(call)),
	})),
).pipe(
	Layer.provideMerge(
		Layer.effect(
			InstalledFold,
			Ref.make<ScriptCalls["Service"]["run"]>(() => Effect.die("No fold is installed")),
		),
	),
);

const testLayer = FoldJobsLive.pipe(
	Layer.provideMerge(Layer.mergeAll(Folds.layer, EventMutationsLive, JobHandlers.layer)),
	Layer.provideMerge(
		Layer.mergeAll(
			FoldScriptsLive,
			installedFoldCalls,
			EventsRepository.layer,
			EntitiesRepository.layer,
			FoldMarks.layer,
			JobQueue.layer,
			noLifecycleWorkLayer,
		),
	),
	Layer.provideMerge(Layer.merge(revisionDatabaseLayer, makeAppConfigLayer())),
);

/** Runs one attempt of the fold job for the subjects, as the job worker would. */
const runFoldJob = (entityIds: ReadonlyArray<EntityId>, attempt = 1) =>
	Effect.gen(function* () {
		const handler = (yield* JobHandlers).get("fold");
		assert(handler);
		return yield* handler.run({ userId, entityIds }, { attempt, id: "fold-job" });
	});

type Projected = { readonly eventId: string; readonly properties: { readonly value: unknown } };

type SubjectFold = (
	subject: FoldSubjectInput,
) => Effect.Effect<{
	readonly value: unknown;
	readonly refresh?: FoldRefresh;
	readonly events: ReadonlyArray<Projected>;
	readonly changes?: ReadonlyArray<unknown>;
}>;

/** Projects each changed event's value and counts its runs. */
const countingFold: SubjectFold = (subject) =>
	Effect.succeed({
		value: { runs: runsOf(subject) + 1 },
		events: (subject.changes ?? []).flatMap(({ after }): Array<Projected> =>
			after ? [{ eventId: after.id, properties: { value: after.properties["value"] } }] : [],
		),
	});

const runsOf = (subject: FoldSubjectInput) =>
	Option.match(Schema.decodeUnknownOption(FoldCount)(subject.value), {
		onNone: () => 0,
		onSome: ({ runs }) => runs,
	});

/**
 * Installs a fold over `count` new subjects, recording every run's subjects after checking that its
 * input fits the sandbox's bound for its principal.
 */
const setup = Effect.fn(function* (fold: SubjectFold = countingFold, count?: number) {
	const packageId = testPluginPackageId();
	const installed = yield* installRevisionPackage(foldedPackage(packageId, "v1"), userId);
	const runs: Array<ReadonlyArray<Recorded>> = [];
	const recorded: Array<Recorded> = [];
	yield* Ref.set(yield* InstalledFold, (call) =>
		Effect.gen(function* () {
			expect(
				sandboxContextError(call.input, sandboxContextBytes(call.principal.subject)),
			).toBeNull();
			const input = yield* Schema.decodeUnknownEffect(FoldInput)(call.input).pipe(Effect.orDie);
			const subjects = input.subjects.map(({ changes, subjectEntityId }) => ({
				changes,
				subjectEntityId,
			}));
			runs.push(subjects);
			recorded.push(...subjects);
			return {
				logs: [],
				error: null,
				status: "completed" as const,
				value: {
					subjects: yield* Effect.forEach(input.subjects, (subject) =>
						Effect.map(fold(subject), (output) => ({
							changes: [],
							relationships: [],
							...output,
							subjectEntityId: subject.subjectEntityId,
						})),
					),
				},
			};
		}),
	);
	const entities = yield* EntitiesRepository;
	const ids = yield* Effect.replicateEffect(
		Effect.map(randomUuid, (id) => EntityId.make(id)),
		count ?? 2,
	);
	const session = yield* DatabaseSession;
	yield* session.transaction(
		entities.insertEntities(
			ids.map((id) => ({
				id,
				userId,
				name: id,
				properties: {},
				populatedAt: null,
				scope: "user" as const,
				entitySchemaPluginId: installed.pluginId,
				entitySchemaSlug: EntitySchemaSlug.make("folded-entity"),
			})),
		),
	);
	const [first, second] = ids;
	assert(first !== undefined && second !== undefined);
	return { ids, runs, first, second, recorded, installed, packageId };
});

/** Commits `work` as an interactive write, which folds what it changed right after, or as a background one. */
const write = <A, E, R>(
	work: (transaction: WriteTransaction) => Effect.Effect<A, E, R>,
	mode: FoldMode = "eager",
) => Effect.flatMap(EventMutations, (mutations) => mutations.transaction(work, mode));

/** Writes fold results in transactions that queue what they change, applying fold changes with `apply`. */
const writer = (apply: ApplyFoldChanges) =>
	Effect.gen(function* () {
		const session = yield* DatabaseSession;
		const folds = yield* Folds;
		return {
			apply,
			commit: (work) =>
				session
					.transaction(
						Effect.gen(function* () {
							const transaction = new WriteTransaction();
							const value = yield* work(transaction);
							return { value, queued: yield* folds.queue(transaction, true) };
						}),
					)
					.pipe(Effect.catchTag("DatabaseSessionStateError", Effect.die)),
		} satisfies FoldWriter;
	});

/** Creates one `changed` event per item in one write. */
const createEvents = Effect.fn(function* (
	pluginId: Effect.Success<ReturnType<typeof setup>>["installed"]["pluginId"],
	items: ReadonlyArray<{ readonly value: string; readonly entityId: EntityId }>,
) {
	const events = yield* EventsRepository;
	const created = yield* Effect.forEach(items, (item) =>
		Effect.map(randomUuid, (id) => ({ ...item, id: EventId.make(id) })),
	);
	yield* write((transaction) =>
		events.createEvents(
			transaction,
			created.map(({ id, value, entityId }) => ({
				id,
				userId,
				entityId,
				eventSchemaName,
				propertiesSchema,
				properties: { value },
				eventSchemaPluginId: pluginId,
				eventSchemaSlug: EventSchemaSlug.make("changed"),
				occurredAt: DateTime.toDate(DateTime.makeUnsafe("2026-01-01T00:00:00.000Z")),
			})),
		),
	);
	return created;
});

const createChanged = (
	pluginId: Effect.Success<ReturnType<typeof setup>>["installed"]["pluginId"],
	entityId: EntityId,
	values: ReadonlyArray<string>,
) =>
	createEvents(
		pluginId,
		values.map((value) => ({ value, entityId })),
	);

const derived = (subject: string) =>
	Effect.flatMap(DatabaseSession, (session) =>
		session.run((db) =>
			db
				.select({
					kind: tables.derivedValue.kind,
					value: tables.derivedValue.value,
					targetId: tables.derivedValue.targetId,
				})
				.from(tables.derivedValue)
				.where(
					and(
						eq(tables.derivedValue.userId, userId),
						eq(tables.derivedValue.subjectEntityId, subject),
					),
				)
				.orderBy(tables.derivedValue.kind, tables.derivedValue.targetId),
		),
	);

const subjectValue = (subject: string) =>
	Effect.map(derived(subject), (rows) => rows.find(({ kind }) => kind === "subject")?.value);

const Listing = Schema.Struct({ values: Schema.Array(Schema.String) });

const valueOf = (image: FoldEventImage) => {
	const { value } = image.properties;
	assert(typeof value === "string");
	return value;
};

/**
 * Keeps the sorted values of a subject's events and projects each event's value: incrementally from its
 * changes, or by reading every event on a replay, so both reach the same outputs.
 */
const listingFold =
	(session: DatabaseSession["Service"]): SubjectFold =>
	(subject) =>
		Effect.gen(function* () {
			if (subject.changes === null) {
				const rows = yield* session
					.run((db) =>
						db
							.select({ id: tables.event.id, properties: tables.event.properties })
							.from(tables.event)
							.where(eq(tables.event.entityId, subject.subjectEntityId)),
					)
					.pipe(Effect.orDie);
				return {
					value: { values: rows.map((row) => String(row.properties["value"])).sort() },
					events: rows.map((row) => ({
						eventId: row.id,
						properties: { value: row.properties["value"] },
					})),
				};
			}
			const values = [
				...Option.match(Schema.decodeUnknownOption(Listing)(subject.value), {
					onNone: () => [],
					onSome: (listing) => listing.values,
				}),
			];
			for (const { before } of subject.changes) {
				if (before) {
					values.splice(values.indexOf(valueOf(before)), 1);
				}
			}
			for (const { after } of subject.changes) {
				if (after) {
					values.push(valueOf(after));
				}
			}
			return {
				value: { values: values.sort() },
				events: subject.changes.flatMap(({ after }) =>
					after ? [{ eventId: after.id, properties: { value: after.properties["value"] } }] : [],
				),
			};
		});

/** Changes an event's value, or deletes it with a null value, in the caller's write transaction. */
const changeValue = (
	transaction: WriteTransaction,
	pluginId: string,
	eventId: EventId,
	value: null | string,
) =>
	Effect.gen(function* () {
		const events = yield* EventsRepository;
		const current = yield* events.getEventSnapshot({ userId, eventId });
		assert(current);
		const { revision, snapshot } = current;
		if (value === null) {
			yield* events.deletePreparedEvent(transaction, {
				userId,
				eventId,
				expectedRevision: revision,
			});
			return;
		}
		yield* events.updatePreparedEvent(transaction, {
			userId,
			eventId,
			propertiesSchema,
			expectedRevision: revision,
			updatedAt: yield* DateTime.nowAsDate,
			draft: {
				sessionEntityId: null,
				properties: { value },
				entityId: snapshot.entityId,
				occurredAt: snapshot.occurredAt,
				eventSchemaPluginId: PluginId.make(pluginId),
				entitySchemaPluginId: PluginId.make(pluginId),
				eventSchemaSlug: EventSchemaSlug.make("changed"),
				entitySchemaSlug: EntitySchemaSlug.make("folded-entity"),
			},
		});
	});

const createValues = (
	transaction: WriteTransaction,
	pluginId: string,
	entityId: EntityId,
	values: ReadonlyArray<string>,
) =>
	Effect.gen(function* () {
		const events = yield* EventsRepository;
		const ids = yield* Effect.forEach(values, () =>
			Effect.map(randomUuid, (id) => EventId.make(id)),
		);
		yield* events.createEvents(
			transaction,
			values.map((value, index) => ({
				userId,
				entityId,
				eventSchemaName,
				propertiesSchema,
				properties: { value },
				eventSchemaPluginId: pluginId,
				id: ids[index] ?? EventId.make(value),
				eventSchemaSlug: EventSchemaSlug.make("changed"),
				occurredAt: DateTime.toDate(DateTime.makeUnsafe("2026-01-01T00:00:00.000Z")),
			})),
		);
		return ids;
	});

/** A background-lane write: its folds are queued as fold jobs. */
const background = <A, E, R>(work: (transaction: WriteTransaction) => Effect.Effect<A, E, R>) =>
	write(work, "queue");

const subjectState = (entityId: EntityId) =>
	Effect.flatMap(DatabaseSession, (session) =>
		session.run((db) =>
			db
				.select({ status: tables.derivedValue.status, replay: tables.derivedValue.replay })
				.from(tables.derivedValue)
				.where(
					and(
						eq(tables.derivedValue.userId, userId),
						eq(tables.derivedValue.kind, "subject"),
						eq(tables.derivedValue.targetId, entityId),
					),
				),
		),
	);

const storedChanges = (entityId: EntityId) =>
	Effect.flatMap(DatabaseSession, (session) =>
		session.run((db) =>
			db
				.select({ eventId: tables.derivedChange.eventId })
				.from(tables.derivedChange)
				.where(eq(tables.derivedChange.subjectEntityId, entityId)),
		),
	);

const foldJobs = (entityIds: ReadonlyArray<EntityId>) =>
	Effect.flatMap(DatabaseSession, (session) =>
		session.run((db) =>
			db
				.select({ id: tables.job.id, runAt: tables.job.runAt })
				.from(tables.job)
				.where(
					and(eq(tables.job.kind, "fold"), eq(tables.job.key, `${userId}:${entityIds.join(",")}`)),
				),
		),
	);

const refreshOf = (entityId: EntityId) =>
	Effect.flatMap(DatabaseSession, (session) =>
		session.run((db) =>
			db.execute<{ on: null | string; at: null | string }>(
				`select refresh_on::text as on, to_char(refresh_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as at
				from derived_value where user_id = '${userId}' and kind = 'subject' and target_id = '${entityId}'`,
				"objects",
			),
		),
	);

const setReportingTimeZone = (timeZone: string) =>
	Effect.flatMap(DatabaseSession, (session) =>
		session.run((db) =>
			db.execute(
				`update "user" set preferences = preferences || '{"reportingTimeZone": "${timeZone}"}' where id = '${userId}'`,
			),
		),
	);

/** Queued fold jobs in the order the job worker claims them. */
const claimOrder = Effect.flatMap(DatabaseSession, (session) =>
	session.run((db) =>
		db.execute<{ key: string; priority: number }>(
			`select key, priority from job where kind = 'fold' and status = 'queued' order by priority, run_at, id`,
			"objects",
		),
	),
);

/** A change list as values and revisions, which do not depend on the subject it was recorded for. */
const changeShape = (changes: null | undefined | ReadonlyArray<FoldEventChange>) =>
	(changes ?? [])
		.map(({ after, before }) => [
			before ? valueOf(before) : null,
			after ? valueOf(after) : null,
			before?.revision ?? null,
			after?.revision ?? null,
		])
		.sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));

layer(testLayer)((test) => {
	test.effect(
		"replays a new subject, then passes before and after images and applies outputs as a patch",
		() =>
			Effect.scoped(
				Effect.gen(function* () {
					const { first, second, recorded, installed } = yield* setup();
					const events = yield* EventsRepository;
					const create =
						(eventId: EventId, entityId: EntityId, value: string) =>
						(transaction: WriteTransaction) =>
							events.createEvents(transaction, [
								{
									userId,
									entityId,
									id: eventId,
									eventSchemaName,
									propertiesSchema,
									properties: { value },
									eventSchemaPluginId: installed.pluginId,
									eventSchemaSlug: EventSchemaSlug.make("changed"),
									occurredAt: DateTime.toDate(DateTime.makeUnsafe("2026-01-01T00:00:00.000Z")),
								},
							]);
					const kept = EventId.make(yield* randomUuid);
					const moved = EventId.make(yield* randomUuid);
					yield* write(create(kept, first, "kept"));
					expect(recorded.at(-1)).toEqual({ changes: null, subjectEntityId: first });
					yield* write(create(moved, first, "moved"));
					expect(recorded.at(-1)?.changes).toMatchObject([
						{ before: null, after: { id: moved, entityId: first, properties: { value: "moved" } } },
					]);
					expect(yield* derived(first)).toEqual([
						{ kind: "event", targetId: moved, value: { value: "moved" } },
						{ kind: "subject", targetId: first, value: { runs: 2 } },
					]);
					const updatedAt = yield* DateTime.nowAsDate;
					yield* write((transaction) =>
						events.updatePreparedEvent(transaction, {
							userId,
							updatedAt,
							eventId: moved,
							propertiesSchema,
							expectedRevision: 0,
							draft: {
								entityId: second,
								sessionEntityId: null,
								properties: { value: "arrived" },
								eventSchemaSlug: EventSchemaSlug.make("changed"),
								eventSchemaPluginId: PluginId.make(installed.pluginId),
								entitySchemaPluginId: PluginId.make(installed.pluginId),
								entitySchemaSlug: EntitySchemaSlug.make("folded-entity"),
								occurredAt: IsoUtcString.make("2026-01-02T00:00:00.000Z"),
							},
						}),
					);
					const runs = recorded.slice(-2);
					expect(
						runs.find(({ subjectEntityId }) => subjectEntityId === second)?.changes,
					).toBeNull();
					expect(
						runs.find(({ subjectEntityId }) => subjectEntityId === first)?.changes,
					).toMatchObject([{ after: null, before: { id: moved, properties: { value: "moved" } } }]);
					expect(yield* derived(first)).toEqual([
						{ kind: "subject", targetId: first, value: { runs: 3 } },
					]);
					yield* write((transaction) => events.deleteEvent(transaction, { userId, eventId: kept }));
					expect(recorded.at(-1)?.changes).toMatchObject([
						{ after: null, before: { id: kept, properties: { value: "kept" } } },
					]);
				}),
			),
		testTimeout,
	);

	test.effect(
		"queues a replay after an install only when the fold's script or event schemas change",
		() =>
			Effect.scoped(
				Effect.gen(function* () {
					const { first, installed, packageId } = yield* setup();
					const events = yield* EventsRepository;
					const eventId = EventId.make(yield* randomUuid);
					yield* write((transaction) =>
						events.createEvents(transaction, [
							{
								userId,
								id: eventId,
								eventSchemaName,
								entityId: first,
								propertiesSchema,
								properties: { value: "one" },
								eventSchemaPluginId: installed.pluginId,
								eventSchemaSlug: EventSchemaSlug.make("changed"),
								occurredAt: DateTime.toDate(DateTime.makeUnsafe("2026-01-01T00:00:00.000Z")),
							},
						]),
					);
					const session = yield* DatabaseSession;
					const marks = yield* FoldMarks;
					const replays = session.run((db) =>
						db
							.select({ id: tables.job.id })
							.from(tables.job)
							.where(eq(tables.job.kind, "fold-rebuild")),
					);
					const revisionOf = session.run((db) =>
						db
							.selectDistinct({ id: tables.derivedValue.pluginRevisionId })
							.from(tables.derivedValue)
							.where(eq(tables.derivedValue.subjectEntityId, first)),
					);
					const reinstall = (version: string, scriptHash: string) =>
						Effect.gen(function* () {
							const next = yield* installRevisionPackage(
								foldedPackage(packageId, version, scriptHash),
								userId,
							);
							yield* session
								.transaction(
									marks.queueRevisionReplay({ userId, pluginId: PluginId.make(next.pluginId) }),
								)
								.pipe(Effect.catchTag("DatabaseSessionStateError", Effect.die));
							return next;
						});
					const same = yield* reinstall("v2", "fold");
					expect(yield* replays).toEqual([]);
					expect(yield* revisionOf).toEqual([{ id: same.revisionId }]);
					yield* reinstall("v3", "changed-fold");
					expect(yield* replays).toHaveLength(1);
				}),
			),
		testTimeout,
	);

	test.effect(
		"passes back a stored value larger than the general script context, incrementally and on replay",
		() =>
			Effect.scoped(
				Effect.gen(function* () {
					const pad = "x".repeat(SANDBOX_LIMITS.execution.contextBytes);
					const { first, recorded, installed } = yield* setup((subject) =>
						Effect.map(countingFold(subject), (output) => ({
							...output,
							value: { pad, runs: runsOf(subject) + 1 },
						})),
					);
					yield* createChanged(installed.pluginId, first, ["one"]);
					yield* createChanged(installed.pluginId, first, ["two"]);
					yield* (yield* Folds).failed(userId, [first]);
					yield* createChanged(installed.pluginId, first, ["three"]);
					expect(recorded.map(({ changes }) => changes?.length ?? null)).toEqual([null, 1, null]);
					expect(yield* subjectValue(first)).toEqual({ pad, runs: 3 });
				}),
			),
		testTimeout,
	);

	test.effect(
		"degrades a change list that does not fit the fold input to a full replay with the same outputs",
		() =>
			Effect.scoped(
				Effect.gen(function* () {
					const session = yield* DatabaseSession;
					const { first, recorded, installed } = yield* setup((subject) =>
						Effect.gen(function* () {
							const output = yield* countingFold(subject);
							if (subject.changes !== null) {
								return output;
							}
							const rows = yield* session
								.run((db) =>
									db
										.select({ id: tables.event.id, properties: tables.event.properties })
										.from(tables.event)
										.where(eq(tables.event.entityId, subject.subjectEntityId)),
								)
								.pipe(Effect.orDie);
							return {
								...output,
								events: rows.map((row) => ({
									eventId: row.id,
									properties: { value: row.properties["value"] },
								})),
							};
						}),
					);
					const kept = yield* createChanged(installed.pluginId, first, ["kept"]);
					const bulk = yield* createChanged(
						installed.pluginId,
						first,
						Array.from({ length: 300 }, (_, index) => `${index}`.padEnd(4 * 1024, "x")),
					);
					expect(recorded.at(-1)?.changes).toBeNull();
					expect(
						Object.fromEntries(
							(yield* derived(first)).flatMap((row) =>
								row.kind === "event" ? [[row.targetId, row.value]] : [],
							),
						),
					).toEqual(Object.fromEntries([...kept, ...bulk].map(({ id, value }) => [id, { value }])));
					yield* createChanged(installed.pluginId, first, ["after"]);
					expect(recorded.at(-1)?.changes).toHaveLength(1);
				}),
			),
		testTimeout,
	);

	test.effect(
		"folds every subject a write changes in one run",
		() =>
			Effect.scoped(
				Effect.gen(function* () {
					const { ids, runs, installed } = yield* setup(countingFold, 3);
					yield* createEvents(
						installed.pluginId,
						ids.map((entityId) => ({ entityId, value: "one" })),
					);
					yield* createEvents(
						installed.pluginId,
						ids.map((entityId) => ({ entityId, value: "two" })),
					);
					expect(runs.map((run) => run.map(({ changes }) => changes?.length ?? null))).toEqual([
						[null, null, null],
						[1, 1, 1],
					]);
					expect(runs[1]?.map(({ subjectEntityId }) => subjectEntityId)).toEqual([...ids].sort());
				}),
			),
		testTimeout,
	);

	test.effect(
		"splits subjects that exceed the input bound together into the fewest runs that fit",
		() =>
			Effect.scoped(
				Effect.gen(function* () {
					const pad = "x".repeat(200 * 1024);
					const { ids, runs, installed } = yield* setup(
						(subject) =>
							Effect.map(countingFold(subject), (output) => ({
								...output,
								value: { pad, runs: runsOf(subject) + 1 },
							})),
						6,
					);
					yield* createEvents(
						installed.pluginId,
						ids.map((entityId) => ({ entityId, value: "one" })),
					);
					yield* createEvents(
						installed.pluginId,
						ids.map((entityId) => ({ entityId, value: "two" })),
					);
					expect(runs.map((run) => run.length)).toEqual([6, 5, 1]);
					expect(
						runs
							.slice(1)
							.flat()
							.map(({ changes }) => changes?.length),
					).toEqual(ids.map(() => 1));
				}),
			),
		testTimeout,
	);

	test.effect(
		"keeps a write whose fold fails validation and leaves every subject of the run pending for its job",
		() =>
			Effect.scoped(
				Effect.gen(function* () {
					const invalid = new Set<string>();
					const { first, second, installed } = yield* setup((subject) =>
						Effect.map(countingFold(subject), (output) =>
							invalid.has(subject.subjectEntityId)
								? {
										...output,
										events: output.events.map(({ eventId }) => ({
											eventId,
											properties: { value: 5 },
										})),
									}
								: output,
						),
					);
					const both = (value: string) => [
						{ value, entityId: first },
						{ value, entityId: second },
					];
					yield* createEvents(installed.pluginId, both("one"));
					invalid.add(second);
					const events = yield* EventsRepository;
					for (const { id } of yield* createEvents(installed.pluginId, both("two"))) {
						expect(yield* events.getEventSnapshot({ userId, eventId: id })).not.toBeNull();
					}
					expect(yield* derived(first)).toEqual([
						{ kind: "subject", targetId: first, value: { runs: 1 } },
					]);
					const pending = [{ replay: false, status: "pending" as const }];
					expect(yield* subjectState(first)).toEqual(pending);
					expect(yield* subjectState(second)).toEqual(pending);
					expect(yield* foldJobs([first, second].sort())).toHaveLength(1);
				}),
			),
		testTimeout,
	);

	test.effect(
		"applies the changes a run asks for and folds every subject they changed in one further run",
		() =>
			Effect.scoped(
				Effect.gen(function* () {
					const eventId = EventId.make(yield* randomUuid);
					const { ids, runs } = yield* setup(
						(subject) =>
							Effect.map(countingFold(subject), (output) => ({
								...output,
								changes:
									runsOf(subject) === 0
										? [{ eventId, kind: "delete", itemIdentity: subject.subjectEntityId }]
										: [],
							})),
						3,
					);
					const marks = yield* FoldMarks;
					const sorted = [...ids].sort();
					yield* background((transaction) =>
						marks.markSubjects(
							transaction,
							sorted.map((entityId) => ({ userId, entityId })),
						),
					);
					const applied: Array<string> = [];
					const written = yield* (yield* Folds).fold(
						{ userId, entityIds: sorted, lane: "interactive" },
						yield* writer((transaction, input) => {
							const subjects = input.changes.map((change) => change.itemIdentity);
							applied.push(...subjects);
							return marks.markSubjects(
								transaction,
								subjects.map((entityId) => ({ userId, entityId: EntityId.make(entityId) })),
							);
						}),
					);
					expect(written).toBe(true);
					expect(runs.map((run) => run.map(({ subjectEntityId }) => subjectEntityId))).toEqual([
						sorted,
						sorted,
					]);
					expect(applied.sort()).toEqual(sorted);
				}),
			),
		testTimeout,
	);

	test.effect(
		"marks a subject failed when it asks for changes again after the same fold wrote it",
		() =>
			Effect.scoped(
				Effect.gen(function* () {
					const eventId = EventId.make(yield* randomUuid);
					const { runs, first } = yield* setup((subject) =>
						Effect.map(countingFold(subject), (output) => ({
							...output,
							changes: [{ eventId, kind: "delete", itemIdentity: subject.subjectEntityId }],
						})),
					);
					const marks = yield* FoldMarks;
					const refold = (transaction: WriteTransaction) =>
						marks.markSubjects(transaction, [{ userId, entityId: first }]);
					yield* background(refold);
					assertExitFails(
						yield* Effect.exit(
							(yield* Folds).fold(
								{ userId, lane: "background", entityIds: [first] },
								yield* writer(refold),
							),
						),
						new DbError({ message: "Fold kept changing its own events" }),
					);
					expect(runs).toHaveLength(2);
					expect(yield* subjectValue(first)).toEqual({ runs: 1 });
					expect(yield* subjectState(first)).toEqual([{ replay: true, status: "failed" }]);
				}),
			),
		testTimeout,
	);

	test.effect(
		"queues a rebuild's subjects as one fold job whose replay folds them in one run",
		() =>
			Effect.scoped(
				Effect.gen(function* () {
					const { ids, runs, installed } = yield* setup(countingFold, 3);
					yield* createEvents(
						installed.pluginId,
						ids.map((entityId) => ({ entityId, value: "one" })),
					);
					yield* (yield* Folds.make).rebuild({
						userId,
						pluginId: PluginId.make(installed.pluginId),
					});
					const sorted = [...ids].sort();
					const session = yield* DatabaseSession;
					expect(
						yield* session.run((db) =>
							db
								.select({ payload: tables.job.payload })
								.from(tables.job)
								.where(
									and(
										eq(tables.job.kind, "fold"),
										eq(tables.job.key, `${userId}:${sorted.join(",")}`),
									),
								),
						),
					).toEqual([{ payload: { userId, entityIds: sorted } }]);
					yield* runFoldJob(sorted);
					expect(runs.at(-1)).toEqual(
						sorted.map((subjectEntityId) => ({ changes: null, subjectEntityId })),
					);
				}),
			),
		testTimeout,
	);

	test.effect(
		"folds a background write's job from its change list, as a full replay would",
		() =>
			Effect.scoped(
				Effect.gen(function* () {
					const session = yield* DatabaseSession;
					const { first, recorded, installed } = yield* setup(listingFold(session));
					const { pluginId } = installed;
					const [, changed, removed] = yield* write((transaction) =>
						createValues(transaction, pluginId, first, ["kept", "changed", "removed"]),
					);
					assert(changed && removed);
					yield* background((transaction) =>
						Effect.gen(function* () {
							yield* changeValue(transaction, pluginId, changed, "edited");
							yield* changeValue(transaction, pluginId, removed, null);
						}),
					);
					yield* background((transaction) => createValues(transaction, pluginId, first, ["added"]));
					expect(yield* foldJobs([first])).toHaveLength(1);
					expect(yield* subjectState(first)).toEqual([{ replay: false, status: "pending" }]);
					yield* runFoldJob([first]);
					expect(changeShape(recorded.at(-1)?.changes)).toEqual([
						["changed", "edited", 0, 1],
						["removed", null, 0, null],
						[null, "added", null, 0],
					]);
					expect(yield* storedChanges(first)).toEqual([]);
					expect(yield* subjectState(first)).toEqual([{ replay: false, status: "ready" }]);
					const incremental = yield* derived(first);
					const marks = yield* FoldMarks;
					yield* write((transaction) =>
						marks.markSubjects(transaction, [{ userId, entityId: first }]),
					);
					expect(recorded.at(-1)?.changes).toBeNull();
					expect(yield* derived(first)).toEqual(incremental);
					expect(incremental.find(({ kind }) => kind === "subject")?.value).toEqual({
						values: ["added", "edited", "kept"],
					});
				}),
			),
		testTimeout,
	);

	test.effect(
		"coalesces background writes to a subject into one job whose change list is one commit's",
		() =>
			Effect.scoped(
				Effect.gen(function* () {
					const session = yield* DatabaseSession;
					const { first, second, recorded, installed } = yield* setup(listingFold(session));
					const { pluginId } = installed;
					const seeded = yield* Effect.forEach([first, second], (entityId) =>
						write((transaction) => createValues(transaction, pluginId, entityId, ["a", "b"])),
					);
					const writes = ([a, b]: ReadonlyArray<EventId>, entityId: EntityId) => {
						assert(a && b);
						return [
							(transaction: WriteTransaction) =>
								Effect.gen(function* () {
									yield* changeValue(transaction, pluginId, a, "a2");
									yield* createValues(transaction, pluginId, entityId, ["c"]);
								}),
							(transaction: WriteTransaction) =>
								Effect.gen(function* () {
									yield* changeValue(transaction, pluginId, a, "a3");
									yield* changeValue(transaction, pluginId, b, null);
								}),
						] as const;
					};
					const [firstIds = [], secondIds = []] = seeded;
					const [one, two] = writes(firstIds, first);
					yield* background(one);
					yield* background(two);
					const [inlineOne, inlineTwo] = writes(secondIds, second);
					yield* write((transaction) =>
						Effect.andThen(inlineOne(transaction), inlineTwo(transaction)),
					);
					const committed = recorded.at(-1);
					expect(committed?.subjectEntityId).toBe(second);
					expect(yield* foldJobs([first])).toHaveLength(1);
					yield* runFoldJob([first]);
					const job = recorded.at(-1);
					expect(job?.subjectEntityId).toBe(first);
					expect(changeShape(job?.changes)).toEqual(changeShape(committed?.changes));
					expect(changeShape(job?.changes)).toEqual([
						["a", "a3", 0, 2],
						["b", null, 0, null],
						[null, "c", null, 0],
					]);
					expect(yield* subjectValue(first)).toEqual(yield* subjectValue(second));
				}),
			),
		testTimeout,
	);

	test.effect(
		"folds an interactive write's subjects before it returns and leaves their delayed job nothing to do",
		() =>
			Effect.scoped(
				Effect.gen(function* () {
					const { runs, first, installed } = yield* setup();
					const before = yield* DateTime.nowAsDate;
					yield* createChanged(installed.pluginId, first, ["one"]);
					expect(runs).toHaveLength(1);
					expect(yield* subjectState(first)).toEqual([{ replay: false, status: "ready" }]);
					const [job] = yield* foldJobs([first]);
					assert(job);
					expect(job.runAt.getTime()).toBeGreaterThan(before.getTime());
					yield* runFoldJob([first]);
					expect(runs).toHaveLength(1);
				}),
			),
		testTimeout,
	);

	test.effect(
		"writes a fold's result when a write lands during its run, keeps the changes it did not read and replays next",
		() =>
			Effect.scoped(
				Effect.gen(function* () {
					const session = yield* DatabaseSession;
					const listing = listingFold(session);
					const during = yield* Ref.make<Effect.Effect<void>>(Effect.void);
					const { first, recorded, installed } = yield* setup((subject) =>
						Effect.andThen(Effect.flatten(Ref.getAndSet(during, Effect.void)), listing(subject)),
					);
					const { pluginId } = installed;
					const services = yield* Effect.context<
						EventMutations | EventsRepository | SecureRandom.SecureRandom
					>();
					const [, two] = yield* write((transaction) =>
						createValues(transaction, pluginId, first, ["one", "two"]),
					);
					assert(two);
					yield* background((transaction) => changeValue(transaction, pluginId, two, "two-b"));
					yield* Ref.set(
						during,
						background((transaction) =>
							Effect.andThen(
								changeValue(transaction, pluginId, two, "two-c"),
								createValues(transaction, pluginId, first, ["three"]),
							),
						).pipe(Effect.asVoid, Effect.provideContext(services), Effect.orDie),
					);
					yield* runFoldJob([first]);
					expect(changeShape(recorded.at(-1)?.changes)).toEqual([["two", "two-b", 0, 1]]);
					expect(yield* subjectValue(first)).toEqual({ values: ["one", "two-b"] });
					expect(yield* subjectState(first)).toEqual([{ replay: true, status: "pending" }]);
					expect(yield* storedChanges(first)).toHaveLength(2);
					yield* runFoldJob([first]);
					expect(recorded.at(-1)?.changes).toBeNull();
					expect(yield* subjectValue(first)).toEqual({ values: ["one", "three", "two-c"] });
					expect(yield* subjectState(first)).toEqual([{ replay: false, status: "ready" }]);
					expect(yield* storedChanges(first)).toEqual([]);
				}),
			),
		testTimeout,
	);

	test.effect(
		"lets a subject ask for changes again when another write marked it after the fold wrote it",
		() =>
			Effect.scoped(
				Effect.gen(function* () {
					const eventId = EventId.make(yield* randomUuid);
					const { runs, first, installed } = yield* setup((subject) =>
						Effect.map(countingFold(subject), (output) => ({
							...output,
							changes: (subject.changes ?? []).some(
								({ after }) => after?.properties["value"] === "trigger",
							)
								? [{ eventId, kind: "delete", itemIdentity: subject.subjectEntityId }]
								: [],
						})),
					);
					const { pluginId } = installed;
					const services = yield* Effect.context<
						EventMutations | EventsRepository | SecureRandom.SecureRandom
					>();
					const marks = yield* FoldMarks;
					yield* write((transaction) => createValues(transaction, pluginId, first, ["one"]));
					yield* background((transaction) =>
						createValues(transaction, pluginId, first, ["trigger"]),
					);
					const refold = yield* writer((transaction) =>
						marks.markRefolds(transaction, [{ userId, entityId: first }]),
					);
					const interfering = yield* Ref.make(true);
					const interfered: FoldWriter = {
						...refold,
						commit: (work) =>
							Effect.tap(refold.commit(work), () =>
								Effect.flatMap(Ref.getAndSet(interfering, false), (interfere) =>
									interfere
										? background((transaction) =>
												createValues(transaction, pluginId, first, ["trigger"]),
											).pipe(Effect.asVoid, Effect.provideContext(services), Effect.orDie)
										: Effect.void,
								),
							),
					};
					const folded = runs.length;
					expect(
						yield* (yield* Folds).fold(
							{ userId, lane: "background", entityIds: [first] },
							interfered,
						),
					).toBe(true);
					expect(runs).toHaveLength(folded + 3);
					expect(yield* subjectState(first)).toEqual([{ replay: false, status: "ready" }]);
				}),
			),
		testTimeout,
	);

	test.effect(
		"lets one of two folds that read a subject together write it and reruns the other from the new state",
		() =>
			Effect.scoped(
				Effect.gen(function* () {
					const session = yield* DatabaseSession;
					const listing = listingFold(session);
					const during = yield* Ref.make<Effect.Effect<void>>(Effect.void);
					const { runs, first, installed } = yield* setup((subject) =>
						Effect.andThen(Effect.flatten(Ref.getAndSet(during, Effect.void)), listing(subject)),
					);
					const { pluginId } = installed;
					const services = yield* Effect.context<
						EventMutations | EventsRepository | SecureRandom.SecureRandom
					>();
					yield* write((transaction) => createValues(transaction, pluginId, first, ["one"]));
					yield* background((transaction) => createValues(transaction, pluginId, first, ["two"]));
					yield* Ref.set(
						during,
						write((transaction) => createValues(transaction, pluginId, first, ["three"])).pipe(
							Effect.asVoid,
							Effect.provideContext(services),
							Effect.orDie,
						),
					);
					const folded = runs.length;
					yield* runFoldJob([first]);
					expect(runs).toHaveLength(folded + 2);
					expect(yield* subjectValue(first)).toEqual({ values: ["one", "three", "two"] });
					expect(yield* subjectState(first)).toEqual([{ replay: false, status: "ready" }]);
					expect(yield* storedChanges(first)).toEqual([]);
				}),
			),
		testTimeout,
	);

	test.effect(
		"queues each subject of a failed job alone, keeping each one's pending or failed status",
		() =>
			Effect.scoped(
				Effect.gen(function* () {
					const invalid = new Set<string>();
					const { first, second, installed } = yield* setup((subject) =>
						Effect.map(countingFold(subject), (output) =>
							invalid.has(subject.subjectEntityId)
								? {
										...output,
										events: output.events.map(({ eventId }) => ({
											eventId,
											properties: { value: 5 },
										})),
									}
								: output,
						),
					);
					const both = (value: string) => [
						{ value, entityId: first },
						{ value, entityId: second },
					];
					yield* createEvents(installed.pluginId, both("one"));
					invalid.add(second);
					const events = yield* EventsRepository;
					yield* background((transaction) =>
						Effect.gen(function* () {
							for (const { value, entityId } of both("two")) {
								yield* events.createEvents(transaction, [
									{
										userId,
										entityId,
										eventSchemaName,
										propertiesSchema,
										properties: { value },
										id: EventId.make(yield* randomUuid),
										eventSchemaPluginId: installed.pluginId,
										eventSchemaSlug: EventSchemaSlug.make("changed"),
										occurredAt: DateTime.toDate(DateTime.makeUnsafe("2026-01-01T00:00:00.000Z")),
									},
								]);
							}
						}),
					);
					const sorted = [first, second].sort();
					expect(yield* foldJobs(sorted)).toHaveLength(1);
					yield* runFoldJob(sorted);
					expect(yield* foldJobs([first])).toHaveLength(1);
					expect(yield* foldJobs([second])).toHaveLength(1);
					const pending = [{ replay: false, status: "pending" as const }];
					expect(yield* subjectState(first)).toEqual(pending);
					expect(yield* subjectState(second)).toEqual(pending);
					yield* runFoldJob([first]);
					expect(yield* subjectState(first)).toEqual([{ replay: false, status: "ready" }]);
					expect(yield* Effect.exit(runFoldJob([second]))).toMatchObject({ _tag: "Failure" });
					expect(yield* subjectState(second)).toEqual(pending);
					expect(yield* Effect.exit(runFoldJob([second], FoldJob.maxAttempts))).toMatchObject({
						_tag: "Failure",
					});
					expect(yield* subjectState(second)).toEqual([{ replay: true, status: "failed" }]);
					expect(yield* subjectState(first)).toEqual([{ replay: false, status: "ready" }]);
				}),
			),
		testTimeout,
	);
});

layer(testLayer)((test) => {
	test.effect(
		"stores a fold's refresh time in the user's reporting time zone and resolves it again in a new one",
		() =>
			Effect.gen(function* () {
				const refreshes = new Map<string, FoldRefresh>();
				const { first, second, installed } = yield* setup((subject) =>
					Effect.map(countingFold(subject), (output) => {
						const refresh = refreshes.get(subject.subjectEntityId);
						return refresh === undefined ? output : { ...output, refresh };
					}),
				);
				refreshes.set(first, { date: "2026-12-01" });
				refreshes.set(second, { instant: "2026-12-01T10:00:00.000Z" });
				yield* setReportingTimeZone("Asia/Kolkata");
				yield* createEvents(installed.pluginId, [
					{ value: "one", entityId: first },
					{ value: "two", entityId: second },
				]);
				expect(yield* refreshOf(first)).toEqual([
					{ on: "2026-12-01", at: "2026-11-30T18:30:00.000Z" },
				]);
				expect(yield* refreshOf(second)).toEqual([{ on: null, at: "2026-12-01T10:00:00.000Z" }]);

				const session = yield* DatabaseSession;
				const marks = yield* FoldMarks;
				yield* setReportingTimeZone("America/New_York");
				yield* session.transaction(
					marks.resolveRefreshes(userId, TimeZone.make("America/New_York")),
				);
				expect(yield* refreshOf(first)).toEqual([
					{ on: "2026-12-01", at: "2026-12-01T05:00:00.000Z" },
				]);
				expect(yield* refreshOf(second)).toEqual([{ on: null, at: "2026-12-01T10:00:00.000Z" }]);

				refreshes.delete(first);
				yield* createEvents(installed.pluginId, [{ value: "three", entityId: first }]);
				expect(yield* refreshOf(first)).toEqual([{ on: null, at: null }]);
			}),
		testTimeout,
	);
});

layer(testLayer)((test) => {
	test.effect(
		"queues the folds of subjects whose refresh time passed ahead of other fold jobs, with no change",
		() =>
			Effect.gen(function* () {
				const refreshed = new Set<string>();
				const { first, second, recorded, installed } = yield* setup((subject) =>
					Effect.map(countingFold(subject), (output) =>
						refreshed.has(subject.subjectEntityId) &&
						(subject.changes === null || subject.changes.length > 0)
							? { ...output, refresh: { instant: "1970-01-01T01:00:00.000Z" } }
							: output,
					),
				);
				refreshed.add(first);
				yield* createEvents(installed.pluginId, [
					{ value: "one", entityId: first },
					{ value: "one", entityId: second },
				]);
				const session = yield* DatabaseSession;
				const marks = yield* FoldMarks;
				const queue = session.transaction(marks.queueRefreshes(10));
				yield* TestClock.setTime(Date.parse("1970-01-01T00:59:59.999Z"));
				expect(yield* queue).toBe(0);

				yield* background((transaction) =>
					createValues(transaction, installed.pluginId, second, ["two"]),
				);
				yield* TestClock.setTime(Date.parse("1970-01-01T01:00:00.000Z"));
				expect(yield* queue).toBe(1);
				expect(yield* queue).toBe(0);
				expect(yield* refreshOf(first)).toEqual([{ on: null, at: null }]);
				expect(yield* subjectState(first)).toEqual([{ replay: false, status: "pending" }]);
				const [refresh, ...queued] = yield* claimOrder;
				expect(refresh).toEqual({ priority: 0, key: `${userId}:${first}` });
				expect(queued).toContainEqual({ priority: 1, key: `${userId}:${second}` });
				expect(queued.map(({ priority }) => priority)).toEqual(queued.map(() => 1));

				recorded.length = 0;
				yield* runFoldJob([first]);
				expect(recorded).toEqual([{ changes: [], subjectEntityId: first }]);
				expect(yield* subjectState(first)).toEqual([{ replay: false, status: "ready" }]);
				expect(yield* refreshOf(first)).toEqual([{ on: null, at: null }]);
				expect(yield* subjectValue(first)).toEqual({ runs: 2 });
			}),
		testTimeout,
	);

	test.effect(
		"refreshes the entities of a fold request with no change, and replays them on request, for every user who folded them",
		() =>
			Effect.gen(function* () {
				const { first, recorded, installed } = yield* setup();
				yield* createEvents(installed.pluginId, [{ value: "one", entityId: first }]);
				const session = yield* DatabaseSession;
				const marks = yield* FoldMarks;
				const request = (mode: "replay" | "refresh") =>
					session.transaction(
						marks.request(
							{
								mode,
								userId: null,
								entityIds: [first],
								pluginId: PluginId.make(installed.pluginId),
							},
							new WriteTransaction(),
						),
					);
				recorded.length = 0;
				yield* request("refresh");
				yield* runFoldJob([first]);
				yield* request("replay");
				yield* runFoldJob([first]);
				expect(recorded).toEqual([
					{ changes: [], subjectEntityId: first },
					{ changes: null, subjectEntityId: first },
				]);
			}),
		testTimeout,
	);
});
