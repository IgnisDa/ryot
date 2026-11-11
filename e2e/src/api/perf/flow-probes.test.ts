import { EntityId, EventSchemaSlug } from "@ryot-app/contract/schema/brands";
import { mediaPlugin } from "@ryot-app/media-plugin";
import { flatByLifecycleStateRecipe } from "@ryot-app/media-plugin/shared/lifecycle-list-recipes";
import {
	MediaReviewCreateInput,
	MediaReviewOutput,
} from "@ryot-app/media-plugin/shared/media-review-operations";
import { defineOperationRecipe } from "@ryot-app/plugin-kit/operations";
import { entityReadRecipe } from "@ryot-app/ryotql-recipes/scripts";
import { randomUuid } from "@ryot-app/testing/random";
import { Duration, Effect, FileSystem, Schema } from "effect";

import { createAuthenticatedClient } from "~/fixtures/kernel";
import { createCollection } from "~/fixtures/kernel/collections";
import { compilePluginPackage } from "~/fixtures/kernel/compiled-package";
import { getApiClient } from "~/fixtures/kernel/contract-client";
import { invokeOperation } from "~/fixtures/kernel/operations";
import {
	namespaceInstallation,
	pluginNamespacePackages,
} from "~/fixtures/kernel/plugin-namespaces";
import {
	PRIVATE_PLUGIN_CONFIG_KEY,
	PRIVATE_PLUGIN_SECRET_KEY,
	privatePluginPackage,
	settledPrivateInstallation,
} from "~/fixtures/kernel/private-plugin";
import { executeRyotQLRecipe } from "~/fixtures/kernel/ryotql";
import { uploadPrivatePluginPackage } from "~/fixtures/kernel/temporary-archive";
import {
	installTestSupportSystemPlugin,
	updateTestSupportSystemPlugin,
} from "~/fixtures/kernel/test-plugin";
import {
	createExerciseEntityFixture,
	createMeasurementMetric,
	saveWorkoutData,
	seedExerciseWorkout,
	workoutData,
	workoutOccurrence,
	workoutSet,
} from "~/fixtures/plugins/fitness";
import {
	createBuiltinMediaLifecycleFixture,
	findMediaEntitySchema,
	logMediaActivity,
	seedShow,
} from "~/fixtures/plugins/media";
import { describe, it } from "~/support/effect-test";
import { nowIso } from "~/support/time";

const RUN_FLOW_PROBES = process.env.RUN_FLOW_PROBES === "1";
const FLOW_PROBE_OUT = process.env.FLOW_PROBE_OUT;
const FLOW_PROBE_FOCUS = Number(process.env.FLOW_PROBE_FOCUS ?? "0");
const SETTLE_WINDOW_MS = 1500;
const SETTLE_MAX_MS = 120_000;

const createReview = defineOperationRecipe({
	output: MediaReviewOutput,
	input: MediaReviewCreateInput,
	operationSlug: "media-review-create",
	packageId: mediaPlugin.metadata.packageId,
});

const DatabaseRow = Schema.Struct({ xacts: Schema.FiniteFromString });
const StatementsRow = Schema.Struct({ calls: Schema.Finite, execMs: Schema.Finite });
const TableRows = Schema.Array(Schema.Struct({ writes: Schema.Finite, relname: Schema.String }));
const CountRows = Schema.Array(Schema.Struct({ n: Schema.Finite, key: Schema.String }));
const QueryRows = Schema.Array(
	Schema.Struct({ n: Schema.Finite, key: Schema.String, text: Schema.String }),
);

type Snapshot = {
	at: number;
	xacts: number;
	calls: number;
	execMs: number;
	cpuTicks: number;
	ownCpuTicks: number;
	tables: ReadonlyMap<string, number>;
	counts: ReadonlyMap<string, number>;
	queries: ReadonlyMap<string, { n: number; text: string }>;
};

const sql = RUN_FLOW_PROBES
	? new Bun.SQL(String(process.env.E2E_DATABASE_URL), { max: 1 })
	: undefined;
const serverPid = Number(process.env.E2E_SERVER_PID);

const query = <S extends Schema.Top>(schema: S, run: (client: Bun.SQL) => Promise<unknown>) =>
	Effect.gen(function* () {
		if (sql === undefined) {
			return yield* Effect.die("flow probes are disabled");
		}
		const rows = yield* Effect.promise(() => run(sql));
		return yield* Schema.decodeUnknownEffect(schema)(rows).pipe(Effect.orDie);
	});

