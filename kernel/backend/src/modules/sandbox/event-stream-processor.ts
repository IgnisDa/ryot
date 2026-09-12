import { DbError } from "@ryot-app/contract/errors";
import { Effect, Layer } from "effect";

import { EventStreamProcessor } from "#modules/events/stream-work";

import { SandboxExecutionService } from "./service";

export const EventStreamProcessorLive = Layer.effect(
	EventStreamProcessor,
	Effect.gen(function* () {
		const sandbox = yield* SandboxExecutionService;
		const execute: EventStreamProcessor["Service"]["execute"] = (claim, executionId) =>
			sandbox
				.executeWorkflow({
					executionId,
					input: claim.input,
					pluginRevision: claim.pluginPin,
					scriptId: claim.processorScriptId,
					subject: {
						type: "user",
						userId: claim.accountGeneration.userId,
						accountGeneration: claim.accountGeneration,
					},
				})
				.pipe(Effect.mapError((error) => new DbError({ message: error.message })));
		return { execute };
	}),
);
