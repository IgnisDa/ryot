import { BunFileSystem } from "@effect/platform-bun";
import { expect, layer } from "@effect/vitest";
import type { CurrentUserValue } from "@ryot-app/contract/auth-middleware";
import { SandboxRunError } from "@ryot-app/contract/errors";
import type { ListedImportRun } from "@ryot-app/contract/modules/imports/schemas";
import {
	ImportRunId,
	PluginConfigRevisionId,
	PluginId,
	PluginRevisionId,
	SandboxScriptId,
	UserId,
} from "@ryot-app/contract/schema/brands";
import { Context, Effect, Layer, Ref, Schema } from "effect";
import { WorkflowEngine } from "effect/unstable/workflow/WorkflowEngine";
import { assert } from "vitest";

import {
	IMPORT_SOURCE_STATE_PENDING_TTL_SECONDS,
	ImportSourceStateFromJson,
	RedisService,
	redisKeys,
} from "#lib/infrastructure/redis";
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
import { ImportSourceStateStore } from "./runtime/source-state-store";
import { ImportsService, type CreateManualImportRunInput } from "./service";
import { ImportWorkflowPinning } from "./workflow-pinning";

const now = "2026-07-16T00:00:00.000Z";
const configSchema = {
	unknownKeys: "strict",
	fields: { deltaApiKey: { type: "string", label: "Delta API key", description: "Delta API key" } },
} as const;
const admittedPluginRevision = {
	configSchema,
	ownerId: null,
	slug: "example",
	compiledHashes: {},
	workflowScripts: {},
	scope: "system" as const,
	userBootstrapScriptSlugs: [],
	id: PluginId.make("example-plugin-id"),
	revisionId: PluginRevisionId.make("example-revision"),
	configRevisionId: PluginConfigRevisionId.make("example-config-revision"),
	schemaScope: { eventSchemas: [], entitySchemaSlugs: [], relationshipSchemaSlugs: [] },
};

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
	pluginRevisionId: "example-revision",
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
	configuredPluginConfigKeys: [],
	installationId: "example-installation",
	inputSchema: { unknownKeys: "strict", fields: { uploadToken: uploadProperty(["csv"]) } },
	configContext: {
		configSchema,
		kind: "revision",
		ownerUserId: null,
		pluginRevisionId: "example-revision",
		pluginConfigRevisionId: "example-config-revision",
	},
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

type ClaimedUpload = Effect.Success<
	ReturnType<UploadIntentsService["Service"]["claimTemporaryUpload"]>
>;
type StoredSourceState = { key: string; value: string; ttlSeconds: number | undefined };

class FakeImportsDependencies extends Context.Service<
	FakeImportsDependencies,
	{
		readonly executions: Effect.Effect<ReadonlyArray<unknown>>;
		readonly deletedRuns: Effect.Effect<ReadonlyArray<unknown>>;
		readonly releasedPins: Effect.Effect<ReadonlyArray<string>>;
		readonly deletedIntentIds: Effect.Effect<ReadonlyArray<string>>;
		readonly createdRuns: Effect.Effect<ReadonlyArray<CreateManualImportRunInput>>;
		readonly runUpdates: Effect.Effect<ReadonlyArray<Record<string, unknown>>>;
		readonly storedSourceStates: Effect.Effect<ReadonlyArray<StoredSourceState>>;
		readonly deletedSourceStateKeys: Effect.Effect<ReadonlyArray<ReadonlyArray<string>>>;
		readonly uploadClaims: Effect.Effect<
			ReadonlyArray<{ claimId: string | undefined; token: string }>
		>;
	}
>()("test/FakeImportsDependencies") {}

const append = <A>(ref: Ref.Ref<ReadonlyArray<A>>, value: A) =>
	Ref.update(ref, (all) => [...all, value]);

