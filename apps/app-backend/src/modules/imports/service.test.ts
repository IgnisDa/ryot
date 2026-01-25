import { BunFileSystem } from "@effect/platform-bun";
import { it, expect } from "@effect/vitest";
import { WorkflowEngine } from "@effect/workflow/WorkflowEngine";
import type { CurrentUserValue } from "@ryot/contract/auth-middleware";
import type { ListedImportRun } from "@ryot/contract/modules/imports/schemas";
import { ImportRunId, SandboxScriptId, UserId } from "@ryot/contract/schema/brands";
import { ConfigProvider, Effect, Layer } from "effect";
import { assert } from "vitest";

import { RedisService } from "#lib/infrastructure/redis";
import type { MockOverrides } from "#lib/test-utils/effect";
import {
	dbRunnerLayer,
	makeAppConfigLayer,
	makeRedisService,
	makeWorkflowEngine,
} from "#lib/test-utils/effect";
import {
	ImportSourceCatalog,
	type RegisteredImportSource,
} from "#modules/plugins/import-source-catalog";
import { UploadsService } from "#modules/uploads/service";

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
	errorSummary: null,
	status: "pending" as const,
	source: "goodreads" as const,
	id: ImportRunId.make("run-1"),
} satisfies ListedImportRun;

const mockImportsRepository = Layer.mock(ImportsRepository);
const mockImportRunFailuresService = Layer.mock(ImportRunFailuresService);
const mockUploadsService = Layer.mock(UploadsService);

const makeImportsRepository = (overrides: MockOverrides<typeof mockImportsRepository> = {}) =>
	mockImportsRepository({
		_tag: "ImportsRepository",
		createRun: () => Effect.succeed(createdRun),
		updateRun: () => Effect.void,
		deleteRunById: () => Effect.void,
		...overrides,
	});

const makeImportRunFailuresService = () =>
	mockImportRunFailuresService({
		_tag: "ImportRunFailuresService",
		create: () => Effect.void,
	});

const makeUploadsService = (resolvedPath?: string) =>
	mockUploadsService({
		_tag: "UploadsService",
		...(resolvedPath ? { claimUploadToken: () => Effect.succeed({ resolvedPath }) } : {}),
	});

const makeImportSourceCatalog = (registered: RegisteredImportSource | null = null) =>
	Layer.mock(ImportSourceCatalog)({
		_tag: "ImportSourceCatalog",
		list: () => (registered ? [registered] : []),
		resolve: () =>
			registered
				? {
						source: registered,
						script: Effect.succeed({ id: SandboxScriptId.make("accepted-import-script") }),
					}
				: null,
	});

const importWorkflowPinningLayer = Layer.succeed(ImportWorkflowPinning, {
	preRegister: () => Effect.succeed({ registrationStatus: "registered" as const }),
	release: () => Effect.void,
});

const makeServiceLayer = (
	repository = makeImportsRepository(),
	dependencies: Layer.Layer<UploadsService | ImportSourceCatalog | WorkflowEngine> = Layer.mergeAll(
		makeImportSourceCatalog(),
		makeUploadsService(),
		Layer.succeed(WorkflowEngine, makeWorkflowEngine()),
	),
	pinning = importWorkflowPinningLayer,
) =>
	ImportsService.Default.pipe(
		Layer.provide(
			Layer.mergeAll(
				BunFileSystem.layer,
				dbRunnerLayer,
				makeAppConfigLayer(),
				pinning,
				Layer.setConfigProvider(ConfigProvider.fromMap(new Map())),
				Layer.succeed(RedisService, makeRedisService()),
				makeImportRunFailuresService(),
				dependencies,
				repository,
			),
		),
	);

const user: CurrentUserValue = {
	name: "Test User",
	email: "user@example.com",
	id: UserId.make("user-1"),
	preferences: { isNsfw: false, language: null, disableIntegrations: false },
};

type SingleImportSource = Extract<RegisteredImportSource, { readonly lot: "single" }>;

