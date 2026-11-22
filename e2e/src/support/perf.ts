import { unknownToMessage } from "@ryot-app/contract/errors";
import { sortBy } from "@ryot-app/ts-utils/lodash";
import { Cause, Config, Duration, Effect, FileSystem, Predicate, Schedule, Schema } from "effect";
import { HttpClient } from "effect/http";

import { createImpersonationSession } from "~/fixtures/kernel/auth-impersonation";

/**
 * Marks the probes' own statements so statement statistics leave them out. PostgreSQL drops a
 * statement's leading comments from its recorded text, so the mark trails it.
 */
const PROBE_MARK = "/* ryot-perf-probe */";
const QUIET_MS = 300;
const QUIET_MAX_MS = 10_000;
const SLOWEST = 3;

const StatementRows = Schema.Array(
	Schema.Struct({
		id: Schema.String,
		rows: Schema.Finite,
		calls: Schema.Finite,
		execMs: Schema.Finite,
	}),
);
const StatementShapes = Schema.Array(
	Schema.Struct({
		id: Schema.String,
		head: Schema.String,
		chars: Schema.Finite,
		params: Schema.Finite,
	}),
);

export type StatementSnapshot = ReadonlyMap<string, Statement>;
type Statement = { readonly rows: number; readonly calls: number; readonly execMs: number };

export const percentile = (values: ReadonlyArray<number>, fraction: number) => {
	const sorted = sortBy(values);
	return sorted[Math.max(0, Math.ceil(fraction * sorted.length) - 1)] ?? 0;
};

export const statementCalls = (snapshot: StatementSnapshot) => {
	let calls = 0;
	let execMs = 0;
	for (const statement of snapshot.values()) {
		calls += statement.calls;
		execMs += statement.execMs;
	}
	return { calls, execMs };
};

/**
 * A database connection for statement statistics and target discovery. The role needs only
 * `pg_read_all_stats` and read access; the probes never write through it.
 */
export const perfDatabase = Effect.gen(function* () {
	const url = yield* Config.String("E2E_DATABASE_URL");
	const connection = yield* Effect.acquireRelease(
		Effect.sync(() => new Bun.SQL(url, { max: 1 })),
		(sql) => Effect.promise(() => sql.close()),
	);
	const query = <S extends Schema.Top>(
		schema: S,
		text: string,
		parameters: ReadonlyArray<unknown> = [],
	) =>
		Effect.tryPromise({
			catch: unknownToMessage,
			try: () => connection.unsafe(`${text}\n${PROBE_MARK}`, [...parameters]),
		}).pipe(
			Effect.retry({ times: 5, schedule: Schedule.spaced("2 seconds") }),
			Effect.orDie,
			Effect.flatMap((rows) => Schema.decodeUnknownEffect(schema)(rows).pipe(Effect.orDie)),
		);

	const probeIds = new Set<string>();
	const statements = query(
		StatementRows,
		`select queryid::text as id, calls::float8 as calls, total_exec_time as "execMs", rows::float8 as rows
		from pg_stat_statements(false)
		where dbid = (select oid from pg_database where datname = current_database()) and queryid is not null`,
	).pipe(
		Effect.map(
			(rows): StatementSnapshot =>
				new Map(
					rows.flatMap(({ id, ...statement }) =>
						probeIds.has(id) ? [] : [[id, statement] as const],
					),
				),
		),
	);
	yield* statements;
	for (const { id } of yield* query(
		Schema.Array(Schema.Struct({ id: Schema.String })),
		"select queryid::text as id from pg_stat_statements where query like '%ryot-perf-probe%'",
	)) {
		probeIds.add(id);
	}

	/** Waits until no application statement runs for a short window. */
	const quiet = Effect.gen(function* () {
		const started = performance.now();
		let last = statementCalls(yield* statements).calls;
		let stableSince = performance.now();
		while (performance.now() - started < QUIET_MAX_MS) {
			yield* Effect.sleep(Duration.millis(50));
			const calls = statementCalls(yield* statements).calls;
			if (calls !== last) {
				last = calls;
				stableSince = performance.now();
			} else if (performance.now() - stableSince >= QUIET_MS) {
				return;
			}
		}
	});

	/** The statements that ran between two snapshots, slowest first, as per-sample averages. */
	const slowest = Effect.fn("slowest")(function* (
		before: StatementSnapshot,
		after: StatementSnapshot,
		samples: number,
	) {
		const changed = [...after]
			.map(([id, statement]) => {
				const previous = before.get(id) ?? { rows: 0, calls: 0, execMs: 0 };
				return {
					id,
					rows: (statement.rows - previous.rows) / samples,
					calls: (statement.calls - previous.calls) / samples,
					execMs: (statement.execMs - previous.execMs) / samples,
				};
			})
			.filter((statement) => statement.calls > 0);
		const ran = sortBy(changed, (statement) => -statement.execMs).slice(0, SLOWEST);
		const shapes = yield* query(
			StatementShapes,
			`select queryid::text as id, length(query)::float8 as chars,
				left(regexp_replace(query, '\\s+', ' ', 'g'), 80) as head,
				coalesce((select max(m[1]::int) from regexp_matches(query, '\\$(\\d+)', 'g') m), 0)::float8 as params
			from pg_stat_statements where queryid::text = any($1)`,
			[ran.map((statement) => statement.id)],
		);
		return ran.map((statement) => {
			const shape = shapes.find((candidate) => candidate.id === statement.id);
			return {
				head: shape?.head ?? "",
				chars: shape?.chars ?? 0,
				params: shape?.params ?? 0,
				rows: round(statement.rows),
				calls: round(statement.calls),
				execMs: round(statement.execMs),
			};
		});
	});

	return { query, quiet, slowest, statements };
});

const round = (value: number) => Math.round(value * 10) / 10;

/** Runs `effect` and sums the `content-length` of every response it receives. */
export const countingResponseBytes = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
	Effect.gen(function* () {
		let bytes = 0;
		const client = yield* HttpClient.HttpClient;
		const value = yield* Effect.provideService(
			effect,
			HttpClient.HttpClient,
			HttpClient.tap(client, (response) =>
				Effect.sync(() => {
					bytes += Number(response.headers["content-length"] ?? 0);
				}),
			),
		);
		return { bytes, value };
	});

/** Signs in as `userId`, waiting out the sign-in rate limit, whose fixture failures are defects. */
export const impersonate = (userId: string) =>
	createImpersonationSession(userId).pipe(
		Effect.map(({ client }) => client),
		Effect.catchDefect(Effect.fail),
		Effect.retry({ times: 20, schedule: Schedule.spaced("3 seconds") }),
	);

/** Appends one aggregate row to the report file at `path`. */
export const appendReport = (path: string, row: unknown) =>
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		const line = yield* Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown))(row);
		yield* fs.writeFileString(path, `${line}\n`, { flag: "a" });
	}).pipe(Effect.orDie);

/** A failure's tag and reason code or message key, or its error name; never text or parameters. */
export const failureTag = (cause: Cause.Cause<unknown>) => {
	const error = Cause.squash(cause);
	if (!Predicate.hasProperty(error, "_tag") || typeof error._tag !== "string") {
		return error instanceof Error ? error.name : "unknown";
	}
	const reason = Predicate.hasProperty(error, "reason") ? error.reason : undefined;
	if (Predicate.hasProperty(reason, "code") && typeof reason.code === "string") {
		return `${error._tag}:${reason.code}`;
	}
	return Predicate.hasProperty(reason, "key") && typeof reason.key === "string"
		? `${error._tag}:${reason.key}`
		: error._tag;
};