const makeServiceLayer = (
	options: {
		readonly createsRun?: boolean;
		readonly withConfigProvider?: boolean;
		readonly dispatch?: "succeed" | "fail";
		readonly source?: RegisteredImportSource;
		readonly sourceState?: "store" | "store-and-delete";
		readonly claimUpload?: (token: string) => ClaimedUpload;
		readonly pin?: "registered" | "already-registered" | "unavailable";
	} = {},
) =>
	ImportsService.layer.pipe(
		Layer.provideMerge(ImportSourceStateStore.layer),
		Layer.provideMerge(
			Layer.mergeAll(
				BunFileSystem.layer,
				databaseLayer,
				makeAppConfigLayer(),
				options.withConfigProvider ? makeConfigProviderLayer() : Layer.empty,
				mockImportRunFailuresService({ create: () => Effect.void }),
				makeImportSourceCatalog(options.source ?? null),
				Layer.unwrap(
					Effect.gen(function* () {
						const executions = yield* Ref.make<ReadonlyArray<unknown>>([]);
						const deletedRuns = yield* Ref.make<ReadonlyArray<unknown>>([]);
						const releasedPins = yield* Ref.make<ReadonlyArray<string>>([]);
						const deletedIntentIds = yield* Ref.make<ReadonlyArray<string>>([]);
						const createdRuns = yield* Ref.make<ReadonlyArray<CreateManualImportRunInput>>([]);
						const runUpdates = yield* Ref.make<ReadonlyArray<Record<string, unknown>>>([]);
						const storedSourceStates = yield* Ref.make<ReadonlyArray<StoredSourceState>>([]);
						const deletedSourceStateKeys = yield* Ref.make<ReadonlyArray<ReadonlyArray<string>>>(
							[],
						);
						const uploadClaims = yield* Ref.make<
							ReadonlyArray<{ claimId: string | undefined; token: string }>
						>([]);
						const { dispatch, claimUpload, sourceState, pin = "registered" } = options;
						return Layer.mergeAll(
							Layer.succeed(FakeImportsDependencies, {
								executions: Ref.get(executions),
								runUpdates: Ref.get(runUpdates),
								deletedRuns: Ref.get(deletedRuns),
								createdRuns: Ref.get(createdRuns),
								releasedPins: Ref.get(releasedPins),
								uploadClaims: Ref.get(uploadClaims),
								deletedIntentIds: Ref.get(deletedIntentIds),
								storedSourceStates: Ref.get(storedSourceStates),
								deletedSourceStateKeys: Ref.get(deletedSourceStateKeys),
							}),
							mockImportsRepository({
								deleteRunById: (input) => append(deletedRuns, input),
								updateInputSummary: (input) => append(runUpdates, input).pipe(Effect.as(true)),
								updateProgress: (input) =>
									append(runUpdates, { ...input, status: "running" }).pipe(Effect.as(true)),
								finishFailed: (input) =>
									append(runUpdates, { ...input, status: "failed" }).pipe(
										Effect.as("settled" as const),
									),
								createManualRun: (input) =>
									options.createsRun === false
										? Effect.die("run must not be created")
										: append(createdRuns, input).pipe(Effect.as(createdRun)),
							}),
							mockUploadsService({
								deleteTemporaryUpload: (intentId) =>
									append(deletedIntentIds, intentId).pipe(Effect.as(undefined)),
								claimTemporaryUpload: (token, _userId, claimId) =>
									claimUpload === undefined
										? Effect.die("must not claim")
										: append(uploadClaims, { token, claimId }).pipe(Effect.as(claimUpload(token))),
							}),
							Layer.succeed(
								WorkflowEngine,
								makeWorkflowEngine({
									execute: (_workflow, executeOptions) => {
										if (dispatch === "succeed") {
											return append(executions, executeOptions);
										}
										return dispatch === "fail"
											? Effect.fail("dispatch failed")
											: Effect.die("must not start");
									},
								}),
							),
							Layer.succeed(ImportWorkflowPinning, {
								release: (executionId) => append(releasedPins, executionId),
								preRegister: () =>
									pin === "unavailable"
										? new SandboxRunError({ kind: "script-failure", message: "pin unavailable" })
										: Effect.succeed({
												registrationStatus: pin,
												pluginRevision: admittedPluginRevision,
											}),
							}),
							Layer.succeed(
								RedisService,
								makeRedisService({
									set: (key, value, ttlSeconds) =>
										sourceState === undefined
											? Effect.die("must not store source state")
											: append(storedSourceStates, { key, value, ttlSeconds }),
									del: (...keys) =>
										sourceState === "store-and-delete"
											? append(deletedSourceStateKeys, [...keys]).pipe(Effect.as(keys.length))
											: Effect.die("must not delete source state"),
								}),
							),
						);
					}),
				),
			),
		),
	);

const decodeSourceState = Schema.decodeEffect(ImportSourceStateFromJson);

