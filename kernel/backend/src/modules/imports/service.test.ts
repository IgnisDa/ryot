import { BunFileSystem } from "@effect/platform-bun";
import { expect, it } from "@effect/vitest";
import type { CurrentUserValue } from "@ryot-app/contract/auth-middleware";
import { SandboxRunError } from "@ryot-app/contract/errors";
import type { ListedImportRun } from "@ryot-app/contract/modules/imports/schemas";
import { ImportRunId, SandboxScriptId, UserId } from "@ryot-app/contract/schema/brands";
import { Effect, Layer, Schema } from "effect";
import { WorkflowEngine } from "effect/unstable/workflow/WorkflowEngine";
import { assert } from "vitest";

import {
	IMPORT_SOURCE_STATE_PENDING_TTL_SECONDS,
	ImportSourceStateFromJson,
	RedisService,
	redisKeys,
} from "#lib/infrastructure/redis";
import type { MockOverrides } from "#lib/test-utils/effect";
import {
	databaseLayer,
	makeAppConfigLayer,
	makeConfigProviderLayer,
	makeRedisService,
	makeWorkflowEngine,
} from "#lib/test-utils/effect";
import {
	ImportSourceCatalog,
	type RegisteredImportSource,
} from "#modules/plugins/import-source-catalog";
import { UploadIntentsService } from "#modules/uploads/intents/service";

import { ImportRunFailuresService } from "./failure-service";
import { ImportsRepository } from "./repository";
import { ImportsService, type CreateImportRunInput } from "./service";
import { ImportWorkflowPinning, type ImportWorkflowPinningValue } from "./workflow-pinning";

const now = "2026-07-16T00:00:00.000Z";
const configSchema = {
	unknownKeys: "strict",
	fields: { deltaApiKey: { type: "string", label: "Delta API key", description: "Delta API key" } },
} as const;

const uploadProperty = (extensions: ReadonlyArray<string>, required = true) => ({
	label: "Export file",
	type: "string" as const,
	description: "Export file",
	format: { kind: "upload" as const, allowedFileExtensions: extensions },
	...(required ? { validation: { minLength: 1 as const, required: true as const } } : {}),
});

const createdRun = {
	progress: 0,
	failedItems: 0,
	createdAt: now,
	updatedAt: now,
	startedAt: null,
	finishedAt: null,
	inputSummary: {},
	importedItems: 0,
	totalItems: null,
	processedItems: 0,
	failureReason: null,
	source: "beta" as const,
	status: "pending" as const,
	id: ImportRunId.make("run-1"),
} satisfies ListedImportRun;

const mockImportsRepository = Layer.mock(ImportsRepository);
const mockImportRunFailuresService = Layer.mock(ImportRunFailuresService);
const mockUploadsService = Layer.mock(UploadIntentsService);

const makeImportsRepository = (overrides: MockOverrides<typeof mockImportsRepository> = {}) =>
	mockImportsRepository({
		updateRun: () => Effect.void,
		deleteRunById: () => Effect.void,
		createRun: () => Effect.succeed(createdRun),
		...overrides,
	});

const makeImportRunFailuresService = () =>
	mockImportRunFailuresService({ create: () => Effect.void });

const importWorkflowScript = {
	source: "source",
	providerId: null,
	compiledFormat: 1,
	name: "Beta workflow",
	createdAt: new Date(0),
	updatedAt: new Date(0),
	compiledCode: "compiled",
	contentHash: "workflow-hash",
	slug: "workflow.beta-import",
	pluginId: "example-plugin-id",
	metadata: { kind: "workflow" as const },
	id: SandboxScriptId.make("accepted-import-script"),
};

const makeImportSourceCatalog = (
	registered: RegisteredImportSource | null = null,
	hasActiveWorkflow = true,
) =>
	Layer.mock(ImportSourceCatalog)({
		listForUser: () =>
			Effect.succeed(registered ? [{ hasActiveWorkflow, source: registered }] : []),
		resolveForUser: () =>
			Effect.succeed(registered ? { source: registered, script: importWorkflowScript } : null),
	});

