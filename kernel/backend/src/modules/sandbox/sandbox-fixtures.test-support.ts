import { Layer } from "effect";

import { SandboxCompiledArtifacts } from "./compiled-artifacts";
import type { SandboxRepository } from "./repository";

export const compiledArtifactsLayer = <E, R>(repository: Layer.Layer<SandboxRepository, E, R>) =>
	Layer.effect(SandboxCompiledArtifacts, SandboxCompiledArtifacts.make).pipe(
		Layer.provideMerge(repository),
	);
