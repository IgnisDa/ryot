import { Effect, Layer, Option, Redacted } from "effect";
import { Workflow } from "effect/unstable/workflow";
import {
	layerMemory as workflowEngineMemoryLayer,
	WorkflowEngine,
	WorkflowInstance,
} from "effect/unstable/workflow/WorkflowEngine";

import { AppConfig, type AppConfigValue } from "#lib/infrastructure/config/service";
import { CurrentDb, DbRunner, TransactionRunner } from "#lib/infrastructure/db/service";
import type { RedisService } from "#lib/infrastructure/redis";
import { detachDiscardedWorkflowChildren } from "#lib/infrastructure/workflow";

export type MockOverrides<T> = T extends (...args: infer TArgs) => unknown
	? Omit<TArgs[0], "_tag">
	: never;

const provideEmptyDb = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
	Effect.provideService(effect, CurrentDb, Object.create(null));

export const dbRunnerLayer = Layer.succeed(DbRunner, provideEmptyDb);

export const transactionLayer = Layer.succeed(TransactionRunner, provideEmptyDb);

export type WorkflowEngineOverrides = Omit<Partial<WorkflowEngine["Service"]>, "execute"> & {
	execute?: (
		...args: Parameters<WorkflowEngine["Service"]["execute"]>
	) => Effect.Effect<unknown, unknown>;
};

export const makeWorkflowEngine = (
	overrides: WorkflowEngineOverrides = {},
): WorkflowEngine["Service"] =>
	Object.assign(
		WorkflowEngine.of({
			poll: () => Effect.die("unused"),
			resume: () => Effect.die("unused"),
			execute: () => Effect.die("unused"),
			register: () => Effect.die("unused"),
			interrupt: () => Effect.die("unused"),
			interruptUnsafe: () => Effect.die("unused"),
			deferredDone: () => Effect.die("unused"),
			scheduleClock: () => Effect.die("unused"),
			deferredResult: () => Effect.die("unused"),
			activityExecute: () => Effect.die("unused"),
		}),
		overrides,
	);

export const workflowEngineTestLayer = Layer.effect(
	WorkflowEngine,
	Effect.map(WorkflowEngine, detachDiscardedWorkflowChildren),
).pipe(Layer.provide(workflowEngineMemoryLayer));

export const makeRedisService = (
	overrides: Partial<RedisService["Service"]> = {},
): RedisService["Service"] =>
	Object.assign(Object.create(null), {
		client: undefined,
		del: () => Effect.die("unused"),
		get: () => Effect.die("unused"),
		set: () => Effect.die("unused"),
		claim: () => Effect.die("unused"),
		zadd: () => Effect.die("unused"),
		zrem: () => Effect.die("unused"),
		getdel: () => Effect.die("unused"),
		publish: () => Effect.die("unused"),
		setAndIndex: () => Effect.die("unused"),
		setAndRemoveFromIndex: () => Effect.die("unused"),
		...overrides,
	});

type ConfigLeafValue = Option.Option<unknown> | Redacted.Redacted<unknown>;

type DeepPartial<T> = T extends ConfigLeafValue
	? T
	: T extends object
		? { [K in keyof T]?: DeepPartial<T[K]> }
		: T;

export const makeAppConfigLayer = (
	overrides?: DeepPartial<AppConfigValue>,
): Layer.Layer<AppConfig> => {
	const defaults = {
		port: 3000,
		tmpDir: "/tmp",
		nodeEnv: "test",
		timezone: "Etc/GMT",
		frontendUrl: "http://localhost:3000",
		redisUrl: Redacted.make("unused"),
		frontend: { oidcButtonLabel: Option.none() },
		users: { allowRegistration: true, disableLocalAuth: false },
		scheduler: {
			disableDispatchers: false,
			infrequentCronJobsSchedule: "0 0 * * *",
			frequentCronJobsSchedule: "every 5 minutes",
		},
		database: {
			poolMax: 10,
			workflowPoolMax: 10,
			connectionTimeoutMs: 10_000,
			url: Redacted.make("unused"),
		},
		sandbox: {
			denoDir: "/tmp",
			jobIdSecret: Redacted.make("test-secret"),
		},
		fileStorage: {
			url: Option.none(),
			region: Option.none(),
			localDir: Option.none(),
			bucketName: Option.none(),
			accessKeyId: Option.none(),
			secretAccessKey: Option.none(),
			localSigningSecret: Option.none(),
		},
		server: {
			logLevel: "Info",
			logFile: Option.none(),
			corsOrigins: Option.none(),
			otlpEndpoint: Option.none(),
			disableNotifications: false,
			adminAccessToken: Redacted.make("unused"),
			oidc: { clientId: Option.none(), issuerUrl: Option.none(), clientSecret: Option.none() },
			smtp: {
				user: Option.none(),
				server: Option.none(),
				password: Option.none(),
				mailbox: "Ryot <no-reply@ryot.io>",
			},
		},
	} satisfies AppConfigValue;
	return Layer.succeed(AppConfig, {
		...defaults,
		...overrides,
		users: { ...defaults.users, ...overrides?.users },
		sandbox: { ...defaults.sandbox, ...overrides?.sandbox },
		frontend: { ...defaults.frontend, ...overrides?.frontend },
		database: { ...defaults.database, ...overrides?.database },
		scheduler: { ...defaults.scheduler, ...overrides?.scheduler },
		fileStorage: { ...defaults.fileStorage, ...overrides?.fileStorage },
		server: {
			...defaults.server,
			...overrides?.server,
			oidc: { ...defaults.server.oidc, ...overrides?.server?.oidc },
			smtp: { ...defaults.server.smtp, ...overrides?.server?.smtp },
		},
	});
};

export const makeWorkflowActivityEngine = (
	instance: WorkflowInstance["Service"],
	overrides: WorkflowEngineOverrides = {},
) => {
	let engine: WorkflowEngine["Service"];

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
