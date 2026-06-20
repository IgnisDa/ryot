import { SandboxRunError, unknownToMessage } from "@ryot/contract/errors";
import {
	SandboxProviderArtifactReference,
	SandboxProviderValue,
	type SandboxCompletedResult,
} from "@ryot/contract/modules/sandbox/schemas";
import { Effect, Schema } from "effect";

import { DbRunner } from "#lib/infrastructure/db/service";

import { SandboxRepository } from "./repository";

const isProviderArtifactReference = Schema.is(SandboxProviderArtifactReference);
const isProviderValue = Schema.is(SandboxProviderValue);

export const resolveProviderSandboxArtifact = Effect.fn("resolveProviderSandboxArtifact")(
	function* (input: { executionId: string; result: SandboxCompletedResult }) {
		if (isProviderValue(input.result.value)) {
			return { ...input.result, value: input.result.value.value };
		}
		if (!isProviderArtifactReference(input.result.value)) {
			return input.result;
		}

		const runWithDb = yield* DbRunner;
		const repository = yield* SandboxRepository;
		const artifact = yield* runWithDb(
			repository.getProviderArtifact({ executionId: input.executionId, id: input.result.value.id }),
		).pipe(Effect.mapError((error) => new SandboxRunError({ message: unknownToMessage(error) })));
		if (!artifact) {
			return yield* new SandboxRunError({
				message: `Sandbox provider artifact '${input.result.value.id}' was not found`,
			});
		}

		return { ...input.result, value: artifact.value };
	},
);
