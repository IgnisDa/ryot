import { Command } from "@effect/platform";
import { BunContext } from "@effect/platform-bun";
import { expect, it } from "@effect/vitest";
import { WorkflowEngine, WorkflowInstance } from "@effect/workflow/WorkflowEngine";
import { SandboxRunError, unknownToMessage } from "@ryot/contract/errors";
import type { SandboxExecutionPayload } from "@ryot/contract/modules/sandbox/schemas";
import { SandboxScriptId, UserId } from "@ryot/contract/schema/brands";
import { jsonValueSchema } from "@ryot/sandbox-sdk/wire";
import { workflowReplayEnvelopeSchema } from "@ryot/sandbox-sdk/workflow";
import { Effect, Layer, Schema } from "effect";

import { RedisService } from "#lib/infrastructure/redis";
import { SandboxService as RuntimeSandboxService } from "#lib/infrastructure/sandbox-runtime/service";
import { makeWorkflowDurableCallsHostFunction } from "#lib/infrastructure/sandbox-runtime/workflow-journal";
import {
	dbRunnerLayer,
	makeRedisService,
	makeWorkflowActivityEngine,
	makeWorkflowEngine,
} from "#lib/test-utils/effect";
import { PluginRuntimeResolver } from "#modules/plugins/runtime-resolver";

import { executeSandboxExecution } from "./durable-queues";
import {
	KernelWorkflowReferences,
	KERNEL_LIBRARY_ENTITY_IMPORT_WORKFLOW,
} from "./kernel-workflow-references";
import { SandboxRepository } from "./repository";
import {
	performSandboxWorkflowChild,
	performSandboxWorkflowActivity,
	runSandboxScriptWorkflowBody,
	SANDBOX_WORKFLOW_MAX_STEPS,
	SandboxScriptWorkflow,
	sandboxWorkflowChildExecutionId,
	validateWorkflowReplayEnvelope,
} from "./sandbox-script-workflow";

it("derives child ids deterministically from the parent, call name, and step", () => {
	expect(sandboxWorkflowChildExecutionId("parent", "events", 7)).toBe("parent-child-events-7");
	expect(sandboxWorkflowChildExecutionId("parent", "events", 7)).toBe(
		sandboxWorkflowChildExecutionId("parent", "events", 7),
	);
});

it("keeps workflow replay bounded by the kernel", () => {
	expect(SANDBOX_WORKFLOW_MAX_STEPS).toBe(1_000);
});

it.effect("propagates trusted grants and journals harvested chunk paths", () => {
	const grants = { artifactPath: "/tmp/trusted-artifact.json" };
	let capturedGrants: SandboxExecutionPayload["grants"];

	return Effect.gen(function* () {
		const result = yield* performSandboxWorkflowActivity(
			{
				index: 0,
				name: "import",
				kind: "activity",
				args: { input: {}, scriptSlug: "activity.import" },
			},
			SandboxScriptId.make("activity-script"),
			{
				grants,
				input: {},
				resolutionMode: "exact",
				authority: { type: "system" },
				executionId: "workflow-execution",
				scriptId: SandboxScriptId.make("workflow-script"),
			},
			"workflow-execution",
			0,
			(payload) => {
				capturedGrants = payload.grants;
				return Effect.succeed({
					logs: [],
					error: null,
					status: "completed" as const,
					value: { count: 2, chunkFiles: ["chunk-0.json"] },
					harvest: { directory: "/tmp/harvest", chunkPaths: ["/tmp/harvest/chunk-0.json"] },
				});
			},
		);

		expect(capturedGrants).toEqual(grants);
		expect(result).toEqual({ count: 2, chunkFiles: ["/tmp/harvest/chunk-0.json"] });
	});
});

