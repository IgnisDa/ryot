import { Effect, Layer } from "effect";

import { DatabaseSession } from "#lib/infrastructure/db/session";
import { ImportSourceCatalog } from "#modules/plugins/import-source-catalog";
import { SandboxExecutionServiceLive } from "#modules/sandbox/layer";
import { SandboxExecutionService } from "#modules/sandbox/service";
import { UploadServicesLive } from "#modules/uploads/layer";

import { ImportRunFailuresService } from "./failure-service";
import { ImportsRepository } from "./repository";
import { ImportsService } from "./service";
import { ImportWorkflowPinning } from "./workflow-pinning";

export const ImportWorkflowPinningLive = Layer.effect(
	ImportWorkflowPinning,
	Effect.gen(function* () {
		const sandbox = yield* SandboxExecutionService;
		const session = yield* DatabaseSession;
		return {
			release: sandbox.releaseWorkflowRegistration,
			preRegister: (input) =>
				sandbox
					.preRegisterPluginWorkflow(input)
					.pipe(Effect.provideService(DatabaseSession, session)),
		};
	}),
).pipe(Layer.provide(SandboxExecutionServiceLive));

export const ImportsServiceLive = ImportsService.layer.pipe(
	Layer.provide(
		Layer.mergeAll(
			ImportsRepository.layer,
			UploadServicesLive,
			ImportSourceCatalog.layer,
			ImportRunFailuresService.layer.pipe(Layer.provide(ImportsRepository.layer)),
			ImportWorkflowPinningLive,
		),
	),
);