const processTreeTicks = Effect.gen(function* () {
	const fs = yield* FileSystem.FileSystem;
	const stats = new Map<number, { ppid: number; ticks: number }>();
	for (const name of yield* fs.readDirectory("/proc").pipe(Effect.orDie)) {
		if (!/^\d+$/.test(name)) {
			continue;
		}
		const raw = yield* fs.readFileString(`/proc/${name}/stat`).pipe(Effect.orElseSucceed(() => ""));
		if (raw === "") {
			continue;
		}
		const fields = raw.slice(raw.lastIndexOf(")") + 2).split(" ");
		const ticks = [11, 12, 13, 14].reduce((sum, index) => sum + Number(fields[index]), 0);
		stats.set(Number(name), { ticks, ppid: Number(fields[1]) });
	}
	let total = 0;
	for (const [pid, stat] of stats) {
		let cursor: number | undefined = pid;
		while (cursor !== undefined && cursor > 1) {
			if (cursor === serverPid) {
				total += stat.ticks;
				break;
			}
			cursor = stats.get(cursor)?.ppid;
		}
	}
	return { total, own: stats.get(serverPid)?.ticks ?? 0 };
});

const snapshot = Effect.gen(function* () {
	const [database] = yield* query(
		Schema.Array(DatabaseRow),
		(client) =>
			client`select (xact_commit + xact_rollback)::text as xacts from pg_stat_database where datname = current_database()`,
	);
	const [statements] = yield* query(
		Schema.Array(StatementsRow),
		(client) =>
			client`select coalesce(sum(calls), 0)::float8 as calls, coalesce(sum(total_exec_time), 0)::float8 as "execMs" from pg_stat_statements where query not ilike '%pg_stat%'`,
	);
	const tables = yield* query(
		TableRows,
		(client) =>
			client`select relname, (n_tup_ins + n_tup_upd + n_tup_del)::float8 as writes from pg_stat_user_tables`,
	);
	const counts = yield* query(
		CountRows,
		(client) =>
			client`select 'workflow:' || workflow_name as key, count(*)::float8 as n from workflow_execution group by 1
				union all select 'payload-bytes:' || workflow_name, sum(octet_length(payload::text))::float8 from workflow_execution group by 1
				union all select 'step-bytes:' || kind || ':' || regexp_replace(name, '[0-9A-Za-z_]*[0-9][0-9A-Za-z_]*', 'N', 'g'), sum(octet_length(coalesce(exit::text, '')))::float8 from workflow_step group by 1
				union all select 'hook:' || hook_slug, count(*)::float8 from automation_run group by 1
				union all select 'script:' || coalesce(e.parent_workflow_name, 'root') || ':' || coalesce(s.slug, 'unknown'), count(*)::float8
					from workflow_execution e left join sandbox_script s on s.id = e.payload->>'scriptId'
					where e.workflow_name = 'ScriptExecutionWorkflow' group by 1
				union all select 'step:' || kind || ':' || regexp_replace(name, '[0-9A-Za-z_]*[0-9][0-9A-Za-z_]*', 'N', 'g'), count(*)::float8
					from workflow_step group by 1`,
	);
	const queries = yield* query(
		QueryRows,
		(client) =>
			client`select queryid::text as key, calls::float8 as n, left(regexp_replace(query, '[[:space:]]+', ' ', 'g'), 200) as text
				from pg_stat_statements where query not ilike '%pg_stat%' and queryid is not null`,
	);
	return {
		at: performance.now(),
		xacts: database?.xacts ?? 0,
		calls: statements?.calls ?? 0,
		execMs: statements?.execMs ?? 0,
		...(yield* processTreeTicks.pipe(
			Effect.map(({ own, total }) => ({ cpuTicks: total, ownCpuTicks: own })),
		)),
		counts: new Map(counts.map(({ n, key }) => [key, n])),
		queries: new Map(queries.map(({ n, key, text }) => [key, { n, text }])),
		tables: new Map(tables.map(({ writes, relname }) => [relname, writes])),
	} satisfies Snapshot;
});