it.effect("keeps every shell replay on the initial script pin after an active hot swap", () => {
	const historicalScriptId = SandboxScriptId.make("historical-script-id");
	const replacementScriptId = SandboxScriptId.make("replacement-script-id");
	const request = {
		index: 0,
		name: "kernel-step",
		kind: "child" as const,
		args: { input: { value: 1 }, workflowSlug: "kernel:test" },
	};
	const historicalContent = `
if [ "$JOURNAL" = "[]" ]; then
  printf '{"state":"pending","requests":[%s]}' "$REQUEST"
else
  printf '{"state":"completed","requests":[%s],"output":{"content":"pinned-v1","journal":%s}}' "$REQUEST" "$JOURNAL"
fi
`;
	const replacementContent = `printf '{"state":"completed","requests":[],"output":{"content":"active-v2","journal":[]}}'`;
	let activeId = historicalScriptId;
	let kernelCallerScriptId: SandboxScriptId | undefined;
	const executedContent: string[] = [];
	const hashes = new Map<string, Map<string, string>>();
	const redisClient: RedisService["client"] = Object.assign(Object.create(null), {
		hget: (key: string, field: string) => Promise.resolve(hashes.get(key)?.get(field) ?? null),
		hmget: (key: string, ...fields: string[]) =>
			Promise.resolve(fields.map((field) => hashes.get(key)?.get(field) ?? null)),
		expire: () => Promise.resolve(1),
		pipeline: () => {
			const writes: Array<() => void> = [];
			return {
				expire: () => undefined,
				hset: (key: string, field: string, value: string) =>
					writes.push(() => {
						const fields = hashes.get(key) ?? new Map<string, string>();
						fields.set(field, value);
						hashes.set(key, fields);
					}),
				hsetnx: (key: string, field: string, value: string) =>
					writes.push(() => {
						const fields = hashes.get(key) ?? new Map<string, string>();
						if (!fields.has(field)) {
							fields.set(field, value);
						}
						hashes.set(key, fields);
					}),
				exec: () => {
					writes.forEach((write) => write());
					return Promise.resolve([]);
				},
			};
		},
	});
	const script = (id: typeof historicalScriptId, compiledCode: string) => ({
		id,
		compiledCode,
		slug: "workflow",
		name: "Workflow",
		providerId: null,
		compiledFormat: 1,
		pluginSlug: "plugin",
		source: compiledCode,
		createdAt: new Date(0),
		updatedAt: new Date(0),
		contentHash: id === historicalScriptId ? "historical-hash" : "replacement-hash",
		metadata: {
			name: "Workflow",
			slug: "workflow",
			capabilities: [],
			kind: "workflow" as const,
			requiredAppConfigKeys: [],
		},
	});
	const historical = script(historicalScriptId, historicalContent);
	const replacement = script(replacementScriptId, replacementContent);
	const executionId = "workflow-execution";
	const instance = WorkflowInstance.initial(SandboxScriptWorkflow, executionId);
	const engine = makeWorkflowActivityEngine(instance);
	const durableCallsResult = Schema.decodeUnknown(
		Schema.Struct({ data: Schema.Array(jsonValueSchema), success: Schema.Literal(true) }),
	);
	const encodeJson = Schema.encodeSync(Schema.parseJson(Schema.Unknown));
	const decodeEnvelope = Schema.decodeUnknown(Schema.parseJson(workflowReplayEnvelopeSchema));
	const layer = Layer.mergeAll(
		dbRunnerLayer,
		Layer.succeed(WorkflowEngine, engine),
		Layer.succeed(WorkflowInstance, instance),
		Layer.succeed(RedisService, makeRedisService({ client: redisClient })),
		Layer.mock(SandboxRepository)({
			_tag: "SandboxRepository",
			isPluginScript: () => Effect.succeed(true),
			getScriptPin: (scriptId) =>
				Effect.succeed(
					scriptId === historicalScriptId
						? { scriptId: historicalScriptId, contentHash: "historical-hash" }
						: { scriptId: replacementScriptId, contentHash: "replacement-hash" },
				),
			getScript: (scriptId) =>
				Effect.succeed(scriptId === historicalScriptId ? historical : replacement),
			resolveWorkflowCallScript: () => Effect.succeed(null),
		}),
		Layer.mock(PluginRuntimeResolver)({
			_tag: "PluginRuntimeResolver",
			findActiveScriptById: () =>
				Effect.succeed(activeId === historicalScriptId ? historical : replacement),
		}),
		Layer.mock(RuntimeSandboxService)({
			_tag: "SandboxService",
			run: (input) =>
				Effect.gen(function* () {
					executedContent.push(input.compiledCode);
					const durableCalls = makeWorkflowDurableCallsHostFunction(input.workflowExecutionId, {
						client: redisClient,
					});
					const journal = yield* durableCalls([]).pipe(Effect.flatMap(durableCallsResult));
					const output = yield* Command.make("/bin/sh", "-c", input.compiledCode).pipe(
						Command.env({ JOURNAL: encodeJson(journal.data), REQUEST: encodeJson(request) }),
						Command.string,
						Effect.provide(BunContext.layer),
					);
					activeId = replacementScriptId;
					return {
						logs: [],
						error: null,
						success: true,
						harvest: null,
						executionId: input.executionId,
						timing: { totalMs: 1, executionMs: 1 },
						value: yield* decodeEnvelope(output),
					};
				}).pipe(Effect.orDie),
		}),
		Layer.mock(KernelWorkflowReferences)({
			execute: (
				_workflowSlug,
				_input,
				_authority,
				_executionId,
				_parentExecutionId,
				callerScriptId,
			) =>
				Effect.sync(() => {
					kernelCallerScriptId = callerScriptId;
					return { kernel: "recorded" };
				}),
		}),
	);
	const payload = {
		input: {},
		executionId,
		scriptId: historicalScriptId,
		resolutionMode: "active" as const,
		authority: { type: "system" as const },
	};

	return Effect.gen(function* () {
		const result = yield* runSandboxScriptWorkflowBody(payload, executionId, (executionPayload) =>
			executeSandboxExecution(executionPayload).pipe(
				Effect.mapError((error) => new SandboxRunError({ message: unknownToMessage(error) })),
			),
		);
		expect(result).toEqual({ content: "pinned-v1", journal: [{ kernel: "recorded" }] });
		expect(activeId).toBe(replacementScriptId);
		expect(kernelCallerScriptId).toBe(historicalScriptId);
		expect(executedContent).toEqual([historicalContent, historicalContent]);
		expect(executedContent).not.toContain(replacementContent);
	}).pipe(Effect.provide(layer));
});

