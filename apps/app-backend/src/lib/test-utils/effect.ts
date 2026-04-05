import { Workflow } from "@effect/workflow";
import { WorkflowEngine, WorkflowInstance } from "@effect/workflow/WorkflowEngine";
import { Effect, Layer, LogLevel, Option, Redacted } from "effect";

import { AppConfig, type AppConfigValue } from "#lib/infrastructure/config/service";
import { CurrentDb, DbRunner, TransactionRunner } from "#lib/infrastructure/db/service";
import type { RedisService } from "#lib/infrastructure/redis";

export type MockOverrides<T> = T extends (...args: infer TArgs) => unknown
	? Omit<TArgs[0], "_tag">
	: never;

const provideEmptyDb = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
	Effect.provideService(effect, CurrentDb, Object.create(null));

export const dbRunnerLayer = Layer.succeed(DbRunner, provideEmptyDb);

export const transactionLayer = Layer.succeed(TransactionRunner, provideEmptyDb);

export type WorkflowEngineOverrides = Omit<Partial<WorkflowEngine["Type"]>, "execute"> & {
	execute?: (
		...args: Parameters<WorkflowEngine["Type"]["execute"]>
	) => Effect.Effect<unknown, unknown>;
};

export const makeWorkflowEngine = (
	overrides: WorkflowEngineOverrides = {},
): WorkflowEngine["Type"] =>
	Object.assign(Object.create(null), {
		poll: () => Effect.die("unused"),
		resume: () => Effect.die("unused"),
		execute: () => Effect.die("unused"),
		register: () => Effect.die("unused"),
		interrupt: () => Effect.die("unused"),
		deferredDone: () => Effect.die("unused"),
		scheduleClock: () => Effect.die("unused"),
		deferredResult: () => Effect.die("unused"),
		activityExecute: () => Effect.die("unused"),
		...overrides,
	});

export const makeRedisService = (overrides: Partial<RedisService> = {}): RedisService =>
	Object.assign(Object.create(null), {
		client: undefined,
		del: () => Effect.die("unused"),
		get: () => Effect.die("unused"),
		set: () => Effect.die("unused"),
		claim: () => Effect.die("unused"),
		getdel: () => Effect.die("unused"),
		publish: () => Effect.die("unused"),
		...overrides,
	});

type ConfigLeafValue = Option.Option<unknown> | Redacted.Redacted<unknown>;

type DeepPartial<T> = T extends ConfigLeafValue
	? T
	: T extends object
		? { [K in keyof T]?: DeepPartial<T[K]> }
		: T;

const isPlainConfigObject = (value: unknown): value is Record<string, unknown> => {
	if (value === null || typeof value !== "object") {
		return false;
	}
	const proto = Object.getPrototypeOf(value);
	return proto === Object.prototype || proto === null;
};

const deepMergeConfig = (base: unknown, override: unknown): unknown => {
	if (!isPlainConfigObject(base) || !isPlainConfigObject(override)) {
		return override ?? base;
	}
	const result: Record<string, unknown> = { ...base };
	for (const key of Object.keys(override)) {
		result[key] = deepMergeConfig(base[key], override[key]);
	}
	return result;
};

export const makeAppConfigLayer = (
	overrides?: DeepPartial<AppConfigValue>,
): Layer.Layer<AppConfig> => {
	const defaults = {
		port: 3000,
		tmpDir: "/tmp",
		nodeEnv: "test",
		timezone: "Etc/GMT",
		_tag: "AppConfig" as const,
		builtinExercisePreloadLimit: 873,
		frontendUrl: "http://localhost:3000",
		redisUrl: Redacted.make("unused"),
		frontend: { oidcButtonLabel: Option.none() },
		users: { allowRegistration: true, disableLocalAuth: false },
		database: {
			poolMax: 10,
			workflowPoolMax: 10,
			connectionTimeoutMs: 10_000,
			url: Redacted.make("unused"),
		},
		sandbox: {
			denoDir: "/tmp",
			timeoutMs: 5_000,
			workerConcurrency: 5,
			jobIdSecret: Redacted.make("test-secret"),
		},
		server: {
			logFile: Option.none(),
			logLevel: LogLevel.Info,
			corsOrigins: Option.none(),
			otlpEndpoint: Option.none(),
			traktClientId: Option.none(),
			disableNotifications: false,
			progressUpdateThresholdHours: 2,
			adminAccessToken: Redacted.make("unused"),
			smtp: {
				user: Option.none(),
				server: Option.none(),
				password: Option.none(),
				mailbox: "Ryot <no-reply@ryot.io>",
			},
			oidc: { clientId: Option.none(), issuerUrl: Option.none(), clientSecret: Option.none() },
		},
		scheduler: {
			disableDispatchers: false,
			frequentCronJobsSchedule: "every 5 minutes",
			infrequentCronJobsSchedule: "every midnight",
		},
		fileStorage: {
			url: Option.none(),
			region: Option.none(),
			bucketName: Option.none(),
			accessKeyId: Option.none(),
			secretAccessKey: Option.none(),
		},
		moviesAndShows: {
			tmdbAccessToken: Option.none(),
			tvdbApiKey: Option.none(),
		},
		animeAndManga: {
			malClientId: Option.none(),
		},
		comicBooks: {
			metronUsername: Option.none(),
			metronPassword: Option.none(),
		},
		books: {
			hardcoverApiKey: Option.none(),
			googleBooksApiKey: Option.none(),
		},
		music: {
			spotifyClientId: Option.none(),
			spotifyClientSecret: Option.none(),
		},
		podcasts: {
			listennotesApiKey: Option.none(),
		},
		videoGames: {
			giantBombApiKey: Option.none(),
			twitchClientId: Option.none(),
			twitchClientSecret: Option.none(),
		},
	};
	// oxlint-disable-next-line no-unsafe-type-assertion -- deepMergeConfig is an untyped structural merge; the result is always the complete defaults with overrides applied, so it matches typeof defaults
	return Layer.succeed(AppConfig, deepMergeConfig(defaults, overrides ?? {}) as typeof defaults);
};

export const makeWorkflowActivityEngine = (
	instance: WorkflowInstance["Type"],
	overrides: WorkflowEngineOverrides = {},
) => {
	let engine: WorkflowEngine["Type"];

	engine = makeWorkflowEngine({
		activityExecute: (activity) =>
			Effect.gen(function* () {
				const exit = yield* Effect.exit(
					activity.execute.pipe(
						Effect.provideService(WorkflowEngine, engine),
						Effect.provideService(WorkflowInstance, instance),
					),
				);

				return new Workflow.Complete({ exit });
			}),
		...overrides,
	});

	return engine;
};