const makeImportWorkflowPinning = (overrides: Partial<ImportWorkflowPinningValue> = {}) =>
	Layer.succeed(ImportWorkflowPinning, {
		release: () => Effect.void,
		preRegister: () => Effect.succeed({ registrationStatus: "registered" as const }),
		...overrides,
	});

const importWorkflowPinningLayer = makeImportWorkflowPinning();

const makeServiceLayer = (
	repository = makeImportsRepository(),
	dependencies: Layer.Layer<
		UploadIntentsService | ImportSourceCatalog | WorkflowEngine
	> = Layer.mergeAll(
		makeImportSourceCatalog(),
		mockUploadsService({}),
		Layer.succeed(WorkflowEngine, makeWorkflowEngine()),
	),
	pinning = importWorkflowPinningLayer,
	redis = makeRedisService(),
) =>
	ImportsService.layer.pipe(
		Layer.provideMerge(
			Layer.mergeAll(
				BunFileSystem.layer,
				databaseLayer,
				makeAppConfigLayer(),
				pinning,
				Layer.succeed(RedisService, redis),
				makeImportRunFailuresService(),
				dependencies,
				repository,
			),
		),
	);

const user: CurrentUserValue = {
	image: null,
	name: "Test User",
	email: "user@example.com",
	id: UserId.make("user-1"),
	preferences: { language: null, allowNsfw: false, disableIntegrations: false },
};

const betaSource = (overrides: Partial<RegisteredImportSource> = {}): RegisteredImportSource => ({
	configSchema,
	slug: "beta",
	name: "Beta",
	pluginSlug: "example",
	pluginScope: "system",
	description: "Beta export",
	workflowSlug: "beta-import",
	requiredPluginConfigKeys: [],
	pluginId: "example-plugin-id",
	installationId: "example-installation",
	configContext: { configSchema, kind: "environment", pluginSlug: "example" },
	inputSchema: { unknownKeys: "strict", fields: { uploadToken: uploadProperty(["csv"]) } },
	...overrides,
});

const payloadSource = betaSource({
	inputSchema: {
		unknownKeys: "strict",
		fields: {
			apiKey: {
				secret: true,
				type: "string",
				label: "API key",
				description: "API key",
				validation: { required: true },
			},
		},
	},
});

it.effect("delegates import run CRUD through the canonical service methods", () => {
	let createdInput: unknown;
	const updates: Array<Record<string, unknown>> = [];
	let deletedInput: unknown;
	const layer = makeServiceLayer(
		makeImportsRepository({
			updateRun: (input) => Effect.sync(() => void updates.push(input)),
			deleteRunById: (input) => Effect.sync(() => void (deletedInput = input)),
			createRun: (input) =>
				Effect.sync(() => {
					createdInput = input;
					return createdRun;
				}),
		}),
	);

	return Effect.gen(function* () {
		const service = yield* ImportsService;
		const createInput = {
			source: "beta" as const,
			userId: UserId.make("user-1"),
			inputSummary: { source: "test" },
			pluginInstallationId: "example-installation",
		} satisfies CreateImportRunInput;

		const run = yield* service.create(createInput);
		yield* service.update({ progress: 25, runId: run.id, status: "running" });
		yield* service.delete({ runId: run.id, userId: createInput.userId });

		expect(createdInput).toEqual(createInput);
		expect(updates).toEqual([{ progress: 25, runId: "run-1", status: "running" }]);
		expect(deletedInput).toEqual({ runId: "run-1", userId: "user-1" });
	}).pipe(Effect.provide(layer));
});

it.effect("validates extensions against the claimed original file name", () => {
	const deletedIntentIds: string[] = [];
	const layer = makeServiceLayer(
		makeImportsRepository(),
		Layer.mergeAll(
			makeImportSourceCatalog(
				betaSource({
					inputSchema: { unknownKeys: "strict", fields: { uploadToken: uploadProperty(["json"]) } },
				}),
			),
			mockUploadsService({
				deleteTemporaryUpload: (intentId) =>
					Effect.sync(() => void deletedIntentIds.push(intentId)),
				claimTemporaryUpload: () =>
					Effect.succeed({
						leaseExpiresAt: now,
						intentId: "intent-beta",
						fileName: "beta-export.csv",
						resolvedPath: "/tmp/random-object.json",
						locator: { type: "local" as const, key: "temporary/random-object.json" },
					}),
			}),
			Layer.succeed(WorkflowEngine, makeWorkflowEngine()),
		),
	);

	return Effect.gen(function* () {
		const error = yield* Effect.flip(
			(yield* ImportsService).startImportRun(user, { source: "beta", uploadToken: "tok_beta" }),
		);
		expect(error).toMatchObject({
			reason: { allowedExtensions: ["json"], code: "unsupported-file-extension" },
		});
		expect(deletedIntentIds).toEqual(["intent-beta"]);
	}).pipe(Effect.provide(layer));
});

