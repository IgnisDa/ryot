import { Workflow } from "@effect/workflow";
import { WorkflowEngine, WorkflowInstance } from "@effect/workflow/WorkflowEngine";
import { Effect, Layer, Option, Redacted } from "effect";

import { AppConfig, type AppConfigValue } from "#lib/config";
import { CurrentDb, DbRunner, TransactionRunner } from "#lib/db";

const provideEmptyDb = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
	Effect.provideService(effect, CurrentDb, Object.create(null));

export const dbRunnerLayer = Layer.succeed(DbRunner, provideEmptyDb);

export const transactionLayer = Layer.succeed(TransactionRunner, provideEmptyDb);

export function makeMock<T>(defaults: object, overrides?: Partial<T>): T;
export function makeMock(defaults: object, overrides?: object): Record<string, unknown>;
export function makeMock(defaults: object, overrides: object = {}) {
	return Object.assign(Object.create(null), defaults, overrides);
}

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
		databaseUrl: Redacted.make("unused"),
		frontend: { oidcButtonLabel: Option.none() },
		users: { allowRegistration: true, disableLocalAuth: false },
		scheduler: { frequentCronJobsSchedule: "every 5 minutes", progressUpdateThresholdHours: 2 },
		sandbox: {
			denoDir: "/tmp",
			timeoutMs: 5_000,
			workerConcurrency: 5,
			jobIdSecret: Redacted.make("test-secret"),
		},
		server: {
			corsOrigins: Option.none(),
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
