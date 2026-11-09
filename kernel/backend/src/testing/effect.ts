import { BunCrypto } from "@effect/platform-bun";
import { partialFake } from "@ryot-app/testing/fakes";
import type { EffectPgDatabase } from "drizzle-orm/effect-postgres";
import { ConfigProvider, Context, Effect, Layer, Option, Redacted } from "effect";
import { Workflow } from "effect/workflow";
import {
	layerMemory as workflowEngineMemoryLayer,
	WorkflowEngine,
	WorkflowInstance,
} from "effect/workflow/WorkflowEngine";

import { AppConfig, type AppConfigValue } from "#platform/config/service";
import { mapDatabaseErrors } from "#platform/db/errors";
import {
	DatabaseSession,
	DatabaseSessionStateError,
	userWriteLockStatement,
} from "#platform/db/session";
import { WorkflowAccounts } from "#platform/workflow/account";
import { testPgClientLayer } from "#testing/database";

export type MockOverrides<T> = T extends (...args: infer TArgs) => unknown
	? Omit<TArgs[0], "_tag">
	: never;

export const testExecutionId = (label: string) => `${label}-${crypto.randomUUID()}`;

export const databaseLayer = Layer.effect(DatabaseSession, DatabaseSession.make).pipe(
	Layer.provideMerge(testPgClientLayer()),
	Layer.provideMerge(BunCrypto.layerSecureRandom),
);

export const fakeDatabaseSession = (
	database: object,
	overrides: Partial<DatabaseSession["Service"]> = {},
): Layer.Layer<DatabaseSession> => {
	const executor = partialFake<EffectPgDatabase>(database);
	const active = Context.Reference<boolean>("test/FakeDatabaseSessionTransaction", {
		defaultValue: () => false,
	});
	const requireRoot = Effect.flatMap(active, (inTransaction) =>
		inTransaction
			? Effect.fail(new DatabaseSessionStateError({ reason: "transaction-already-active" }))
			: Effect.void,
	);
	const requireTransaction = Effect.flatMap(active, (inTransaction) =>
		inTransaction
			? Effect.void
			: Effect.fail(new DatabaseSessionStateError({ reason: "transaction-required" })),
	);
	const run: DatabaseSession["Service"]["run"] = (statement) =>
		mapDatabaseErrors(statement(executor));
	return Layer.mock(DatabaseSession)({
		run,
		requireRoot,
		requireTransaction,
		detached: (work) => work,
		isTransactionActive: active,
		carry: Effect.succeed((work) => work),
		acquireUserWriteLock: (userId) => Effect.asVoid(run(userWriteLockStatement(userId))),
		transaction: (work) =>
			requireRoot.pipe(
				Effect.andThen(mapDatabaseErrors(work.pipe(Effect.provideService(active, true)))),
			),
		...overrides,
	});
};

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

// Account ownership needs the PostgreSQL engine; with the memory engine every execution is unowned.
export const workflowAccountsTestService = WorkflowAccounts.of({
	adopt: () => Effect.void,
	listActive: () => Effect.succeed([]),
});

export const workflowAccountsTestLayer = Layer.succeed(
	WorkflowAccounts,
	workflowAccountsTestService,
);

export const workflowEngineTestLayer = Layer.merge(
	workflowEngineMemoryLayer,
	workflowAccountsTestLayer,
);

type ConfigLeafValue = Option.Option<unknown> | ReadonlyArray<unknown> | Redacted.Redacted<unknown>;

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
		frontendUrl: "http://localhost:3000",
		database: { connectionTimeoutMs: 10_000, url: Redacted.make("unused") },
		fileStorage: { s3: Option.none(), localDir: "./storage", localTempDir: "./work" },
		users: { disableLocalAuth: false, allowRegistration: true, demoAccountId: Option.none() },
		frontend: {
			oidcButtonLabel: Option.none(),
			umami: { hostUrl: Option.none(), websiteId: Option.none() },
		},
		automations: {
			maxDepth: 8,
			maxRuns: 100,
			batchMaxItems: 200,
			retryWindowDays: 7,
			historyRetentionDays: 30,
		},
		sandbox: {
			importConcurrency: 2,
			workerConcurrency: 2,
			perUserSidecars: false,
			memoryBudgetMiB: Option.none(),
		},
		scheduler: {
			disableDispatchers: false,
			infrequentCronJobsSchedule: "0 0 * * *",
			frequentCronJobsSchedule: "every 5 minutes",
		},
		observability: {
			otlp: { headers: Option.none(), endpoint: Option.none() },
			logging: {
				level: "Info",
				file: { rotationSize: "10M", rotationInterval: "1d", path: "./logs/ryot.log" },
			},
		},
		server: {
			trustedProxies: [],
			oidc: Option.none(),
			smtp: Option.none(),
			proKey: Option.none(),
			clientDir: "./client",
			egressAllowedNetworks: [],
			disablePublications: false,
			disableNotifications: false,
			pluginsSystemDir: "./plugins",
			proKeyVerificationUrl: "https://api.unkey.com",
			adminAccessToken: Redacted.make("test-admin-token"),
		},
	} satisfies AppConfigValue;
	return Layer.succeed(AppConfig, {
		...defaults,
		...overrides,
		users: { ...defaults.users, ...overrides?.users },
		server: { ...defaults.server, ...overrides?.server },
		sandbox: { ...defaults.sandbox, ...overrides?.sandbox },
		database: { ...defaults.database, ...overrides?.database },
		scheduler: { ...defaults.scheduler, ...overrides?.scheduler },
		automations: { ...defaults.automations, ...overrides?.automations },
		fileStorage: { ...defaults.fileStorage, ...overrides?.fileStorage },
		frontend: {
			...defaults.frontend,
			...overrides?.frontend,
			umami: { ...defaults.frontend.umami, ...overrides?.frontend?.umami },
		},
		observability: {
			...defaults.observability,
			...overrides?.observability,
			otlp: { ...defaults.observability.otlp, ...overrides?.observability?.otlp },
			logging: {
				...defaults.observability.logging,
				...overrides?.observability?.logging,
				file: {
					...defaults.observability.logging.file,
					...overrides?.observability?.logging?.file,
				},
			},
		},
	});
};

export const makeConfigProviderLayer = (values: Readonly<Record<string, unknown>> = {}) =>
	ConfigProvider.layer(ConfigProvider.fromUnknown(values));

export const makeRequiredConfigLayer = (values: Readonly<Record<string, unknown>> = {}) =>
	makeConfigProviderLayer({
		DATABASE_URL: "unused",
		SERVER_ADMIN_ACCESS_TOKEN: "unused",
		...values,
	});

export const makeMemoizingWorkflowEngine = (
	instance: WorkflowInstance["Service"],
	activityRuns: string[],
) => {
	const results = new Map<string, Workflow.Complete<unknown, unknown>>();
	let engine: WorkflowEngine["Service"];

	engine = makeWorkflowEngine({
		activityExecute: (activity) =>
			Effect.gen(function* () {
				const stored = results.get(activity.name);
				if (stored) {
					return stored;
				}
				activityRuns.push(activity.name);
				const exit = yield* Effect.exit(
					activity.execute.pipe(
						Effect.provideService(WorkflowEngine, engine),
						Effect.provideService(WorkflowInstance, instance),
					),
				);
				const complete = new Workflow.Complete({ exit });
				results.set(activity.name, complete);
				return complete;
			}),
	});

	return engine;
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
