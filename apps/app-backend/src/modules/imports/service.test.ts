import { BunFileSystem } from "@effect/platform-bun";
import { expect, it } from "@effect/vitest";
import type { CurrentUserValue } from "@ryot/contract/auth-middleware";
import type { ListedImportRun } from "@ryot/contract/modules/imports/schemas";
import { ImportRunId, SandboxScriptId, UserId } from "@ryot/contract/schema/brands";
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
import { PluginRuntimeResolver } from "#modules/plugins/runtime-resolver";
import { UploadIntentsService } from "#modules/uploads/intents/service";

import { ImportRunFailuresService } from "./failure-service";
import { ImportsRepository } from "./repository";
import { ImportsService, type CreateImportRunInput } from "./service";
import { ImportWorkflowPinning } from "./workflow-pinning";

const now = "2026-07-16T00:00:00.000Z";
const configSchema = {
	unknownKeys: "strict",
	fields: {
		hardcoverApiKey: {
			type: "string",
			label: "Hardcover API key",
			description: "Hardcover API key",
		},
	},
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
	status: "pending" as const,
	source: "goodreads" as const,
	id: ImportRunId.make("run-1"),
} satisfies ListedImportRun;

const mockImportsRepository = Layer.mock(ImportsRepository);
const mockImportRunFailuresService = Layer.mock(ImportRunFailuresService);
const mockUploadsService = Layer.mock(UploadIntentsService);

const makeImportsRepository = (overrides: MockOverrides<typeof mockImportsRepository> = {}) =>
	mockImportsRepository({
		createRun: () => Effect.succeed(createdRun),
		updateRun: () => Effect.void,
		deleteRunById: () => Effect.void,
		...overrides,
	});

const makeImportRunFailuresService = () =>
	mockImportRunFailuresService({ create: () => Effect.void });

const makeImportSourceCatalog = (
	registered: RegisteredImportSource | null = null,
	hasActiveWorkflow = true,
) =>
	Layer.mock(ImportSourceCatalog)({
		listWithWorkflowStatus: Effect.succeed(
			registered ? [{ source: registered, hasActiveWorkflow }] : [],
		),
		resolve: () =>
			registered
				? {
						source: registered,
						script: Effect.succeed({
							id: SandboxScriptId.make("accepted-import-script"),
						}),
					}
				: null,
	});

const importWorkflowPinningLayer = Layer.succeed(ImportWorkflowPinning, {
	preRegister: () => Effect.succeed({ registrationStatus: "registered" as const }),
	release: () => Effect.void,
});

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
	pluginRuntime = Layer.mock(PluginRuntimeResolver)({
		isSystemPluginAvailableToUser: () => Effect.succeed(true),
	}),
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
				pluginRuntime,
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
	preferences: { allowNsfw: false, language: null, disableIntegrations: false },
};

const goodreadsSource = (
	overrides: Partial<RegisteredImportSource> = {},
): RegisteredImportSource => ({
	configSchema,
	slug: "goodreads",
	name: "Goodreads",
	pluginSlug: "media",
	requiredPluginConfigKeys: [],
	description: "Goodreads export",
	workflowSlug: "goodreads-import",
	inputSchema: { unknownKeys: "strict", fields: { uploadToken: uploadProperty(["csv"]) } },
	...overrides,
});

it.effect("delegates import run CRUD through the canonical service methods", () => {
	let createdInput: unknown;
	const updates: Array<Record<string, unknown>> = [];
	let deletedInput: unknown;
	const layer = makeServiceLayer(
		makeImportsRepository({
			createRun: (input) =>
				Effect.sync(() => {
					createdInput = input;
					return createdRun;
				}),
			updateRun: (input) => Effect.sync(() => void updates.push(input)),
			deleteRunById: (input) => Effect.sync(() => void (deletedInput = input)),
		}),
	);

	return Effect.gen(function* () {
		const service = yield* ImportsService;
		const createInput = {
			source: "goodreads" as const,
			inputSummary: { source: "test" },
			userId: UserId.make("user-1"),
		} satisfies CreateImportRunInput;

		const run = yield* service.create(createInput);
		yield* service.update({ runId: run.id, status: "running", progress: 25 });
		yield* service.delete({ runId: run.id, userId: createInput.userId });

		expect(createdInput).toEqual(createInput);
		expect(updates).toEqual([{ runId: "run-1", status: "running", progress: 25 }]);
		expect(deletedInput).toEqual({ runId: "run-1", userId: "user-1" });
	}).pipe(Effect.provide(layer));
});

