import type { ImportRunFailureReason } from "@ryot-app/contract/modules/imports/schemas";
import type { ImportRunFailureStage } from "@ryot-app/contract/modules/imports/types";
import type { ImportRunId } from "@ryot-app/contract/schema/brands";
import { Context, Effect, Layer } from "effect";

import { ImportsRepository } from "./repository";

export type ImportRunFailureInput = {
	itemIndex: number;
	runId: ImportRunId;
	stage: ImportRunFailureStage;
	reason: ImportRunFailureReason;
	sourceLabel?: string | null | undefined;
	eventSchemaSlug?: string | null | undefined;
	sourceIdentifier?: string | null | undefined;
	entitySchemaSlug?: string | null | undefined;
};

export type ImportRunFailureDetails = Omit<ImportRunFailureInput, "runId">;

export class ImportRunFailuresService extends Context.Service<ImportRunFailuresService>()(
	"ImportRunFailuresService",
	{
		make: Effect.gen(function* () {
			const repository = yield* ImportsRepository;

			const create = Effect.fn("ImportRunFailuresService.create")(function* (
				input: ImportRunFailureInput,
			) {
				yield* repository.createFailure(input);
			});

			return { create };
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