const claimedUpload = (fileName: string, path: string) => () => ({
	fileName,
	resolvedPath: path,
	leaseExpiresAt: now,
	intentId: "intent-beta",
	locator: { type: "local" as const, key: `temporary/${path.split("/").at(-1)}` },
});

layer(makeServiceLayer())((test) => {
	test.effect("delegates import run CRUD through the canonical service methods", () =>
		Effect.gen(function* () {
			const service = yield* ImportsService;
			const fake = yield* FakeImportsDependencies;
			const createInput = {
				source: "beta" as const,
				userId: UserId.make("user-1"),
				inputSummary: { source: "test" },
				pluginInstallationId: "example-installation",
			} satisfies CreateManualImportRunInput;

			const run = yield* service.createManualRun(createInput);
			yield* service.updateProgress({ progress: 25, runId: run.id });
			yield* service.delete({ runId: run.id, userId: createInput.userId });

			expect((yield* fake.createdRuns).at(-1)).toEqual(createInput);
			expect(yield* fake.runUpdates).toEqual([{ progress: 25, runId: "run-1", status: "running" }]);
			expect((yield* fake.deletedRuns).at(-1)).toEqual({ runId: "run-1", userId: "user-1" });
		}),
	);
});

layer(
	makeServiceLayer({
		claimUpload: claimedUpload("beta-export.csv", "/tmp/random-object.json"),
		source: betaSource({
			inputSchema: { unknownKeys: "strict", fields: { uploadToken: uploadProperty(["json"]) } },
		}),
	}),
)((test) => {
	test.effect("validates extensions against the claimed original file name", () =>
		Effect.gen(function* () {
			const error = yield* Effect.flip(
				(yield* ImportsService).startImportRun(user, { source: "beta", uploadToken: "tok_beta" }),
			);
			expect(error).toMatchObject({
				reason: { allowedExtensions: ["json"], code: "unsupported-file-extension" },
			});
			expect(yield* (yield* FakeImportsDependencies).deletedIntentIds).toEqual(["intent-beta"]);
		}),
	);
});

layer(
	makeServiceLayer({
		source: betaSource(),
		claimUpload: () => ({
			leaseExpiresAt: now,
			fileName: "beta.csv",
			intentId: "intent-s3",
			locator: { type: "s3" as const, key: "temporary/object.csv" },
		}),
	}),
)((test) => {
	test.effect("rejects temporary uploads claimed from S3 storage", () =>
		Effect.gen(function* () {
			const error = yield* Effect.flip(
				(yield* ImportsService).startImportRun(user, { source: "beta", uploadToken: "tok_s3" }),
			);
			expect(error).toMatchObject({ reason: { field: "uploadToken", code: "upload-unavailable" } });
			expect(yield* (yield* FakeImportsDependencies).deletedIntentIds).toEqual(["intent-s3"]);
		}),
	);
});