it.effect("validates extensions against the claimed original file name", () => {
	const deletedIntentIds: string[] = [];
	const layer = makeServiceLayer(
		makeImportsRepository(),
		Layer.mergeAll(
			makeImportSourceCatalog(
				goodreadsSource({
					inputSchema: {
						unknownKeys: "strict",
						fields: { uploadToken: uploadProperty(["json"]) },
					},
				}),
			),
			mockUploadsService({
				claimTemporaryUpload: () =>
					Effect.succeed({
						leaseExpiresAt: now,
						intentId: "intent-goodreads",
						fileName: "goodreads-export.csv",
						resolvedPath: "/tmp/random-object.json",
						locator: { type: "local" as const, key: "temporary/random-object.json" },
					}),
				deleteTemporaryUpload: (intentId) =>
					Effect.sync(() => void deletedIntentIds.push(intentId)),
			}),
			Layer.succeed(WorkflowEngine, makeWorkflowEngine()),
		),
	);

	return Effect.gen(function* () {
		const error = yield* Effect.flip(
			(yield* ImportsService).startImportRun(user, {
				source: "goodreads",
				uploadToken: "tok_goodreads",
			}),
		);
		expect(error).toMatchObject({
			reason: { code: "unsupported-file-extension", allowedExtensions: ["json"] },
		});
		expect(deletedIntentIds).toEqual(["intent-goodreads"]);
	}).pipe(Effect.provide(layer));
});

it.effect("rejects temporary uploads claimed from S3 storage", () => {
	const deletedIntentIds: string[] = [];
	const layer = makeServiceLayer(
		makeImportsRepository(),
		Layer.mergeAll(
			makeImportSourceCatalog(goodreadsSource()),
			mockUploadsService({
				claimTemporaryUpload: () =>
					Effect.succeed({
						leaseExpiresAt: now,
						intentId: "intent-s3",
						fileName: "goodreads.csv",
						locator: { key: "temporary/object.csv", type: "s3" as const },
					}),
				deleteTemporaryUpload: (intentId) =>
					Effect.sync(() => void deletedIntentIds.push(intentId)),
			}),
			Layer.succeed(WorkflowEngine, makeWorkflowEngine()),
		),
	);

	return Effect.gen(function* () {
		const error = yield* Effect.flip(
			(yield* ImportsService).startImportRun(user, {
				source: "goodreads",
				uploadToken: "tok_s3",
			}),
		);
		expect(error).toMatchObject({ reason: { code: "upload-unavailable", field: "uploadToken" } });
		expect(deletedIntentIds).toEqual(["intent-s3"]);
	}).pipe(Effect.provide(layer));
});

it.effect("claims only the visible upload from mutually exclusive required fields", () => {
	const executed: unknown[] = [];
	const stored: Array<{ key: string; ttlSeconds: number | undefined; value: string }> = [];
	const claims: Array<{ claimId: string | undefined; token: string }> = [];
	let createdInput: CreateImportRunInput | undefined;
	let updatedInput: unknown;
	const source = goodreadsSource({
		slug: "movary",
		name: "Movary",
		workflowSlug: "movary-import",
		inputSchema: {
			unknownKeys: "strict",
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
		},
	});
	const layer = makeServiceLayer(
		makeImportsRepository({
			createRun: (input) =>
				Effect.sync(() => {
					createdInput = input;
					return createdRun;
				}),
			updateRun: (input) => Effect.sync(() => void (updatedInput = input)),
		}),
		Layer.mergeAll(
			makeImportSourceCatalog(source),
			mockUploadsService({
				claimTemporaryUpload: (token, _userId, claimId) =>
					Effect.sync(() => {
						claims.push({ claimId, token });
						return {
							leaseExpiresAt: now,
							intentId: `intent-${token}`,
							fileName: `${token}-original.csv`,
							resolvedPath: `/tmp/${token}.csv`,
							locator: { type: "local" as const, key: `temporary/${token}.csv` },
						};
					}),
				deleteTemporaryUpload: () => Effect.sync(() => undefined),
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
			apiKey: "file-source-secret",
			mode: "history",
			source: "movary",
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
			pluginSlug: "media",
			uploadIntentIds: ["intent-history"],
			workflowScriptId: "accepted-import-script",
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
			makeImportSourceCatalog(goodreadsSource()),
			mockUploadsService({
				claimTemporaryUpload: () => Effect.die("must not claim"),
			}),
			Layer.succeed(
				WorkflowEngine,
				makeWorkflowEngine({ execute: () => Effect.die("must not start") }),
			),
		),
	);

	return Effect.gen(function* () {
		const error = yield* Effect.flip(
			(yield* ImportsService).startImportRun(user, {
				source: "goodreads",
				uploadToken: "goodreads",
				historyUploadToken: "history",
			}),
		);
		expect(error).toMatchObject({ reason: { code: "invalid-input", field: null } });
	}).pipe(Effect.provide(layer));
});

it.effect("rejects a source whose declared plugin config keys are unset", () => {
	const layer = makeServiceLayer(
		makeImportsRepository(),
		Layer.mergeAll(
			makeImportSourceCatalog(goodreadsSource({ requiredPluginConfigKeys: ["hardcoverApiKey"] })),
			mockUploadsService({
				claimTemporaryUpload: () => Effect.die("must not claim"),
			}),
			Layer.succeed(WorkflowEngine, makeWorkflowEngine()),
		),
	);

	return Effect.gen(function* () {
		const error = yield* Effect.flip(
			(yield* ImportsService).startImportRun(user, {
				source: "goodreads",
				uploadToken: "goodreads",
			}),
		);
		expect(error).toMatchObject({
			reason: {
				source: "goodreads",
				code: "source-not-configured",
				missingConfigKeys: ["RYOT_PLUGIN_MEDIA_HARDCOVER_API_KEY"],
			},
		});
	}).pipe(Effect.provide(Layer.mergeAll(layer, makeConfigProviderLayer())));
});

it.effect("lists manifest sources with workflow and config availability", () => {
	const source = goodreadsSource({ requiredPluginConfigKeys: ["hardcoverApiKey"] });
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
				name: "Goodreads",
				slug: "goodreads",
				isStartable: false,
				pluginSlug: "media",
				description: "Goodreads export",
				inputSchema: source.inputSchema,
				workflowSlug: "goodreads-import",
				requiredPluginConfigKeys: ["hardcoverApiKey"],
				missingPluginConfigKeys: ["RYOT_PLUGIN_MEDIA_HARDCOVER_API_KEY"],
			},
		]);
		expect(sources[0]).not.toHaveProperty("configSchema");
	}).pipe(Effect.provide(Layer.mergeAll(layer, makeConfigProviderLayer())));
});