it.effect("rejects divergence beyond index zero before a replay's generic script failure", () => {
	const first = {
		index: 0,
		name: "first",
		kind: "activity" as const,
		args: { input: { value: 1 }, scriptSlug: "activity" },
	};
	const recordedSecond = {
		index: 1,
		name: "original",
		kind: "sleep" as const,
		args: { durationMs: 10 },
	};
	const changedSecond = { ...recordedSecond, name: "changed" };

	return Effect.gen(function* () {
		const exit = yield* Effect.exit(
			validateWorkflowReplayEnvelope(
				{ state: "failed", error: "generic script error", requests: [first, changedSecond] },
				[
					{ value: "one", request: first },
					{ value: null, request: recordedSecond },
				],
			),
		);
		expect(exit.toString()).toContain("journal[1]");
		expect(exit.toString()).not.toContain("generic script error");
	});
});

it.effect("registers only the first missing request after validating its full prefix", () => {
	const first = {
		index: 0,
		name: "first",
		kind: "sleep" as const,
		args: { durationMs: 10 },
	};
	const pending = {
		index: 1,
		name: "pending",
		kind: "sleep" as const,
		args: { durationMs: 20 },
	};
	return Effect.gen(function* () {
		expect(
			yield* validateWorkflowReplayEnvelope({ state: "pending", requests: [first, pending] }, [
				{ value: null, request: first },
			]),
		).toEqual({ state: "pending", request: pending });
	});
});