const goodreadsSource = (overrides: Partial<SingleImportSource> = {}) =>
	({
		lot: "single",
		input: "file",
		slug: "goodreads",
		name: "Goodreads",
		pluginSlug: "media",
		configSchema,
		requiredPluginConfigKeys: [],
		allowedFileExtensions: ["csv"],
		description: "Goodreads export",
		workflowSlug: "goodreads-import",
		...overrides,
	}) satisfies RegisteredImportSource;

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
			updateRun: (input) =>
				Effect.sync(() => {
					updates.push(input);
				}),
			deleteRunById: (input) =>
				Effect.sync(() => {
					deletedInput = input;
				}),
		}),
	);

	return Effect.gen(function* () {
		const service = yield* ImportsService;
		const createInput = {
			source: "goodreads" as const,
			userId: UserId.make("user-1"),
			inputSummary: { source: "test" },
		} satisfies CreateImportRunInput;

		const run = yield* service.create(createInput);
		yield* service.update({ runId: run.id, status: "running", progress: 25 });
		yield* service.delete({ runId: run.id, userId: createInput.userId });

		expect(createdInput).toEqual(createInput);
		expect(updates).toEqual([{ runId: "run-1", status: "running", progress: 25 }]);
		expect(deletedInput).toEqual({ runId: "run-1", userId: "user-1" });
	}).pipe(Effect.provide(layer));
});

it.effect("validates uploaded extensions against the registry when it declares the source", () => {
	const layer = makeServiceLayer(
		makeImportsRepository(),
		Layer.mergeAll(
			makeImportSourceCatalog(goodreadsSource({ allowedFileExtensions: ["json"] })),
			makeUploadsService("/tmp/goodreads-export.csv"),
			Layer.succeed(WorkflowEngine, makeWorkflowEngine()),
		),
	);

	return Effect.gen(function* () {
		const service = yield* ImportsService;

		const error = yield* Effect.flip(
			service.startImportRun(user, { source: "goodreads", uploadToken: "tok_goodreads" }),
		);

		expect(error.message).toBe("Import file must have one of the following extensions: json");
	}).pipe(Effect.provide(layer));
});

it.effect("claims and queues registry-declared named artifacts under stable keys", () => {
	const executed: unknown[] = [];
	const claimedTokens: string[] = [];
	const source = {
		lot: "named",
		input: "file",
		name: "Movary",
		slug: "movary",
		pluginSlug: "media",
		configSchema,
		requiredPluginConfigKeys: [],
		description: "Movary export",
		workflowSlug: "movary-import",
		artifacts: [
			{
				required: true,
				key: "historyFilePath",
				allowedFileExtensions: ["csv"],
				uploadTokenField: "historyUploadToken",
			},
			{
				required: true,
				key: "ratingsFilePath",
				allowedFileExtensions: ["csv"],
				uploadTokenField: "ratingsUploadToken",
			},
			{
				required: true,
				key: "watchlistFilePath",
				allowedFileExtensions: ["csv"],
				uploadTokenField: "watchlistUploadToken",
			},
		],
	} satisfies RegisteredImportSource;
	const layer = makeServiceLayer(
		makeImportsRepository(),
		Layer.mergeAll(
			makeImportSourceCatalog(source),
			mockUploadsService({
				_tag: "UploadsService",
				claimUploadToken: (token) =>
					Effect.sync(() => {
						claimedTokens.push(token);
						return { resolvedPath: `/tmp/${token}.csv` };
					}),
			}),
			Layer.succeed(
				WorkflowEngine,
				makeWorkflowEngine({
					execute: (_workflow, options) =>
						Effect.sync(() => {
							executed.push(options);
						}),
				}),
			),
		),
	);

	return Effect.gen(function* () {
		const service = yield* ImportsService;
		yield* service.startImportRun(user, {
			source: "movary",
			historyUploadToken: "history",
			ratingsUploadToken: "ratings",
			watchlistUploadToken: "watchlist",
		});

		expect(claimedTokens).toEqual(["history", "ratings", "watchlist"]);
		expect(executed[0]).toMatchObject({
			payload: {
				filePath: "/tmp/history.csv",
				namedArtifactPaths: {
					historyFilePath: "/tmp/history.csv",
					ratingsFilePath: "/tmp/ratings.csv",
					watchlistFilePath: "/tmp/watchlist.csv",
				},
				sourcePayload: {
					historyFilePath: "/tmp/history.csv",
					ratingsFilePath: "/tmp/ratings.csv",
					watchlistFilePath: "/tmp/watchlist.csv",
				},
			},
		});
	}).pipe(Effect.provide(layer));
});