it.effect("rejects temporary uploads claimed from S3 storage", () => {
	const deletedIntentIds: string[] = [];
	const layer = makeServiceLayer(
		makeImportsRepository(),
		Layer.mergeAll(
			makeImportSourceCatalog(betaSource()),
			mockUploadsService({
				deleteTemporaryUpload: (intentId) =>
					Effect.sync(() => void deletedIntentIds.push(intentId)),
				claimTemporaryUpload: () =>
					Effect.succeed({
						leaseExpiresAt: now,
						fileName: "beta.csv",
						intentId: "intent-s3",
						locator: { type: "s3" as const, key: "temporary/object.csv" },
					}),
			}),
			Layer.succeed(WorkflowEngine, makeWorkflowEngine()),
		),
	);

	return Effect.gen(function* () {
		const error = yield* Effect.flip(
			(yield* ImportsService).startImportRun(user, { source: "beta", uploadToken: "tok_s3" }),
		);
		expect(error).toMatchObject({ reason: { field: "uploadToken", code: "upload-unavailable" } });
		expect(deletedIntentIds).toEqual(["intent-s3"]);
	}).pipe(Effect.provide(layer));
});

it.effect("claims only the visible upload from mutually exclusive required fields", () => {
	const executed: unknown[] = [];
	const stored: Array<{ key: string; ttlSeconds: number | undefined; value: string }> = [];
	const claims: Array<{ claimId: string | undefined; token: string }> = [];
	let createdInput: CreateImportRunInput | undefined;
	let updatedInput: unknown;
	const source = betaSource({
		slug: "movary",
		name: "Movary",
		workflowSlug: "movary-import",
		inputSchema: {
			unknownKeys: "strict",
			rules: [
				{
					kind: "visibility",
					path: ["ratingsUploadToken"],
					visibility: { hidden: true },
					when: { operator: "eq", path: ["mode"], value: "history" },
				},
				{
					kind: "visibility",
					path: ["historyUploadToken"],
					visibility: { hidden: true },
					when: { operator: "eq", path: ["mode"], value: "ratings" },
				},
			],
			fields: {
				historyUploadToken: uploadProperty(["csv"]),
				ratingsUploadToken: uploadProperty(["csv"]),
				apiKey: {
					secret: true,
					type: "string",
					label: "API key",
					description: "API key",
					validation: { required: true },
				},
				mode: {
					type: "enum",
					label: "Import mode",
					description: "Import mode",
					validation: { required: true },
					choices: { kind: "static", values: [{ value: "history" }, { value: "ratings" }] },
				},
			},
		},
	});
	const layer = makeServiceLayer(
		makeImportsRepository({
			updateRun: (input) => Effect.sync(() => void (updatedInput = input)),
			createRun: (input) =>
				Effect.sync(() => {
					createdInput = input;
					return createdRun;
				}),
		}),
		Layer.mergeAll(
			makeImportSourceCatalog(source),
			mockUploadsService({
				deleteTemporaryUpload: () => Effect.sync(() => undefined),
				claimTemporaryUpload: (token, _userId, claimId) =>
					Effect.sync(() => {
						claims.push({ token, claimId });
						return {
							leaseExpiresAt: now,
							intentId: `intent-${token}`,
							fileName: `${token}-original.csv`,
							resolvedPath: `/tmp/${token}.csv`,
							locator: { type: "local" as const, key: `temporary/${token}.csv` },
						};
					}),
			}),
			Layer.succeed(
				WorkflowEngine,
				makeWorkflowEngine({
					execute: (_workflow, options) => Effect.sync(() => void executed.push(options)),
				}),
			),
		),
		importWorkflowPinningLayer,
		makeRedisService({
			set: (key, value, ttlSeconds) =>
				Effect.sync(() => void stored.push({ key, value, ttlSeconds })),
		}),
	);

	return Effect.gen(function* () {
		yield* (yield* ImportsService).startImportRun(user, {
			mode: "history",
			source: "movary",
			apiKey: "file-source-secret",
			historyUploadToken: "history",
		});

		expect(claims).toEqual([{ claimId: "run-1", token: "history" }]);
		expect(createdInput?.inputSummary).toEqual({ source: "movary" });
		expect(updatedInput).toEqual({
			runId: "run-1",
			inputSummary: { source: "movary", fileNames: { historyUploadToken: "history-original.csv" } },
		});
		expect(executed[0]).toMatchObject({
			payload: { runId: "run-1", userId: "user-1", sourceStateId: "run-1" },
		});
		expect(executed[0]).not.toHaveProperty("payload.sourcePayload");
		expect(executed[0]).not.toHaveProperty("payload.namedArtifactPaths");
		expect(stored).toHaveLength(1);
		expect(stored[0]).toMatchObject({
			key: redisKeys.importSourceState("run-1"),
			ttlSeconds: IMPORT_SOURCE_STATE_PENDING_TTL_SECONDS,
		});
		assert(stored[0]);
		expect(yield* Schema.decodeUnknownEffect(ImportSourceStateFromJson)(stored[0].value)).toEqual({
			source: "movary",
			pluginId: "example-plugin-id",
			uploadIntentIds: ["intent-history"],
			workflowScriptId: "accepted-import-script",
			pluginInstallationId: "example-installation",
			namedArtifactPaths: { historyUploadToken: "/tmp/history.csv" },
			sourcePayload: {
				mode: "history",
				apiKey: "file-source-secret",
				historyUploadToken: "historyUploadToken",
			},
		});
	}).pipe(Effect.provide(layer));
});