const movarySource = betaSource({
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

layer(
	makeServiceLayer({
		dispatch: "succeed",
		sourceState: "store",
		source: movarySource,
		claimUpload: (token) => ({
			leaseExpiresAt: now,
			intentId: `intent-${token}`,
			fileName: `${token}-original.csv`,
			resolvedPath: `/tmp/${token}.csv`,
			locator: { type: "local" as const, key: `temporary/${token}.csv` },
		}),
	}),
)((test) => {
	test.effect("claims only the visible upload from mutually exclusive required fields", () =>
		Effect.gen(function* () {
			const fake = yield* FakeImportsDependencies;
			yield* (yield* ImportsService).startImportRun(user, {
				mode: "history",
				source: "movary",
				apiKey: "file-source-secret",
				historyUploadToken: "history",
			});

			const executed = yield* fake.executions;
			const stored = yield* fake.storedSourceStates;
			expect(yield* fake.uploadClaims).toEqual([{ claimId: "run-1", token: "history" }]);
			expect((yield* fake.createdRuns).at(-1)?.inputSummary).toEqual({ source: "movary" });
			expect((yield* fake.runUpdates).at(-1)).toEqual({
				runId: "run-1",
				inputSummary: {
					source: "movary",
					fileNames: { historyUploadToken: "history-original.csv" },
				},
			});
			expect(executed[0]).toMatchObject({
				payload: {
					runId: "run-1",
					userId: "user-1",
					sourceStateId: "run-1",
					command: {
						itemIdentity: '["import-run","run-1"]',
						causation: {
							source: "import",
							executionId: "run-1",
							importRunId: "run-1",
							rootExecutionId: "run-1",
							initiator: { id: "user-1", kind: "user" },
						},
					},
				},
			});
			expect(executed[0]).not.toHaveProperty("payload.sourcePayload");
			expect(executed[0]).not.toHaveProperty("payload.namedArtifactPaths");
			expect(stored).toHaveLength(1);
			expect(stored[0]).toMatchObject({
				key: redisKeys.importSourceState("run-1"),
				ttlSeconds: IMPORT_SOURCE_STATE_PENDING_TTL_SECONDS,
			});
			assert(stored[0]);
			expect(yield* decodeSourceState(stored[0].value)).toEqual({
				source: "movary",
				pluginId: "example-plugin-id",
				uploadIntentIds: ["intent-history"],
				pluginRevision: admittedPluginRevision,
				workflowScriptId: "accepted-import-script",
				pluginInstallationId: "example-installation",
				namedArtifactPaths: { historyUploadToken: "/tmp/history.csv" },
				sourcePayload: {
					mode: "history",
					apiKey: "file-source-secret",
					historyUploadToken: "historyUploadToken",
				},
			});
		}),
	);
});

layer(makeServiceLayer({ source: betaSource() }))((test) => {
	test.effect("rejects undeclared upload token fields before claims or work", () =>
		Effect.gen(function* () {
			const error = yield* Effect.flip(
				(yield* ImportsService).startImportRun(user, {
					source: "beta",
					uploadToken: "beta",
					historyUploadToken: "history",
				}),
			);
			expect(error).toMatchObject({ reason: { field: null, code: "invalid-input" } });
		}),
	);
});

layer(
	makeServiceLayer({
		source: betaSource({
			requiredPluginConfigKeys: ["deltaApiKey"],
			configContext: { ...betaSource().configContext, pluginConfigRevisionId: null },
		}),
	}),
)((test) => {
	test.effect("rejects a source whose declared plugin config keys are unset", () =>
		Effect.gen(function* () {
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
		}),
	);
});

layer(makeServiceLayer({ createsRun: false, withConfigProvider: true }))((test) => {
	test.effect("rejects import sources from an unavailable system installation", () =>
		Effect.gen(function* () {
			const source = betaSource();
			const service = yield* ImportsService;
			const error = yield* Effect.flip(service.startImportRun(user, { source: source.slug }));
			expect(error).toMatchObject({ reason: { source: source.slug, code: "source-not-found" } });
		}),
	);
});

layer(makeServiceLayer({ dispatch: "succeed", sourceState: "store", source: payloadSource }))(
	(test) => {
		test.effect(
			"stores decoded payload credentials without exposing them in the input summary",
			() =>
				Effect.gen(function* () {
					const fake = yield* FakeImportsDependencies;
					expect(
						yield* (yield* ImportsService).startImportRun(user, {
							source: "beta",
							apiKey: "secret",
						}),
					).toEqual({ id: "run-1" });
					expect((yield* fake.createdRuns).at(-1)?.inputSummary).toEqual({ source: "beta" });
					const [options] = yield* fake.executions;
					assert(options !== undefined);
					expect(options).toMatchObject({
						payload: { runId: "run-1", userId: "user-1", sourceStateId: "run-1" },
					});
					expect(options).not.toHaveProperty("payload.sourcePayload");
					expect(options).not.toHaveProperty("payload.apiKey");
					const [stored] = yield* fake.storedSourceStates;
					assert(stored);
					expect(yield* decodeSourceState(stored.value)).toMatchObject({
						sourcePayload: { apiKey: "secret" },
					});
				}),
		);
	},
);

layer(
	makeServiceLayer({ dispatch: "fail", source: payloadSource, sourceState: "store-and-delete" }),
)((test) => {
	test.effect("deletes pending source state when workflow dispatch fails", () =>
		Effect.gen(function* () {
			const error = yield* Effect.flip(
				(yield* ImportsService).startImportRun(user, { source: "beta", apiKey: "secret" }),
			);

			expect(error).toMatchObject({
				reason: { operation: "import-run", code: "queue-unavailable" },
			});
			expect(yield* (yield* FakeImportsDependencies).deletedSourceStateKeys).toEqual([
				[redisKeys.importSourceState("run-1")],
			]);
		}),
	);
});

layer(
	makeServiceLayer({
		dispatch: "succeed",
		sourceState: "store",
		source: betaSource({
			pluginScope: "user",
			pluginSlug: "my-example",
			pluginId: "private-plugin-id",
			installationId: "private-installation",
			inputSchema: { fields: {}, unknownKeys: "strict" },
			configContext: {
				configSchema,
				kind: "revision",
				ownerUserId: user.id,
				pluginRevisionId: "private-revision",
				pluginConfigRevisionId: "private-config-revision",
			},
		}),
	}),
)((test) => {
	test.effect("records the resolving installation on the run and its durable source state", () =>
		Effect.gen(function* () {
			const fake = yield* FakeImportsDependencies;
			yield* (yield* ImportsService).startImportRun(user, { source: "beta" });

			expect((yield* fake.createdRuns).at(-1)?.pluginInstallationId).toBe("private-installation");
			const [stored] = yield* fake.storedSourceStates;
			assert(stored);
			expect(yield* decodeSourceState(stored.value)).toMatchObject({
				pluginId: "private-plugin-id",
				workflowScriptId: "accepted-import-script",
				pluginInstallationId: "private-installation",
			});
		}),
	);
});

layer(
	makeServiceLayer({
		dispatch: "fail",
		source: betaSource(),
		sourceState: "store-and-delete",
		claimUpload: claimedUpload("beta-export.csv", "/tmp/beta-export.csv"),
	}),
)((test) => {
	test.effect("rolls back uploads, source state, and the pin when file dispatch fails", () =>
		Effect.gen(function* () {
			const fake = yield* FakeImportsDependencies;
			const error = yield* Effect.flip(
				(yield* ImportsService).startImportRun(user, { source: "beta", uploadToken: "tok_beta" }),
			);

			expect(error).toMatchObject({
				reason: { operation: "import-run", code: "queue-unavailable" },
			});
			expect(yield* fake.releasedPins).toEqual(["run-1-import"]);
			expect(yield* fake.deletedIntentIds).toEqual(["intent-beta"]);
			expect(yield* fake.deletedSourceStateKeys).toEqual([[redisKeys.importSourceState("run-1")]]);
			expect((yield* fake.deletedRuns).at(-1)).toBeUndefined();
			expect((yield* fake.runUpdates).at(-1)).toMatchObject({
				runId: "run-1",
				status: "failed",
				failureReason: { operation: "workflow", code: "queue-unavailable" },
			});
		}),
	);
});

layer(
	makeServiceLayer({
		pin: "unavailable",
		source: betaSource(),
		claimUpload: claimedUpload("beta-export.csv", "/tmp/beta-export.csv"),
	}),
)((test) => {
	test.effect("cleans up claimed uploads without releasing a pin that never registered", () =>
		Effect.gen(function* () {
			const fake = yield* FakeImportsDependencies;
			const error = yield* Effect.flip(
				(yield* ImportsService).startImportRun(user, { source: "beta", uploadToken: "tok_beta" }),
			);

			expect(error).toMatchObject({
				reason: { operation: "import-run", code: "queue-unavailable" },
			});
			expect(yield* fake.releasedPins).toEqual([]);
			expect(yield* fake.deletedIntentIds).toEqual(["intent-beta"]);
			expect((yield* fake.runUpdates).at(-1)).toMatchObject({
				runId: "run-1",
				status: "failed",
				failureReason: { code: "queue-unavailable", operation: "workflow-pin" },
			});
		}),
	);
});

layer(
	makeServiceLayer({
		dispatch: "fail",
		source: payloadSource,
		pin: "already-registered",
		sourceState: "store-and-delete",
	}),
)((test) => {
	test.effect("leaves an already-registered pin in place while rolling back source state", () =>
		Effect.gen(function* () {
			const fake = yield* FakeImportsDependencies;
			const error = yield* Effect.flip(
				(yield* ImportsService).startImportRun(user, { source: "beta", apiKey: "secret" }),
			);

			expect(error).toMatchObject({
				reason: { operation: "import-run", code: "queue-unavailable" },
			});
			expect(yield* fake.releasedPins).toEqual([]);
			expect(yield* fake.deletedSourceStateKeys).toEqual([[redisKeys.importSourceState("run-1")]]);
		}),
	);
});