it.effect("rejects an undeclared file source", () => {
	const layer = makeServiceLayer(
		makeImportsRepository(),
		Layer.mergeAll(
			makeImportSourceCatalog(),
			makeUploadsService("/tmp/goodreads-export.json"),
			Layer.succeed(WorkflowEngine, makeWorkflowEngine()),
		),
	);

	return Effect.gen(function* () {
		const service = yield* ImportsService;

		const error = yield* Effect.flip(
			service.startImportRun(user, { source: "goodreads", uploadToken: "tok_goodreads" }),
		);

		expect(error.message).toBe("Import source is not available");
	}).pipe(Effect.provide(layer));
});

it.effect("rejects an undeclared artifact token before claiming uploads or starting work", () => {
	const layer = makeServiceLayer(
		makeImportsRepository(),
		Layer.mergeAll(
			makeImportSourceCatalog(goodreadsSource()),
			mockUploadsService({
				_tag: "UploadsService",
				claimUploadToken: () => Effect.die("upload token must not be claimed"),
			}),
			Layer.succeed(
				WorkflowEngine,
				makeWorkflowEngine({ execute: () => Effect.die("workflow must not start") }),
			),
		),
	);

	return Effect.gen(function* () {
		const service = yield* ImportsService;

		const error = yield* Effect.flip(
			service.startImportRun(user, {
				source: "goodreads",
				uploadToken: "tok_goodreads",
				historyUploadToken: "tok_history",
			}),
		);

		expect(error.message).toBe(
			"Import source does not declare upload token field: historyUploadToken",
		);
	}).pipe(Effect.provide(layer));
});

it.effect("rejects a registry source whose declared plugin config keys are unset", () => {
	const layer = makeServiceLayer(
		makeImportsRepository(),
		Layer.mergeAll(
			makeImportSourceCatalog(goodreadsSource({ requiredPluginConfigKeys: ["hardcoverApiKey"] })),
			makeUploadsService(),
			Layer.succeed(WorkflowEngine, makeWorkflowEngine()),
		),
	);

	return Effect.gen(function* () {
		const service = yield* ImportsService;

		const error = yield* Effect.flip(
			service.startImportRun(user, { source: "goodreads", uploadToken: "tok_goodreads" }),
		);

		expect(error.message).toBe(
			"Goodreads importer is not configured. Set RYOT_PLUGIN_MEDIA_HARDCOVER_API_KEY.",
		);
	}).pipe(Effect.provide(layer));
});

it.effect("rejects an undeclared source before validating its configuration", () => {
	const layer = makeServiceLayer();

	return Effect.gen(function* () {
		const service = yield* ImportsService;

		const error = yield* Effect.flip(
			service.startImportRun(user, { source: "grouvee", uploadToken: "tok_grouvee" }),
		);

		expect(error.message).toBe("Import source is not available");
	}).pipe(Effect.provide(layer));
});

it.effect("queues a payload run when the registry declares the source as payload input", () => {
	const pins: unknown[] = [];
	const events: string[] = [];
	const executed: unknown[] = [];
	const layer = makeServiceLayer(
		makeImportsRepository(),
		Layer.mergeAll(
			makeImportSourceCatalog({
				configSchema,
				input: "payload",
				slug: "goodreads",
				name: "Goodreads",
				pluginSlug: "media",
				requiredPluginConfigKeys: [],
				description: "Goodreads account",
				workflowSlug: "goodreads-import",
			}),
			makeUploadsService("/tmp/goodreads-export.csv"),
			Layer.succeed(
				WorkflowEngine,
				makeWorkflowEngine({
					execute: (_workflow, options) =>
						Effect.sync(() => {
							events.push("queued");
							executed.push(options);
						}),
				}),
			),
		),
		Layer.succeed(ImportWorkflowPinning, {
			preRegister: (input) =>
				Effect.sync(() => {
					events.push("pinned");
					pins.push(input);
					return { registrationStatus: "registered" as const };
				}),
			release: () => Effect.void,
		}),
	);

	return Effect.gen(function* () {
		const service = yield* ImportsService;

		expect(yield* service.startImportRun(user, { source: "goodreads" })).toEqual({ id: "run-1" });

		const [options] = executed;
		assert(options !== undefined);
		expect(options).toMatchObject({
			executionId: "run-1",
			payload: {
				runId: "run-1",
				userId: "user-1",
				source: "goodreads",
				pluginSlug: "media",
				workflowScriptId: "accepted-import-script",
			},
		});
		expect(pins).toEqual([
			{
				pluginSlug: "media",
				executingUserId: "user-1",
				executionId: "run-1-import",
				scriptId: "accepted-import-script",
			},
		]);
		expect(events).toEqual(["pinned", "queued"]);
	}).pipe(Effect.provide(layer));
});
