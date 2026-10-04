import type { SandboxScriptId } from "@ryot-app/contract/schema/brands";
import { sha256Hex } from "@ryot-app/ts-utils/crypto";
import { Effect, Layer } from "effect";

import { SandboxCompiledArtifacts } from "./compiled-artifacts";
import { KernelWorkflowReferences } from "./kernel-workflow-references";
import { SandboxRepository } from "./repository";

export const compiledArtifactsLayer = <E, R>(repository: Layer.Layer<SandboxRepository, E, R>) =>
	Layer.effect(SandboxCompiledArtifacts, SandboxCompiledArtifacts.make).pipe(
		Layer.provideMerge(repository),
	);

export const unusedKernelWorkflowReferencesLayer = Layer.succeed(KernelWorkflowReferences, {
	execute: () => Effect.die("kernel dispatch is not expected"),
	resolveArtifactGrants: (_input, _subject, grants) => Effect.succeed(grants),
});

export const scriptRepositoryLayer = (
	scriptOf: (
		id: SandboxScriptId,
	) => Effect.Success<ReturnType<SandboxRepository["Service"]["getScript"]>>,
	extra: Partial<SandboxRepository["Service"]> = {},
) => Layer.mock(SandboxRepository)({ ...extra, getScript: (id) => Effect.succeed(scriptOf(id)) });

export const hotSwapScript = <Metadata>(
	id: SandboxScriptId,
	compiledCode: string,
	metadata: Metadata,
) => ({
	id,
	metadata,
	compiledCode,
	slug: "workflow",
	name: "Workflow",
	providerId: null,
	compiledFormat: 1,
	source: compiledCode,
	createdAt: new Date(0),
	updatedAt: new Date(0),
	contentHash: sha256Hex(compiledCode),
});
