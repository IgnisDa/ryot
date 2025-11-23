import { Workflow } from "@effect/workflow";
import { WorkflowEngine, WorkflowInstance } from "@effect/workflow/WorkflowEngine";
import { Effect, Layer, Option, Redacted } from "effect";

export type MockOverrides<T> = T extends (...args: infer TArgs) => unknown
	? Omit<TArgs[0], "_tag">
	: never;

import { AppConfig, type AppConfigValue } from "#lib/infrastructure/config/service";
import { CurrentDb, DbRunner, TransactionRunner } from "#lib/infrastructure/db/service";
import type { RedisService } from "#lib/infrastructure/redis";

const provideEmptyDb = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
	Effect.provideService(effect, CurrentDb, Object.create(null));

export const dbRunnerLayer = Layer.succeed(DbRunner, provideEmptyDb);

export const transactionLayer = Layer.succeed(TransactionRunner, provideEmptyDb);

type WorkflowEngineOverrides = Omit<Partial<WorkflowEngine["Type"]>, "execute"> & {
	execute?: (...args: Parameters<WorkflowEngine["Type"]["execute"]>) => Effect.Effect<unknown>;
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

export const makeAppConfigLayer = (overrides?: Partial<AppConfigValue>): Layer.Layer<AppConfig> => {
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
		database: { poolMax: 10, connectionTimeoutMs: 10_000, url: Redacted.make("unused") },
		notifications: {
			smtp: {
				user: Option.none(),
				server: Option.none(),
				password: Option.none(),
				mailbox: "Ryot <no-reply@ryot.io>",
			},
		},
		scheduler: {
			progressUpdateThresholdHours: 2,
			frequentCronJobsSchedule: "every 5 minutes",
			infrequentCronJobsSchedule: "every midnight",
		},
		sandbox: {
			denoDir: "/tmp",
			timeoutMs: 5_000,
			workerConcurrency: 5,
			jobIdSecret: Redacted.make("test-secret"),
		},
		server: {
			corsOrigins: Option.none(),
			disableNotifications: false,
			disableBackgroundJobs: false,
			adminAccessToken: Redacted.make("unused"),
			oidc: { clientId: Option.none(), issuerUrl: Option.none(), clientSecret: Option.none() },
		},
		fileStorage: {
			url: Option.none(),
			region: Option.none(),
			bucketName: Option.none(),
			accessKeyId: Option.none(),
			secretAccessKey: Option.none(),
		},
		providers: {
			tvdbApiKey: Option.none(),
			malClientId: Option.none(),
			traktClientId: Option.none(),
			metronUsername: Option.none(),
			twitchClientId: Option.none(),
			tmdbAccessToken: Option.none(),
			metronPassword: Option.none(),
			hardcoverApiKey: Option.none(),
			spotifyClientId: Option.none(),
			giantBombApiKey: Option.none(),
			googleBooksApiKey: Option.none(),
			listennotesApiKey: Option.none(),
			twitchClientSecret: Option.none(),
			spotifyClientSecret: Option.none(),
		},
	};
	return Layer.succeed(AppConfig, { ...defaults, ...overrides });
};

export const makeWorkflowActivityEngine = (instance: WorkflowInstance["Type"]) => {
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
	});

	return engine;
};
