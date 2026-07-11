import { BunFileSystem } from "@effect/platform-bun";
import { it, expect } from "@effect/vitest";
import { WorkflowEngine } from "@effect/workflow/WorkflowEngine";
import type { CurrentUserValue } from "@ryot/contract/auth-middleware";
import type { ListedImportRun } from "@ryot/contract/modules/imports/schemas";
import { ImportRunId, UserId } from "@ryot/contract/schema/brands";
import { Effect, Layer } from "effect";
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

const now = "2026-07-16T00:00:00.000Z";

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
		find: () => registered,
		_tag: "ImportSourceCatalog",
		list: () => (registered ? [registered] : []),
	});

const makeServiceLayer = (
	repository = makeImportsRepository(),
	dependencies: Layer.Layer<UploadsService | ImportSourceCatalog | WorkflowEngine> = Layer.mergeAll(
		makeImportSourceCatalog(),
		makeUploadsService(),
		Layer.succeed(WorkflowEngine, makeWorkflowEngine()),
	),
) =>
	ImportsService.Default.pipe(
		Layer.provide(
			Layer.mergeAll(
				BunFileSystem.layer,
				dbRunnerLayer,
				makeAppConfigLayer(),
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

const goodreadsSource = (overrides: Partial<RegisteredImportSource> = {}) =>
	({
		input: "file",
		slug: "goodreads",
		name: "Goodreads",
		pluginSlug: "media",
		requiredAppConfigKeys: [],
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

it.effect("falls back to the hardcoded extension table for undeclared sources", () => {
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

		expect(error.message).toBe("Import file must have one of the following extensions: csv");
	}).pipe(Effect.provide(layer));
});

it.effect("rejects a registry source whose declared app config keys are unset", () => {
	const layer = makeServiceLayer(
		makeImportsRepository(),
		Layer.mergeAll(
			makeImportSourceCatalog(
				goodreadsSource({ requiredAppConfigKeys: ["books.hardcoverApiKey"] }),
			),
			makeUploadsService(),
			Layer.succeed(WorkflowEngine, makeWorkflowEngine()),
		),
	);

	return Effect.gen(function* () {
		const service = yield* ImportsService;

		const error = yield* Effect.flip(
			service.startImportRun(user, { source: "goodreads", uploadToken: "tok_goodreads" }),
		);

		expect(error.message).toBe("Goodreads importer is not configured. Set books.hardcoverApiKey.");
	}).pipe(Effect.provide(layer));
});

it.effect("falls back to the hardcoded start validator for undeclared sources", () => {
	const layer = makeServiceLayer();

	return Effect.gen(function* () {
		const service = yield* ImportsService;

		const error = yield* Effect.flip(
			service.startImportRun(user, { source: "grouvee", uploadToken: "tok_grouvee" }),
		);

		expect(error.message).toBe(
			"Grouvee importer is not configured. Set VIDEO_GAMES_GIANT_BOMB_API_KEY.",
		);
	}).pipe(Effect.provide(layer));
});

it.effect("queues a payload run when the registry declares the source as payload input", () => {
	const executed: unknown[] = [];
	const layer = makeServiceLayer(
		makeImportsRepository(),
		Layer.mergeAll(
			makeImportSourceCatalog(goodreadsSource({ input: "payload" })),
			makeUploadsService("/tmp/goodreads-export.csv"),
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

		expect(
			yield* service.startImportRun(user, { source: "goodreads", uploadToken: "tok_goodreads" }),
		).toEqual({ id: "run-1" });

		const [options] = executed;
		assert(options !== undefined);
		expect(options).toMatchObject({
			executionId: "run-1",
			payload: { runId: "run-1", userId: "user-1", source: "goodreads" },
		});
	}).pipe(Effect.provide(layer));
});