const diff = (before: Snapshot, after: Snapshot) => {
	const tableWrites: Record<string, number> = {};
	for (const [name, value] of after.tables) {
		const delta = value - (before.tables.get(name) ?? 0);
		if (delta > 0) {
			tableWrites[name] = delta;
		}
	}
	const created: Record<string, number> = {};
	for (const [name, value] of after.counts) {
		const delta = value - (before.counts.get(name) ?? 0);
		if (delta > 0) {
			created[name] = delta;
		}
	}
	const topStatements = [...after.queries]
		.map(([key, { n, text }]) => ({ text, calls: n - (before.queries.get(key)?.n ?? 0) }))
		.filter((entry) => entry.calls > 0)
		.sort((left, right) => right.calls - left.calls)
		.slice(0, 40);
	return {
		created,
		tableWrites,
		topStatements,
		xacts: after.xacts - before.xacts,
		ms: Math.round(after.at - before.at),
		statements: after.calls - before.calls,
		dbExecMs: Math.round(after.execMs - before.execMs),
		serverCpuMs: (after.cpuTicks - before.cpuTicks) * 10,
		apiCpuMs: (after.ownCpuTicks - before.ownCpuTicks) * 10,
	};
};

type Rates = { xacts: number; dbExecMs: number; statements: number; serverCpuMs: number };
const idle: Rates = { xacts: 0, dbExecMs: 0, statements: 0, serverCpuMs: 0 };

// The server never goes fully quiet (runner heartbeat, shard locks, storage polls, the probe's own
// snapshots), so a window counts as settled when it is within the calibrated idle rate.
const settle = Effect.gen(function* () {
	let previous = yield* snapshot;
	const deadline = previous.at + SETTLE_MAX_MS;
	let current = previous;
	do {
		yield* Effect.sleep(Duration.millis(SETTLE_WINDOW_MS));
		current = yield* snapshot;
		const allowed = idle.xacts * (current.at - previous.at) * 1.5 + 4;
		if (current.xacts - previous.xacts <= allowed) {
			break;
		}
		previous = current;
	} while (current.at <= deadline);
	return current;
});

const calibrate = Effect.gen(function* () {
	const windows: Array<Rates> = [];
	for (let index = 0; index < 4; index++) {
		const before = yield* snapshot;
		yield* Effect.sleep(Duration.seconds(5));
		const delta = diff(before, yield* snapshot);
		windows.push({
			xacts: delta.xacts / delta.ms,
			dbExecMs: delta.dbExecMs / delta.ms,
			statements: delta.statements / delta.ms,
			serverCpuMs: delta.serverCpuMs / delta.ms,
		});
	}
	for (const key of ["xacts", "statements", "dbExecMs", "serverCpuMs"] as const) {
		idle[key] = Math.min(...windows.map((window) => window[key]));
	}
	yield* Effect.logInfo("flow probe idle rates per second", {
		xacts: idle.xacts * 1000,
		dbExecMs: idle.dbExecMs * 1000,
		statements: idle.statements * 1000,
		serverCpuMs: idle.serverCpuMs * 1000,
	});
});

const net = (delta: ReturnType<typeof diff>) => ({
	netXacts: Math.round(delta.xacts - idle.xacts * delta.ms),
	netDbExecMs: Math.round(delta.dbExecMs - idle.dbExecMs * delta.ms),
	netStatements: Math.round(delta.statements - idle.statements * delta.ms),
	netServerCpuMs: Math.round(delta.serverCpuMs - idle.serverCpuMs * delta.ms),
});

const ProbeResults = Schema.fromJsonString(Schema.Unknown);
const results: Array<Record<string, unknown>> = [];

const probe = <A, E, R>(name: string, flow: Effect.Effect<A, E, R>) =>
	Effect.gen(function* () {
		yield* settle;
		const before = yield* snapshot;
		const value = yield* flow;
		const returned = yield* snapshot;
		const settled = yield* settle;
		const delta = diff(before, settled);
		const row = {
			name,
			...delta,
			...net(delta),
			callerMs: Math.round(returned.at - before.at),
			settleMs: Math.round(settled.at - returned.at - SETTLE_WINDOW_MS),
		};
		results.push(row);
		const encoded = yield* Schema.encodeEffect(ProbeResults)(results).pipe(Effect.orDie);
		yield* Effect.logInfo("flow probe", row);
		if (FLOW_PROBE_OUT !== undefined) {
			const fs = yield* FileSystem.FileSystem;
			yield* fs.writeFileString(FLOW_PROBE_OUT, encoded).pipe(Effect.orDie);
		}
		return value;
	});