it.effect("rejects undeclared upload token fields before claims or work", () => {
	const layer = makeServiceLayer(
		makeImportsRepository(),
		Layer.mergeAll(
			makeImportSourceCatalog(betaSource()),
			mockUploadsService({ claimTemporaryUpload: () => Effect.die("must not claim") }),
			Layer.succeed(
				WorkflowEngine,
				makeWorkflowEngine({ execute: () => Effect.die("must not start") }),
			),
		),
	);

	return Effect.gen(function* () {
		const error = yield* Effect.flip(
			(yield* ImportsService).startImportRun(user, {
				source: "beta",
				uploadToken: "beta",
				historyUploadToken: "history",
			}),
		);
		expect(error).toMatchObject({ reason: { field: null, code: "invalid-input" } });
	}).pipe(Effect.provide(layer));
});

it.effect("rejects a source whose declared plugin config keys are unset", () => {
	const layer = makeServiceLayer(
		makeImportsRepository(),
		Layer.mergeAll(
			makeImportSourceCatalog(betaSource({ requiredPluginConfigKeys: ["deltaApiKey"] })),
			mockUploadsService({ claimTemporaryUpload: () => Effect.die("must not claim") }),
			Layer.succeed(WorkflowEngine, makeWorkflowEngine()),
		),
	);

	return Effect.gen(function* () {
		const error = yield* Effect.flip(
			(yield* ImportsService).startImportRun(user, { source: "beta", uploadToken: "beta" }),
		);
		expect(error).toMatchObject({
			reason: {
				source: "beta",
				code: "source-not-configured",
				missingConfigKeys: ["RYOT_PLUGIN_EXAMPLE_DELTA_API_KEY"],
			},
		});
	}).pipe(Effect.provide(Layer.mergeAll(layer, makeConfigProviderLayer())));
});

