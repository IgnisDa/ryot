import { BunServices } from "@effect/platform-bun";
import { Effect, Layer } from "effect";

import { makeAppConfigLayer } from "#lib/test-utils/effect";
import { IngestionCaptures } from "#modules/imports/capture-service";
import { IngestionExecution } from "#modules/imports/execution-service";
import { ImportsRepository } from "#modules/imports/repository";
import { ImportWorkflowPinning } from "#modules/imports/workflow-pinning";
import { SandboxWorkflowReferenceRepository } from "#modules/sandbox/workflow-reference-repository";
import { IngestionPayloads } from "#modules/uploads/object-storage/ingestion-payloads";

export const ingestionRetirementTestLayer = Layer.effect(
	IngestionExecution,
	IngestionExecution.make,
).pipe(
	Layer.provide(
		Layer.effect(IngestionCaptures, IngestionCaptures.make).pipe(
			Layer.provide(Layer.effect(IngestionPayloads, IngestionPayloads.make)),
			Layer.provide(ImportsRepository.layer),
		),
	),
	Layer.provide(ImportsRepository.layer),
	Layer.provide(
		Layer.effect(
			ImportWorkflowPinning,
			Effect.map(SandboxWorkflowReferenceRepository, (references) => ({
				release: references.release,
				preRegister: () => Effect.die("Unexpected plugin admission during user retirement"),
			})),
		).pipe(Layer.provide(SandboxWorkflowReferenceRepository.layer)),
	),
	Layer.provide(Layer.mergeAll(BunServices.layer, makeAppConfigLayer())),
);
