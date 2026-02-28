import type { JsonValue, SandboxHostError } from "@ryot/sandbox-sdk/wire";
import type { WorkflowReplayEnvelope, WorkflowSandboxHost } from "@ryot/sandbox-sdk/workflow";
import { Effect, Schema } from "effect";
import { assert, expect, it } from "vitest";

import populationWorkflow from "../scripts/workflows/media-import-population.sandbox";
import resolutionWorkflow from "../scripts/workflows/media-import-resolution.sandbox";
import { MediaImportPopulationWorkflowOutput } from "./schemas";

const completeReplay = async <Input extends JsonValue>(
	run: (
		input: Input,
		host: WorkflowSandboxHost,
		execution: { metadata: Record<string, JsonValue>; sandboxScriptId: string },
	) => Effect.Effect<WorkflowReplayEnvelope, SandboxHostError>,
	input: Input,
	resolve: (request: WorkflowReplayEnvelope["requests"][number]) => JsonValue,
) => {
	const journal: JsonValue[] = [];
	const replay = (): Promise<JsonValue> =>
		Effect.runPromise(
			run(
				input,
				{ durableCalls: () => Effect.succeed(journal) },
				{
					metadata: {},
					sandboxScriptId: "workflow-test",
				},
			),
		).then((envelope) => {
			if (envelope.state === "completed") {
				return envelope.output;
			}
			expect(envelope.state).toBe("pending");
			if (envelope.state === "failed") {
				throw new Error(envelope.error);
			}
			const request = envelope.requests[journal.length];
			assert(request);
			journal.push(resolve(request));
			return replay();
		});
	return replay();
};

it("keeps 205 resolution results aligned during in-process replay", async () => {
	const items = Array.from({ length: 205 }, (_, index) => ({
		index,
		identifierType: "isbn",
		value: `value-${index}`,
		candidates: [
			{ providerSlug: "book.openlibrary", scriptSlug: "media-import-resolve.book.openlibrary" },
		],
	}));
	const output = await completeReplay(resolutionWorkflow.run, { items }, (request) => ({
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
});

it("keeps ten concurrent in-process population replays isolated", async () => {
	const outputs = await Promise.all(
		Array.from({ length: 10 }, (_unused, workflowIndex) => {
			const items = Array.from({ length: 10 }, (_ignored, index) => ({
				index,
				entitySchemaSlug: "book",
				userId: `user-${workflowIndex}`,
				providerId: "provider-openlibrary",
				externalId: `external-${workflowIndex}-${index}`,
				origin: { kind: "import" as const, importRunId: `run-${workflowIndex}` },
			}));
			return completeReplay(populationWorkflow.run, { items }, (request) => {
				expect(request).toMatchObject({
					kind: "child",
					args: { workflowSlug: "kernel:entity-import" },
				});
				return { status: "completed", entity: { id: `entity-${workflowIndex}-${request.index}` } };
			});
		}),
	);

	expect(outputs).toHaveLength(10);
	for (const output of outputs) {
		expect(
			Schema.decodeUnknownSync(MediaImportPopulationWorkflowOutput)(output).results,
		).toHaveLength(10);
	}
});