it.effect("lists manifest sources with workflow and config availability", () => {
	const source = betaSource({ requiredPluginConfigKeys: ["deltaApiKey"] });
	const layer = makeServiceLayer(
		makeImportsRepository(),
		Layer.mergeAll(
			makeImportSourceCatalog(source, false),
			mockUploadsService({}),
			Layer.succeed(WorkflowEngine, makeWorkflowEngine()),
		),
	);

	return Effect.gen(function* () {
		const sources = yield* (yield* ImportsService).listImportSources(user);
		expect(sources).toEqual([
			{
				name: "Beta",
				slug: "beta",
				isStartable: false,
				pluginSlug: "example",
				description: "Beta export",
				workflowSlug: "beta-import",
				inputSchema: source.inputSchema,
				requiredPluginConfigKeys: ["deltaApiKey"],
				missingPluginConfigKeys: ["RYOT_PLUGIN_EXAMPLE_DELTA_API_KEY"],
			},
		]);
		expect(sources[0]).not.toHaveProperty("configSchema");
	}).pipe(Effect.provide(Layer.mergeAll(layer, makeConfigProviderLayer())));
});

it.effect("lists a configured source with an active workflow as startable", () => {
	const source = betaSource();
	const layer = makeServiceLayer(
		makeImportsRepository(),
		Layer.mergeAll(
			makeImportSourceCatalog(source),
			mockUploadsService({}),
			Layer.succeed(WorkflowEngine, makeWorkflowEngine()),
		),
	);

	return Effect.gen(function* () {
		expect(yield* (yield* ImportsService).listImportSources(user)).toMatchObject([
			{ slug: "beta", isStartable: true, missingPluginConfigKeys: [] },
		]);
	}).pipe(Effect.provide(Layer.mergeAll(layer, makeConfigProviderLayer())));
});

it.effect("hides and rejects import sources from an unavailable system installation", () => {
	const source = betaSource();
	const layer = makeServiceLayer(
		makeImportsRepository({ createRun: () => Effect.die("run must not be created") }),
		Layer.mergeAll(
			makeImportSourceCatalog(),
			mockUploadsService({ claimTemporaryUpload: () => Effect.die("must not claim") }),
			Layer.succeed(
				WorkflowEngine,
				makeWorkflowEngine({ execute: () => Effect.die("must not start") }),
			),
		),
	);

	return Effect.gen(function* () {
		const service = yield* ImportsService;
		expect(yield* service.listImportSources(user)).toEqual([]);
		const error = yield* Effect.flip(service.startImportRun(user, { source: source.slug }));
		expect(error).toMatchObject({ reason: { source: source.slug, code: "source-not-found" } });
	}).pipe(Effect.provide(Layer.mergeAll(layer, makeConfigProviderLayer())));
});

it.effect("stores decoded payload credentials without exposing them in the input summary", () => {
	const executed: unknown[] = [];
	const stored: string[] = [];
	let createdInput: CreateImportRunInput | undefined;
	const layer = makeServiceLayer(
		makeImportsRepository({
			createRun: (input) =>
				Effect.sync(() => {
					createdInput = input;
					return createdRun;
				}),
		}),
		Layer.mergeAll(
			makeImportSourceCatalog(payloadSource),
			mockUploadsService({}),
			Layer.succeed(
				WorkflowEngine,
				makeWorkflowEngine({
					execute: (_workflow, options) => Effect.sync(() => void executed.push(options)),
				}),
			),
		),
		importWorkflowPinningLayer,
		makeRedisService({ set: (_key, value) => Effect.sync(() => void stored.push(value)) }),
	);

	return Effect.gen(function* () {
		expect(
			yield* (yield* ImportsService).startImportRun(user, { source: "beta", apiKey: "secret" }),
		).toEqual({ id: "run-1" });
		expect(createdInput?.inputSummary).toEqual({ source: "beta" });
		const [options] = executed;
		assert(options !== undefined);
		expect(options).toMatchObject({
			payload: { runId: "run-1", userId: "user-1", sourceStateId: "run-1" },
		});
		expect(options).not.toHaveProperty("payload.sourcePayload");
		expect(options).not.toHaveProperty("payload.apiKey");
		assert(stored[0]);
		expect(yield* Schema.decodeUnknownEffect(ImportSourceStateFromJson)(stored[0])).toMatchObject({
			sourcePayload: { apiKey: "secret" },
		});
	}).pipe(Effect.provide(layer));
});

