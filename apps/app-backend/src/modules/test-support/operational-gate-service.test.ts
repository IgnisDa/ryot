import { expect, it } from "@effect/vitest";
import { NotFound } from "@ryot/contract/errors";
import {
	EntitySchemaSlug,
	ImportRunId,
	PluginSlug,
	SandboxProviderId,
	UserId,
} from "@ryot/contract/schema/brands";
import { Effect, Layer } from "effect";

import { DbService } from "#lib/infrastructure/db/service";
import { RedisService } from "#lib/infrastructure/redis";
import { assertExitFails } from "#lib/test-utils/assertions";
import type { MockOverrides } from "#lib/test-utils/effect";
import { ImportsService } from "#modules/imports/service";
import { SandboxExecutionService } from "#modules/sandbox/service";

import { OperationalGateService } from "./operational-gate-service";

const mockDb = Layer.mock(DbService);
const runId = ImportRunId.make("run-id");
const mockRedis = Layer.mock(RedisService);
const executingUserId = UserId.make("user-id");
const mockImports = Layer.mock(ImportsService);
const mockSandbox = Layer.mock(SandboxExecutionService);

const gateInput = {
	itemCount: 1,
	executingUserId,
	source: "fixture-source",
	workflowSlug: "fixture-workflow",
	identifierPrefix: "fixture-item",
	pluginSlug: PluginSlug.make("fixture-plugin"),
	providerId: SandboxProviderId.make("fixture-provider"),
	entitySchemaSlug: EntitySchemaSlug.make("fixture-entity"),
};

const importRun = {
	id: runId,
	progress: 0,
	failedItems: 0,
	startedAt: null,
	totalItems: null,
	inputSummary: {},
	finishedAt: null,
	importedItems: 0,
	processedItems: 0,
	errorSummary: null,
	source: gateInput.source,
	status: "pending" as const,
	createdAt: "2026-07-30T00:00:00.000Z",
	updatedAt: "2026-07-30T00:00:00.000Z",
};

const makeServiceLayer = (
	imports: MockOverrides<typeof mockImports>,
	sandbox: MockOverrides<typeof mockSandbox>,
) =>
	OperationalGateService.Default.pipe(
		Layer.provide(
			Layer.mergeAll(
				mockImports({ _tag: "ImportsService", ...imports }),
				mockSandbox({ _tag: "SandboxExecutionService", ...sandbox }),
				mockRedis({ client: Object.create(null), _tag: "RedisService" }),
				mockDb({ db: Object.create(null), pool: Object.create(null), _tag: "DbService" }),
			),
		),
	);

it.effect("returns a typed error for an invalid plugin workflow target", () => {
	let enqueueInput: unknown;
	const layer = makeServiceLayer(
		{ create: () => Effect.succeed(importRun), update: () => Effect.void },
		{
			enqueuePluginWorkflow: (input) => {
				enqueueInput = input;
				return Effect.fail(new NotFound({ message: "Sandbox script not found" }));
			},
		},
	);

	return Effect.gen(function* () {
		const service = yield* OperationalGateService;
		const exit = yield* Effect.exit(service.startWorkflowLoad(gateInput));

		assertExitFails(exit, new NotFound({ message: "Sandbox script not found" }));
		expect(enqueueInput).toEqual({
			executingUserId,
			pluginSlug: gateInput.pluginSlug,
			workflowSlug: gateInput.workflowSlug,
			executionId: `${runId}-workflow-load-0`,
			input: {
				items: [
					{
						index: 0,
						providerId: gateInput.providerId,
						entitySchemaSlug: gateInput.entitySchemaSlug,
						externalId: `${gateInput.identifierPrefix}-0`,
						origin: { kind: "import", importRunId: runId },
					},
				],
			},
		});
	}).pipe(Effect.provide(layer));
});

it.effect("polls every execution and updates bookkeeping only after all finish", () => {
	let terminal = false;
	const updates: Array<unknown> = [];
	const polledExecutionIds: string[] = [];
	const layer = makeServiceLayer(
		{
			update: (input) =>
				Effect.sync(() => {
					updates.push(input);
				}),
		},
		{
			getPluginWorkflowResult: (executionId) =>
				Effect.sync(() => {
					polledExecutionIds.push(executionId);
					return terminal
						? { status: "completed" as const, output: { executionId } }
						: { status: "pending" as const };
				}),
		},
	);

	return Effect.gen(function* () {
		const service = yield* OperationalGateService;
		const input = { runId, itemCount: 2, executionIds: ["execution-0", "execution-1"] };

		expect(yield* service.getWorkflowLoadResult(input)).toEqual({
			runId,
			executions: [
				{ status: "pending", executionId: "execution-0" },
				{ status: "pending", executionId: "execution-1" },
			],
		});
		expect(polledExecutionIds).toEqual(["execution-0", "execution-1"]);
		expect(updates).toEqual([]);

		terminal = true;
		yield* service.getWorkflowLoadResult(input);
		expect(polledExecutionIds).toEqual([
			"execution-0",
			"execution-1",
			"execution-0",
			"execution-1",
		]);
		expect(updates).toEqual([
			expect.objectContaining({
				runId,
				progress: 100,
				failedItems: 0,
				importedItems: 2,
				processedItems: 2,
				status: "completed",
			}),
		]);
	}).pipe(Effect.provide(layer));
});