it.effect("lists a configured source with an active workflow as startable", () => {
	const source = goodreadsSource();
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
			{ slug: "goodreads", isStartable: true, missingPluginConfigKeys: [] },
		]);
	}).pipe(Effect.provide(Layer.mergeAll(layer, makeConfigProviderLayer())));
});

it.effect("hides and rejects import sources from an unavailable system installation", () => {
	const source = goodreadsSource();
	const layer = makeServiceLayer(
		makeImportsRepository(),
		Layer.mergeAll(
			makeImportSourceCatalog(source),
			mockUploadsService({}),
			Layer.succeed(WorkflowEngine, makeWorkflowEngine()),
		),
		importWorkflowPinningLayer,
		makeRedisService(),
		Layer.mock(PluginRuntimeResolver)({
			isSystemPluginAvailableToUser: () => Effect.succeed(false),
		}),
	);

	return Effect.gen(function* () {
		const service = yield* ImportsService;
		expect(yield* service.listImportSources(user)).toEqual([]);
		const error = yield* Effect.flip(service.startImportRun(user, { source: source.slug }));
		expect(error).toMatchObject({ reason: { code: "source-not-found", source: source.slug } });
	}).pipe(Effect.provide(Layer.mergeAll(layer, makeConfigProviderLayer())));
});

it.effect("stores decoded payload credentials without exposing them in the input summary", () => {
	const executed: unknown[] = [];
	const stored: string[] = [];
	let createdInput: CreateImportRunInput | undefined;
	const source = goodreadsSource({
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
			Layer.succeed(
				WorkflowEngine,
				makeWorkflowEngine({
					execute: (_workflow, options) => Effect.sync(() => void executed.push(options)),
				}),
			),
		),
		importWorkflowPinningLayer,
		makeRedisService({
			set: (_key, value) => Effect.sync(() => void stored.push(value)),
		}),
	);

	return Effect.gen(function* () {
		expect(
			yield* (yield* ImportsService).startImportRun(user, {
				apiKey: "secret",
				source: "goodreads",
			}),
		).toEqual({ id: "run-1" });
		expect(createdInput?.inputSummary).toEqual({ source: "goodreads" });
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
	const source = goodreadsSource({
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
	const layer = makeServiceLayer(
		makeImportsRepository(),
		Layer.mergeAll(
			makeImportSourceCatalog(source),
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
			(yield* ImportsService).startImportRun(user, { apiKey: "secret", source: "goodreads" }),
		);

		expect(error).toMatchObject({ reason: { code: "queue-unavailable", operation: "import-run" } });
		expect(deletedKeys).toEqual([[redisKeys.importSourceState("run-1")]]);
	}).pipe(Effect.provide(layer));
});