it.effect("deletes pending source state when workflow dispatch fails", () => {
	const deletedKeys: string[][] = [];
	const layer = makeServiceLayer(
		makeImportsRepository(),
		Layer.mergeAll(
			makeImportSourceCatalog(payloadSource),
			mockUploadsService({}),
			Layer.succeed(
				WorkflowEngine,
				makeWorkflowEngine({ execute: () => Effect.fail("dispatch failed") }),
			),
		),
		importWorkflowPinningLayer,
		makeRedisService({
			set: () => Effect.void,
			del: (...keys) =>
				Effect.sync(() => {
					deletedKeys.push([...keys]);
					return keys.length;
				}),
		}),
	);

	return Effect.gen(function* () {
		const error = yield* Effect.flip(
			(yield* ImportsService).startImportRun(user, { source: "beta", apiKey: "secret" }),
		);

		expect(error).toMatchObject({ reason: { operation: "import-run", code: "queue-unavailable" } });
		expect(deletedKeys).toEqual([[redisKeys.importSourceState("run-1")]]);
	}).pipe(Effect.provide(layer));
});

it.effect("records the resolving installation on the run and its durable source state", () => {
	const stored: string[] = [];
	let createdInput: CreateImportRunInput | undefined;
	const source = betaSource({
		pluginScope: "user",
		pluginSlug: "my-example",
		pluginId: "private-plugin-id",
		installationId: "private-installation",
		inputSchema: { fields: {}, unknownKeys: "strict" },
		configContext: { config: {}, configSchema, kind: "installation" },
	});
	const layer = makeServiceLayer(
		makeImportsRepository({
			createRun: (input) =>
				Effect.sync(() => {
					createdInput = input;
					return createdRun;
				}),
		}),
		Layer.mergeAll(
			makeImportSourceCatalog(source),
			mockUploadsService({}),
			Layer.succeed(WorkflowEngine, makeWorkflowEngine({ execute: () => Effect.void })),
		),
		importWorkflowPinningLayer,
		makeRedisService({ set: (_key, value) => Effect.sync(() => void stored.push(value)) }),
	);

	return Effect.gen(function* () {
		yield* (yield* ImportsService).startImportRun(user, { source: "beta" });

		expect(createdInput?.pluginInstallationId).toBe("private-installation");
		assert(stored[0]);
		expect(yield* Schema.decodeUnknownEffect(ImportSourceStateFromJson)(stored[0])).toMatchObject({
			pluginId: "private-plugin-id",
			workflowScriptId: "accepted-import-script",
			pluginInstallationId: "private-installation",
		});
	}).pipe(Effect.provide(layer));
});

it.effect("rolls back uploads, source state, and the pin when file dispatch fails", () => {
	const released: string[] = [];
	const deletedKeys: string[][] = [];
	const deletedIntentIds: string[] = [];
	const updates: Array<Record<string, unknown>> = [];
	let deletedRun: unknown;
	const layer = makeServiceLayer(
		makeImportsRepository({
			updateRun: (input) => Effect.sync(() => void updates.push(input)),
			deleteRunById: (input) => Effect.sync(() => void (deletedRun = input)),
		}),
		Layer.mergeAll(
			makeImportSourceCatalog(betaSource()),
			mockUploadsService({
				deleteTemporaryUpload: (intentId) =>
					Effect.sync(() => void deletedIntentIds.push(intentId)),
				claimTemporaryUpload: () =>
					Effect.succeed({
						leaseExpiresAt: now,
						intentId: "intent-beta",
						fileName: "beta-export.csv",
						resolvedPath: "/tmp/beta-export.csv",
						locator: { type: "local" as const, key: "temporary/beta-export.csv" },
					}),
			}),
			Layer.succeed(
				WorkflowEngine,
				makeWorkflowEngine({ execute: () => Effect.fail("dispatch failed") }),
			),
		),
		makeImportWorkflowPinning({
			release: (executionId) => Effect.sync(() => void released.push(executionId)),
		}),
		makeRedisService({
			set: () => Effect.void,
			del: (...keys) =>
				Effect.sync(() => {
					deletedKeys.push([...keys]);
					return keys.length;
				}),
		}),
	);

	return Effect.gen(function* () {
		const error = yield* Effect.flip(
			(yield* ImportsService).startImportRun(user, { source: "beta", uploadToken: "tok_beta" }),
		);

		expect(error).toMatchObject({ reason: { operation: "import-run", code: "queue-unavailable" } });
		expect(released).toEqual(["run-1-import"]);
		expect(deletedIntentIds).toEqual(["intent-beta"]);
		expect(deletedKeys).toEqual([[redisKeys.importSourceState("run-1")]]);
		expect(deletedRun).toBeUndefined();
		expect(updates.at(-1)).toMatchObject({
			runId: "run-1",
			status: "failed",
			failureReason: { operation: "workflow", code: "queue-unavailable" },
		});
	}).pipe(Effect.provide(layer));
});

