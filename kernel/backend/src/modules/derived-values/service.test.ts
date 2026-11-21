import { expect } from "bun:test";

import { DbError } from "@ryot-app/contract/errors";
import {
	type FoldEventChange,
	FoldInput,
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

import { EntitiesRepository } from "#modules/entities/repository";
import { EventsRepository } from "#modules/events/repository";
import {
	installRevisionPackage,
	revisionDatabaseLayer,
	revisionPackage,
} from "#modules/plugins/packages/revision.test-support";
import { type ScriptCall, ScriptCalls } from "#modules/scripts/executions/calls";
import { FoldScriptsLive } from "#modules/scripts/executions/fold-scripts";
import { DatabaseSession } from "#platform/db/session";
import { JobQueue } from "#platform/jobs/queue";
import * as tables from "#schema/tables/combined";

import { FoldMarks } from "./marks";
import { type ApplyFoldChanges, type FoldMode, Folds } from "./service";

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

const testLayer = Layer.mergeAll(
	FoldScriptsLive,
	installedFoldCalls,
	EventsRepository.layer,
	EntitiesRepository.layer,
	FoldMarks.layer,
	JobQueue.layer,
).pipe(Layer.provideMerge(revisionDatabaseLayer));

type Projected = { readonly eventId: string; readonly properties: { readonly value: unknown } };

type SubjectFold = (
	subject: FoldSubjectInput,
) => Effect.Effect<{
	readonly value: unknown;
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

const write = <A, E, R>(
	work: Effect.Effect<A, E, R>,
	apply: ApplyFoldChanges = () => Effect.void,
	mode?: FoldMode,
) =>
	Effect.gen(function* () {
		const folds = yield* Folds.make;
		const session = yield* DatabaseSession;
		return yield* session
			.transaction(folds.within(work, apply, mode))
			.pipe(Effect.catchTag("DatabaseSessionStateError", Effect.die));
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
	yield* write(
		events.createEvents(
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

layer(testLayer)((test) => {
	test.effect(
		"replays a new subject, then passes before and after images and applies outputs as a patch",
		() =>
			Effect.scoped(
				Effect.gen(function* () {
					const { first, second, recorded, installed } = yield* setup();
					const events = yield* EventsRepository;
					const create = (eventId: EventId, entityId: EntityId, value: string) =>
						events.createEvents([
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
					yield* write(
						events.updatePreparedEvent({
							userId,
							eventId: moved,
							propertiesSchema,
							expectedRevision: 0,
							updatedAt: yield* DateTime.nowAsDate,
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
					yield* write(events.deleteEvent({ userId, eventId: kept }));
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
					yield* write(
						events.createEvents([
							{
								userId,
								eventSchemaName,
								entityId: first,
								propertiesSchema,
								properties: { value: "one" },
								id: EventId.make(yield* randomUuid),
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
					yield* (yield* Folds.make).failed({ userId, entityId: first });
					yield* createChanged(installed.pluginId, first, ["three"]);
					expect(recorded.map(({ changes }) => changes?.length ?? null)).toEqual([null, 1, null]);
					expect((yield* derived(first)).find(({ kind }) => kind === "subject")?.value).toEqual({
						pad,
						runs: 3,
					});
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
		"fails the whole write when one subject's outputs fail validation",
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
					assertExitFails(
						yield* Effect.exit(createEvents(installed.pluginId, both("two"))),
						new DbError({ message: "Fold returned invalid event properties" }),
					);
					expect(yield* derived(first)).toEqual([
						{ kind: "subject", targetId: first, value: { runs: 1 } },
					]);
				}),
			),
		testTimeout,
	);

	test.effect(
		"settles every subject that returned changes in one further run",
		() =>
			Effect.scoped(
				Effect.gen(function* () {
					const eventId = EventId.make(yield* randomUuid);
					const { ids, runs, installed } = yield* setup(
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
					const applied: Array<string> = [];
					const events = yield* EventsRepository;
					yield* write(
						events.createEvents(
							ids.map((entityId) => ({
								userId,
								entityId,
								eventSchemaName,
								propertiesSchema,
								id: EventId.make(entityId),
								properties: { value: "one" },
								eventSchemaPluginId: installed.pluginId,
								eventSchemaSlug: EventSchemaSlug.make("changed"),
								occurredAt: DateTime.toDate(DateTime.makeUnsafe("2026-01-01T00:00:00.000Z")),
							})),
						),
						(input) => {
							const subjects = input.changes.map((change) => change.itemIdentity);
							applied.push(...subjects);
							return marks.markSubjects(
								subjects.map((entityId) => ({ userId, entityId: EntityId.make(entityId) })),
							);
						},
					);
					expect(runs.map((run) => run.map(({ subjectEntityId }) => subjectEntityId))).toEqual([
						[...ids].sort(),
						[...ids].sort(),
					]);
					expect(applied.sort()).toEqual([...ids].sort());
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
					const marks = yield* FoldMarks;
					yield* write(
						marks.markSubjects(ids.map((entityId) => ({ userId, entityId }))),
						() => Effect.void,
						"job",
					);
					expect(runs.at(-1)).toEqual(
						sorted.map((subjectEntityId) => ({ changes: null, subjectEntityId })),
					);
				}),
			),
		testTimeout,
	);
});
