import { Effect, Layer } from "effect";

import { IngestionCaptures } from "#modules/imports/capture-service";
import { IngestionExecution } from "#modules/imports/execution-service";
import { ImportsRepository } from "#modules/imports/repository";
import { IngestionRetirement } from "#modules/imports/retirement-service";
import { IntegrationIngestion } from "#modules/integrations/ingestion";

export const integrationCrudIngestionLayer = Layer.effect(
	IntegrationIngestion,
	Effect.gen(function* () {
		const execution = yield* IngestionExecution;
		return {
			expire: () => Effect.die("Unexpected delivery expiry in CRUD fixture"),
			recoverInput: () => Effect.die("Unexpected delivery recovery in CRUD fixture"),
			admitWebhook: () => Effect.die("Unexpected webhook admission in CRUD fixture"),
			recoverable: () => Effect.die("Unexpected integration recovery in CRUD fixture"),
			release: () => Effect.die("Unexpected integration execution release in CRUD fixture"),
			inputReady: () => Effect.die("Unexpected integration input readiness in CRUD fixture"),
			settle: (scope, status, failureReason) =>
				execution.settle({
					scope,
					status,
					...(failureReason ? { failureReason } : {}),
					reconcile: () => Effect.die("Unexpected batch in integration CRUD fixture"),
				}),
		};
	}),
).pipe(
	Layer.merge(
		IngestionRetirement.layer.pipe(
			Layer.provide(Layer.mergeAll(IngestionCaptures.layer, ImportsRepository.layer)),
		),
	),
);
