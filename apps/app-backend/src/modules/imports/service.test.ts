import { BunFileSystem } from "@effect/platform-bun";
import { it, expect } from "@effect/vitest";
import { WorkflowEngine } from "@effect/workflow/WorkflowEngine";
import type { ListedImportRun } from "@ryot/contract/modules/imports/schemas";
import { ImportRunId, UserId } from "@ryot/contract/schema/brands";
import { Effect, Layer } from "effect";

import { RedisService } from "#lib/infrastructure/redis";
import type { MockOverrides } from "#lib/test-utils/effect";
import {
	dbRunnerLayer,
	makeAppConfigLayer,
	makeRedisService,
	makeWorkflowEngine,
} from "#lib/test-utils/effect";
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

const makeUploadsService = () => mockUploadsService({ _tag: "UploadsService" });

const makeServiceLayer = (repository = makeImportsRepository()) =>
	ImportsService.Default.pipe(
		Layer.provide(
			Layer.mergeAll(
				BunFileSystem.layer,
				dbRunnerLayer,
				makeAppConfigLayer(),
				Layer.succeed(RedisService, makeRedisService()),
				Layer.succeed(WorkflowEngine, makeWorkflowEngine()),
				makeImportRunFailuresService(),
				makeUploadsService(),
				repository,
			),
		),
	);

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
