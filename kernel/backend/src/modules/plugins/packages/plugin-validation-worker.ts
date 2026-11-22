import { runCompilerWorker } from "@ryot-app/compiler-worker/host";
import { serveDefinitionSetValidation } from "@ryot-app/definitions/definition-set-protocol";
import { Effect, Layer } from "effect";

runCompilerWorker({
	warmUp: Effect.void,
	layer: () => Layer.empty,
	handle: serveDefinitionSetValidation,
});
