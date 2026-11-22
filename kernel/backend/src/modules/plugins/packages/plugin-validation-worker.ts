import { runCompilerWorker } from "@ryot-app/compiler-worker/host";
import { Effect, Layer } from "effect";

import { servePluginValidationRequest } from "./validation-worker-protocol";

runCompilerWorker({
	warmUp: Effect.void,
	layer: () => Layer.empty,
	handle: servePluginValidationRequest,
});