const repeat = <A, E, R>(name: string, times: number, flow: () => Effect.Effect<A, E, R>) =>
	Effect.gen(function* () {
		for (let index = 0; index < times; index++) {
			yield* probe(name, flow());
		}
	});

const day = (value: number, time: string) =>
	`2026-06-${String(value).padStart(2, "0")}T${time}.000Z`;

describe.skipIf(!RUN_FLOW_PROBES)("flow probes", () => {
	it.live(
		"measures per-flow cost on an otherwise idle server",
		() =>
			Effect.gen(function* () {
				yield* createAuthenticatedClient();
				yield* calibrate;
				yield* repeat("signup", FLOW_PROBE_FOCUS > 0 ? 1 : 5, () => createAuthenticatedClient());

				const { client } = yield* createAuthenticatedClient();
				yield* repeat("media-movie-fixture", FLOW_PROBE_FOCUS > 0 ? 1 : 3, () =>
					createBuiltinMediaLifecycleFixture(client, { entitySchemaSlug: "movie" }),
				);
				const { entityId } = yield* createBuiltinMediaLifecycleFixture(client, {
					entitySchemaSlug: "movie",
				});
				yield* repeat("event-create-backlog", FLOW_PROBE_FOCUS || 5, () =>
					client.call((c) =>
						c.events.create({
							payload: [
								{
									properties: {},
									entityId: EntityId.make(entityId),
									eventSchemaSlug: EventSchemaSlug.make("backlog"),
								},
							],
						}),
					),
				);
				// Media's consumption policy runs on `complete`, so this create measures a direct policy run.
				yield* repeat("event-create-complete", FLOW_PROBE_FOCUS || 5, () =>
					client.call((c) =>
						c.events.create({
							payload: [
								{
									properties: {},
									entityId: EntityId.make(entityId),
									eventSchemaSlug: EventSchemaSlug.make("complete"),
								},
							],
						}),
					),
				);
				if (FLOW_PROBE_FOCUS > 0) {
					return;
				}
				for (let index = 0; index < 3; index++) {
					const collection = yield* createCollection(client);
					yield* probe(
						"collection-membership-add",
						client.call((c) =>
							c.collections.createMembership({
								payload: { collectionId: collection.id, entityId: EntityId.make(entityId) },
							}),
						),
					);
				}
				for (let index = 0; index < 3; index++) {
					const uploadToken = yield* probe(
						"plugin-upload-private",
						uploadPrivatePluginPackage(client, privatePluginPackage({})),
					);
					yield* probe(
						"plugin-install-private",
						client
							.call((c) =>
								c.plugins.install({
									payload: {
										uploadToken,
										config: {
											[PRIVATE_PLUGIN_CONFIG_KEY]: "alpha",
											[PRIVATE_PLUGIN_SECRET_KEY]: "token",
										},
									},
								}),
							)
							.pipe(
								Effect.flatMap((installed) => settledPrivateInstallation(client, installed.id)),
							),
					);
				}
				const show = yield* seedShow(client, {
					properties: { productionStatus: "Ended" },
					seasons: [
						{
							seasonNumber: 1,
							episodes: Array.from({ length: 70 }, (_, index) => ({
								episodeNumber: index + 1,
								publishDate: "2020-01-01",
							})),
						},
					],
				});
				yield* probe(
					"media-show-70-episodes",
					logMediaActivity(client, {
						submittedAt: nowIso(),
						submissionId: yield* randomUuid,
						entry: {
							kind: "episodes",
							parentEntityId: show.show.id,
							episodeEntityIds: show.episodes.map((episode) => episode.id),
							when: { kind: "date", finishedOn: "2026-01-01T12:00:00.000Z" },
						},
					}),
				);
				const movies = yield* Effect.forEach(
					Array.from({ length: 20 }),
					() => createBuiltinMediaLifecycleFixture(client, { entitySchemaSlug: "movie" }),
					{ concurrency: 4 },
				);
				yield* probe(
					"media-progress-fanout-20",
					client.call((c) =>
						c.events.create({
							payload: movies.map((movie) => ({
								properties: { progressPercent: 100 },
								occurredAt: "2026-01-01T12:00:00.000Z",
								entityId: EntityId.make(movie.entityId),
								eventSchemaSlug: EventSchemaSlug.make(movie.progressEventSchemaSlug),
							})),
						}),
					),
				);
				// `measurement-reading` matches no hook, has no projection and belongs to no batch-hook
				// candidate, so these flows measure the write path alone.
				const { entityId: metricId } = yield* createMeasurementMetric(client, {
					name: "Probe metric",
				});
				const readings = (count: number) =>
					Array.from({ length: count }, (_, index) => ({
						properties: { value: index },
						entityId: EntityId.make(metricId),
						eventSchemaSlug: EventSchemaSlug.make("measurement-reading"),
					}));
				yield* repeat("event-create-no-hooks", 5, () =>
					client.call((c) => c.events.create({ payload: readings(1) })),
				);
				yield* repeat("event-create-no-hooks-50", 3, () =>
					client.call((c) => c.events.create({ payload: readings(50) })),
				);
				const movieSchema = yield* findMediaEntitySchema(client, "movie");
				// Fifty reads per sample: one read is below the CPU sampler's 10 ms resolution.
				yield* repeat("read-entity-x50", 3, () =>
					Effect.forEach(Array.from({ length: 50 }), () =>
						executeRyotQLRecipe(client, entityReadRecipe, { entityIds: [entityId] }),
					),
				);
				yield* repeat("read-media-list-x50", 3, () =>
					Effect.forEach(Array.from({ length: 50 }), () =>
						executeRyotQLRecipe(
							client,
							flatByLifecycleStateRecipe({
								reference: { kind: "local", pluginId: movieSchema.pluginId },
							}),
							{ states: ["backlog", "in_progress", "complete"] },
							{ pages: { items: { limit: 20 } } },
						),
					),
				);
				yield* repeat("operation-review-create", 3, () =>
					Effect.gen(function* () {
						const movie = yield* createBuiltinMediaLifecycleFixture(client, {
							entitySchemaSlug: "movie",
						});
						return yield* invokeOperation(
							client,
							createReview,
							{ rating: 80, text: null, isSpoiler: false, entityId: movie.entityId },
							{ idempotencyKey: yield* randomUuid },
						);
					}),
				);

				const { exerciseId } = yield* createExerciseEntityFixture(client);
				const workout = (sets: number, date: number) =>
					seedExerciseWorkout(client, {
						exerciseId,
						timeoutMs: 600_000,
						name: `Probe workout ${sets}`,
						endedAt: day(date, "11:00:00"),
						startedAt: day(date, "10:00:00"),
						sets: Array.from({ length: sets }, () => ({
							occurredAt: day(date, "10:05:00"),
							properties: { reps: 10, weight: 50, confirmedAt: day(date, "10:05:00") },
						})),
					});
				yield* probe("workout-1-set", workout(1, 1));
				yield* probe("workout-1-set", workout(1, 2));
				yield* probe("workout-10-sets", workout(10, 3));
				yield* probe("workout-25-sets", workout(25, 4));
				const exercises = yield* Effect.forEach(Array.from({ length: 10 }), () =>
					createExerciseEntityFixture(client),
				);
				const editorSave = (occurrences: number, setsPerOccurrence: number) =>
					saveWorkoutData(
						client,
						workoutData({
							occurrences: exercises.slice(0, occurrences).map((exercise) =>
								workoutOccurrence(
									exercise.exerciseId,
									Array.from({ length: setsPerOccurrence }, () =>
										workoutSet({ measurements: { reps: 10, weight: 50 } }),
									),
								),
							),
						}),
					);
				yield* repeat("workout-editor-save-1x5", 3, () => editorSave(1, 5));
				yield* repeat("workout-editor-save-5x5", 3, () => editorSave(5, 5));
				yield* repeat("workout-editor-save-10x15", 3, () => editorSave(10, 15));
				// Last, because these system plugins stay installed: their bootstrap entities block uninstalling them.
				for (let index = 0; index < 3; index++) {
					const packages = pluginNamespacePackages();
					const original = yield* compilePluginPackage(packages.a);
					const next = yield* compilePluginPackage(packages.a2);
					const system = yield* probe(
						"plugin-system-install",
						installTestSupportSystemPlugin(original),
					);
					yield* probe(
						"plugin-system-reconcile",
						getApiClient().adminCall((contract) =>
							contract.testSupport.reconcilePluginInstallations(),
						),
					);
					const installed = yield* namespaceInstallation(client, system.pluginId);
					yield* probe(
						"plugin-system-change",
						updateTestSupportSystemPlugin({
							...next,
							pluginId: system.pluginId,
							contentHash: installed.contentHash,
						}),
					);
				}
			}),
		1_800_000,
	);
});
