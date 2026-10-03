import { assert, expect, it } from "@effect/vitest";
import { LifecycleCommand } from "@ryot-app/contract/modules/automations/lifecycle";
import type { JsonValue } from "@ryot-app/contract/modules/ryotql/language";
import { makeWorkflowReplayHost } from "@ryot-app/sandbox-sdk/testing";
import type { SandboxHostError } from "@ryot-app/sandbox-sdk/wire";
import type {
	WorkflowReplayEnvelope,
	WorkflowReplayHost,
	WorkflowReplayJournalEntry,
} from "@ryot-app/sandbox-sdk/workflow";
import { Effect, Schema } from "effect";

import { MediaImportPopulationWorkflowOutput } from "../contracts/workflows";
import populationWorkflow from "./media-import-population.sandbox";
import resolutionWorkflow from "./media-import-resolution.sandbox";

const importCommand = (runId: string) =>
	Schema.decodeSync(LifecycleCommand)({
		occurredAt: "2026-09-16T00:00:00.000Z",
		itemIdentity: JSON.stringify(["import-run", runId]),
		accountGeneration: { userId: "user-1", token: "test-account-generation" },
		causation: {
			depth: 0,
			source: "import",
			parentRunId: null,
			importRunId: runId,
			parentTriggerId: null,
			executionId: `execution-${runId}`,
			rootExecutionId: `execution-${runId}`,
			initiator: { id: "user-1", kind: "user" },
		},
	});

const completeReplay = <Input extends JsonValue>(
	run: (
		input: Input,
		host: WorkflowReplayHost,
		execution: { metadata: Record<string, JsonValue>; sandboxScriptId: string },
	) => Effect.Effect<WorkflowReplayEnvelope, SandboxHostError>,
	input: Input,
	resolve: (request: WorkflowReplayEnvelope["requests"][number]) => JsonValue,
) =>
	Effect.gen(function* () {
		const journal: WorkflowReplayJournalEntry[] = [];
		for (;;) {
			const envelope = yield* run(input, makeWorkflowReplayHost(journal), {
				metadata: {},
				sandboxScriptId: "workflow-test",
			});
			if (envelope.state === "completed") {
				return envelope.output;
			}
			expect(envelope.state).toBe("pending");
			if (envelope.state === "failed") {
				throw new Error(envelope.error);
			}
			const request = envelope.requests[journal.length];
			assert(request);
			journal.push({ request, value: resolve(request) });
		}
	});

it.live("keeps 205 resolution results aligned during in-process replay", () =>
	Effect.gen(function* () {
		const items = Array.from({ length: 205 }, (_, index) => ({
			index,
			identifierType: "isbn",
			value: `value-${index}`,
			candidates: [
				{ providerSlug: "book.openlibrary", scriptSlug: "media-import-resolve.book.openlibrary" },
			],
		}));
		const output = yield* completeReplay(resolutionWorkflow.run, { items }, (request) => ({
			status: "completed",
			externalId: `resolved-${request.index}`,
		}));

		expect(output).toEqual({
			results: items.map(({ index }) => ({
				index,
				status: "resolved",
				externalId: `resolved-${index}`,
				providerSlug: "book.openlibrary",
			})),
		});
	}),
);

it.live("emits population children as one deterministic batch", () =>
	Effect.gen(function* () {
		const items = Array.from({ length: 10 }, (_, index) => ({
			index,
			userId: "user-1",
			entitySchemaSlug: "book",
			externalId: `external-${index}`,
			command: importCommand("run-1"),
			providerId: "provider-openlibrary",
		}));
		const envelope = yield* populationWorkflow.run({ items }, makeWorkflowReplayHost([]), {
			metadata: {},
			sandboxScriptId: "workflow-test",
		});

		assert(envelope.state === "pending");
		expect(envelope.requests.map((request) => request.name)).toEqual(
			items.map(({ index }) => `import-${index}`),
		);
		expect(envelope.requests[0]).toMatchObject({ args: { input: { command: items[0]?.command } } });
	}),
);

it.live("keeps ten concurrent in-process population replays isolated", () =>
	Effect.gen(function* () {
		const outputs = yield* Effect.forEach(
			Array.from({ length: 10 }, (_unused, workflowIndex) => workflowIndex),
			(workflowIndex) => {
				const items = Array.from({ length: 10 }, (_ignored, index) => ({
					index,
					entitySchemaSlug: "book",
					userId: `user-${workflowIndex}`,
					providerId: "provider-openlibrary",
					command: importCommand(`run-${workflowIndex}`),
					externalId: `external-${workflowIndex}-${index}`,
				}));
				return completeReplay(populationWorkflow.run, { items }, (request) => {
					expect(request).toMatchObject({
						kind: "child",
						args: { workflowSlug: "kernel:entity-import" },
					});
					return {
						status: "completed",
						entity: { id: `entity-${workflowIndex}-${request.index}` },
					};
				});
			},
			{ concurrency: "unbounded" },
		);

		expect(outputs).toHaveLength(10);
		for (const output of outputs) {
			const decoded = yield* Schema.decodeUnknownEffect(MediaImportPopulationWorkflowOutput)(
				output,
			);
			expect(decoded.results).toHaveLength(10);
		}
	}),
);
