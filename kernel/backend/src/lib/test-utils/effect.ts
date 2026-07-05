import { ConfigProvider, Effect, Layer, Option, Redacted } from "effect";
import { Workflow } from "effect/unstable/workflow";
import {
	layerMemory as workflowEngineMemoryLayer,
	WorkflowEngine,
	WorkflowInstance,
} from "effect/unstable/workflow/WorkflowEngine";

import { AppConfig, type AppConfigValue } from "#lib/infrastructure/config/service";
import { Database } from "#lib/infrastructure/db/service";
import type { RedisService } from "#lib/infrastructure/redis";
import { detachDiscardedWorkflowChildren } from "#lib/infrastructure/workflow";

export type MockOverrides<T> = T extends (...args: infer TArgs) => unknown
	? Omit<TArgs[0], "_tag">
	: never;

type TransactionDatabase = Parameters<Parameters<Database["Service"]["transaction"]>[0]>[0];

const transactionDatabase: TransactionDatabase = Object.assign(Object.create(null), {
	execute: () => Effect.succeed([]),
	select: () => ({ from: () => ({ where: () => ({ limit: () => Effect.succeed([]) }) }) }),
});

export const databaseLayer = Layer.succeed(
	Database,
	Database.of(
		Object.assign(Object.create(null), {
			transaction: ((callback) =>
				callback(transactionDatabase)) satisfies Database["Service"]["transaction"],
		}),
	),
);

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
			deferredDone: () => Effect.die("unused"),
			scheduleClock: () => Effect.die("unused"),
			deferredResult: () => Effect.die("unused"),
			interruptUnsafe: () => Effect.die("unused"),
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
		zadd: () => Effect.die("unused"),
		zrem: () => Effect.die("unused"),
		claim: () => Effect.die("unused"),
		publish: () => Effect.die("unused"),
		renewLease: () => Effect.die("unused"),
		setAndIndex: () => Effect.die("unused"),
		acquireLease: () => Effect.die("unused"),
		releaseLease: () => Effect.die("unused"),
		zrangeByScore: () => Effect.die("unused"),
		setAndIndexAndSet: () => Effect.die("unused"),
		setAndIndexAndDelete: () => Effect.die("unused"),
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
		nodeEnv: "test",
		timezone: "Etc/GMT",
		disableTelemetry: false,
		redisUrl: Redacted.make("unused"),
		frontendUrl: "http://localhost:3000",
		sandbox: { denoDir: "./tmp", processMode: "on-demand" },
		users: { allowRegistration: true, disableLocalAuth: false },
		database: { poolMax: 10, connectionTimeoutMs: 10_000, url: Redacted.make("unused") },
		frontend: {
			oidcButtonLabel: Option.none(),
			umami: { hostUrl: Option.none(), websiteId: Option.none() },
		},
		scheduler: {
			disableDispatchers: false,
			infrequentCronJobsSchedule: "0 0 * * *",
			frequentCronJobsSchedule: "every 5 minutes",
		},
		fileStorage: {
			url: Option.none(),
			region: Option.none(),
			localDir: "./storage",
			localTempDir: "./work",
			bucketName: Option.none(),
			accessKeyId: Option.none(),
			secretAccessKey: Option.none(),
		},
		server: {
			logLevel: "Info",
			proKey: Option.none(),
			clientDir: "./client",
			logFile: Option.none(),
			otlpHeaders: Option.none(),
			otlpEndpoint: Option.none(),
			disableNotifications: false,
			pluginsSystemDir: "./plugins",
			proKeyVerificationUrl: "https://api.unkey.com",
			adminAccessToken: Redacted.make("test-admin-token"),
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
		database: { ...defaults.database, ...overrides?.database },
		scheduler: { ...defaults.scheduler, ...overrides?.scheduler },
		fileStorage: { ...defaults.fileStorage, ...overrides?.fileStorage },
		frontend: {
			...defaults.frontend,
			...overrides?.frontend,
			umami: { ...defaults.frontend.umami, ...overrides?.frontend?.umami },
		},
		server: {
			...defaults.server,
			...overrides?.server,
			oidc: { ...defaults.server.oidc, ...overrides?.server?.oidc },
			smtp: { ...defaults.server.smtp, ...overrides?.server?.smtp },
		},
	});
};

export const makeConfigProviderLayer = (values: Readonly<Record<string, unknown>> = {}) =>
	ConfigProvider.layer(ConfigProvider.fromUnknown(values));

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