it.effect("accepts completion output only after the encountered trace matches the journal", () => {
	const request = {
		index: 0,
		name: "done",
		kind: "sleep" as const,
		args: { durationMs: 10 },
	};
	return Effect.gen(function* () {
		expect(
			yield* validateWorkflowReplayEnvelope(
				{ state: "completed", output: { done: true }, requests: [request] },
				[{ value: null, request }],
			),
		).toEqual({ state: "completed", output: { done: true } });
	});
});

it.effect("dispatches plugin children as child workflows with an exact script pin", () => {
	let capturedWorkflow: unknown;
	let capturedOptions: Parameters<WorkflowEngine["Type"]["execute"]>[1] | undefined;
	const engine = makeWorkflowEngine({
		execute: (workflow, options) =>
			Effect.sync(() => {
				capturedWorkflow = workflow;
				capturedOptions = options;
				return { child: true };
			}),
	});

	return Effect.gen(function* () {
		const result = yield* performSandboxWorkflowChild(
			{
				index: 2,
				kind: "child",
				name: "events",
				args: { input: { value: 1 }, workflowSlug: "plugin-child" },
			},
			SandboxScriptId.make("child-script"),
			{
				input: {},
				executionId: "parent",
				resolutionMode: "active",
				authority: { type: "system" },
				scriptId: SandboxScriptId.make("parent-script"),
			},
			"parent",
			2,
		);
		expect(result).toEqual({ child: true });
		expect(capturedWorkflow).toBe(SandboxScriptWorkflow);
		expect(capturedOptions).toMatchObject({
			executionId: "parent-child-events-2",
			payload: { scriptId: "child-script", resolutionMode: "exact" },
		});
	}).pipe(
		Effect.provideService(WorkflowEngine, engine),
		Effect.provideService(KernelWorkflowReferences, {
			execute: () => Effect.die("unused"),
		}),
	);
});

it.effect("dispatches library imports with the parent workflow authority", () => {
	const calls: Array<{
		input: unknown;
		authority: unknown;
		executionId: string;
		workflowSlug: string;
		callerScriptId: string;
		parentExecutionId: string;
	}> = [];
	return Effect.gen(function* () {
		const result = yield* performSandboxWorkflowChild(
			{
				index: 4,
				kind: "child",
				name: "import-3",
				args: {
					input: { externalId: "book-1" },
					workflowSlug: KERNEL_LIBRARY_ENTITY_IMPORT_WORKFLOW,
				},
			},
			undefined,
			{
				input: {},
				executionId: "parent",
				resolutionMode: "active",
				scriptId: SandboxScriptId.make("parent-script"),
				authority: { type: "user", userId: UserId.make("trusted-user") },
			},
			"parent",
			4,
		);

		expect(result).toEqual({ status: "completed", entity: { id: "entity-1" } });
		expect(calls).toEqual([
			{
				parentExecutionId: "parent",
				input: { externalId: "book-1" },
				executionId: "parent-child-import-3-4",
				authority: { type: "user", userId: "trusted-user" },
				workflowSlug: KERNEL_LIBRARY_ENTITY_IMPORT_WORKFLOW,
				callerScriptId: "parent-script",
			},
		]);
	}).pipe(
		Effect.provideService(
			WorkflowEngine,
			makeWorkflowEngine({ execute: () => Effect.die("unused") }),
		),
		Effect.provideService(KernelWorkflowReferences, {
			execute: (workflowSlug, input, authority, executionId, parentExecutionId, callerScriptId) =>
				Effect.sync(() => {
					calls.push({
						workflowSlug,
						input,
						authority,
						executionId,
						callerScriptId,
						parentExecutionId,
					});
					return { status: "completed", entity: { id: "entity-1" } };
				}),
		}),
	);
});
