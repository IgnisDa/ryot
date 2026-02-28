import type { ImportRunFailureStage } from "@ryot/contract/modules/imports/types";
import type { ImportRunId } from "@ryot/contract/schema/brands";
import { Effect } from "effect";

import { DbRunner } from "#lib/infrastructure/db/service";

import { ImportsRepository } from "./repository";

export type ImportRunFailureInput = {
	message: string;
	itemIndex: number;
	runId: ImportRunId;
	stage: ImportRunFailureStage;
	sourceLabel?: string | null | undefined;
	eventSchemaSlug?: string | null | undefined;
	sourceIdentifier?: string | null | undefined;
	entitySchemaSlug?: string | null | undefined;
	context?: Record<string, unknown> | null | undefined;
};

export type ImportRunFailureDetails = Omit<ImportRunFailureInput, "runId">;

export class ImportRunFailuresService extends Effect.Service<ImportRunFailuresService>()(
	"ImportRunFailuresService",
	{
		effect: Effect.gen(function* () {
			const runWithDb = yield* DbRunner;
			const repository = yield* ImportsRepository;

			const create = Effect.fn("ImportRunFailuresService.create")(function* (
				input: ImportRunFailureInput,
			) {
				yield* runWithDb(repository.createFailure(input));
			});

			return { create };
		}),
	},
) {}