it.effect("cleans up claimed uploads without releasing a pin that never registered", () => {
	const released: string[] = [];
	const deletedIntentIds: string[] = [];
	const updates: Array<Record<string, unknown>> = [];
	const layer = makeServiceLayer(
		makeImportsRepository({ updateRun: (input) => Effect.sync(() => void updates.push(input)) }),
		Layer.mergeAll(
			makeImportSourceCatalog(betaSource()),
			mockUploadsService({
				deleteTemporaryUpload: (intentId) =>
					Effect.sync(() => void deletedIntentIds.push(intentId)),
				claimTemporaryUpload: () =>
					Effect.succeed({
						leaseExpiresAt: now,
						intentId: "intent-beta",
						fileName: "beta-export.csv",
						resolvedPath: "/tmp/beta-export.csv",
						locator: { type: "local" as const, key: "temporary/beta-export.csv" },
					}),
			}),
			Layer.succeed(
				WorkflowEngine,
				makeWorkflowEngine({ execute: () => Effect.die("must not start") }),
			),
		),
		makeImportWorkflowPinning({
			preRegister: () => new SandboxRunError({ message: "pin unavailable" }),
			release: (executionId) => Effect.sync(() => void released.push(executionId)),
		}),
		makeRedisService({
			set: () => Effect.die("must not store source state"),
			del: () => Effect.die("must not delete source state"),
		}),
	);

	return Effect.gen(function* () {
		const error = yield* Effect.flip(
			(yield* ImportsService).startImportRun(user, { source: "beta", uploadToken: "tok_beta" }),
		);

		expect(error).toMatchObject({ reason: { operation: "import-run", code: "queue-unavailable" } });
		expect(released).toEqual([]);
		expect(deletedIntentIds).toEqual(["intent-beta"]);
		expect(updates.at(-1)).toMatchObject({
			runId: "run-1",
			status: "failed",
			failureReason: { code: "queue-unavailable", operation: "workflow-pin" },
		});
	}).pipe(Effect.provide(layer));
});

it.effect("leaves an already-registered pin in place while rolling back source state", () => {
	const released: string[] = [];
	const deletedKeys: string[][] = [];
	const layer = makeServiceLayer(
		makeImportsRepository(),
		Layer.mergeAll(
			makeImportSourceCatalog(payloadSource),
			mockUploadsService({}),
			Layer.succeed(
				WorkflowEngine,
				makeWorkflowEngine({ execute: () => Effect.fail("dispatch failed") }),
			),
		),
		makeImportWorkflowPinning({
			release: (executionId) => Effect.sync(() => void released.push(executionId)),
			preRegister: () => Effect.succeed({ registrationStatus: "already-registered" as const }),
		}),
		makeRedisService({
			set: () => Effect.void,
			del: (...keys) =>
				Effect.sync(() => {
					deletedKeys.push([...keys]);
					return keys.length;
				}),
		}),
	);

	return Effect.gen(function* () {
		const error = yield* Effect.flip(
			(yield* ImportsService).startImportRun(user, { source: "beta", apiKey: "secret" }),
		);

		expect(error).toMatchObject({ reason: { operation: "import-run", code: "queue-unavailable" } });
		expect(released).toEqual([]);
		expect(deletedKeys).toEqual([[redisKeys.importSourceState("run-1")]]);
	}).pipe(Effect.provide(layer));
});
