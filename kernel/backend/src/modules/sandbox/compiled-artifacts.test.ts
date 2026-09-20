import { assert, expect, layer } from "@effect/vitest";
import { SandboxRunError } from "@ryot-app/contract/errors";
import { SandboxScriptId } from "@ryot-app/contract/schema/brands";
import { emptySandboxExecutionMetadata } from "@ryot-app/contract/testing";
import { SANDBOX_COMPILED_FORMAT } from "@ryot-app/sandbox-compiler/protocol";
import { sha256Hex } from "@ryot-app/ts-utils/crypto";
import { Context, Deferred, Effect, Fiber, Layer } from "effect";

import { SANDBOX_LIMITS } from "#lib/infrastructure/sandbox-runtime/limits";
import { assertExitFails } from "#lib/test-utils/assertions";

import { SandboxCompiledArtifacts } from "./compiled-artifacts";
import { SandboxRepository } from "./repository";
import { compiledArtifactsLayer } from "./sandbox-fixtures.test-support";

type StoredScript = NonNullable<
	Effect.Success<ReturnType<SandboxRepository["Service"]["getScript"]>>
>;

const compiledScript = (
	id: SandboxScriptId,
	compiledCode: string,
	contentHash = sha256Hex(compiledCode),
	compiledFormat: number = SANDBOX_COMPILED_FORMAT,
): StoredScript => ({
	id,
	contentHash,
	compiledCode,
	compiledFormat,
	providerId: null,
	metadata: emptySandboxExecutionMetadata,
});

const repositoryLayer = (getScript: SandboxRepository["Service"]["getScript"]) =>
	Layer.succeed(
		SandboxRepository,
		SandboxRepository.of({
			getScript,
			getScriptPin: () => Effect.die("script pins are unused"),
			isPluginScript: () => Effect.die("plugin script checks are unused"),
			resolveWorkflowCallScript: () => Effect.die("workflow call resolution is unused"),
		}),
	);

const missingArtifact = () =>
	new SandboxRunError({
		kind: "missing-artifact",
		message: "Sandbox compiled artifact is missing or invalid",
	});

class ArtifactLookupGate extends Context.Service<
	ArtifactLookupGate,
	{ readonly entered: Deferred.Deferred<void>; readonly release: Deferred.Deferred<void> }
>()("test/ArtifactLookupGate") {}

const concurrentScriptIds: ReadonlyArray<SandboxScriptId> = [
	SandboxScriptId.make("compiled-artifact-concurrent-a"),
	SandboxScriptId.make("compiled-artifact-concurrent-b"),
];
const concurrentCode = "globalThis.shared = true";
const concurrentHash = sha256Hex(concurrentCode);
const concurrentReads: Array<SandboxScriptId> = [];
const concurrentLayer = Layer.unwrap(
	Effect.gen(function* () {
		const entered = yield* Deferred.make<void>();
		const release = yield* Deferred.make<void>();
		const repository = repositoryLayer((scriptId) =>
			Effect.sync(() => concurrentReads.push(scriptId)).pipe(
				Effect.andThen(Deferred.succeed(entered, undefined)),
				Effect.andThen(Deferred.await(release)),
				Effect.as(compiledScript(scriptId, concurrentCode)),
			),
		);
		const artifacts = compiledArtifactsLayer(repository);
		return Layer.merge(artifacts, Layer.succeed(ArtifactLookupGate, { entered, release }));
	}),
);

layer(concurrentLayer, { excludeTestServices: true })((test) => {
	test.effect("shares matching compiled bytes across script ids and concurrent reads", () =>
		Effect.gen(function* () {
			const artifacts = yield* SandboxCompiledArtifacts;
			const gate = yield* ArtifactLookupGate;
			const fiber = yield* Effect.forkChild(
				Effect.forEach(
					concurrentScriptIds,
					(scriptId) => artifacts.get({ scriptId, contentHash: concurrentHash }),
					{ concurrency: "unbounded" },
				),
			);
			yield* Deferred.await(gate.entered);
			yield* Deferred.succeed(gate.release, undefined);
			const results = yield* Fiber.join(fiber);
			expect(results).toEqual([
				{ compiledCode: concurrentCode, compiledFormat: SANDBOX_COMPILED_FORMAT },
				{ compiledCode: concurrentCode, compiledFormat: SANDBOX_COMPILED_FORMAT },
			]);
			expect(concurrentReads).toHaveLength(1);
		}),
	);
});

const oversizedCode = "x".repeat(SANDBOX_LIMITS.compiler.javascriptBytes + 1);
const mismatchId = SandboxScriptId.make("compiled-artifact-row-hash-mismatch");
const digestId = SandboxScriptId.make("compiled-artifact-digest-mismatch");
const oversizedId = SandboxScriptId.make("compiled-artifact-oversized");
const unsupportedId = SandboxScriptId.make("compiled-artifact-unsupported-format");
const mismatchCode = "compiled-artifact-row-hash";
const digestCode = "compiled-artifact-digest-bytes";
const digestHash = sha256Hex("expected-digest");
const unsupportedCode = "compiled-artifact-unsupported";
const invalidArtifacts = [
	{
		principal: { scriptId: mismatchId, contentHash: sha256Hex(mismatchCode) },
		script: compiledScript(mismatchId, mismatchCode, sha256Hex("different-row-hash")),
	},
	{
		script: compiledScript(digestId, digestCode, digestHash),
		principal: { scriptId: digestId, contentHash: digestHash },
	},
	{
		script: compiledScript(oversizedId, oversizedCode),
		principal: { scriptId: oversizedId, contentHash: sha256Hex(oversizedCode) },
	},
	{
		principal: { scriptId: unsupportedId, contentHash: sha256Hex(unsupportedCode) },
		script: compiledScript(
			unsupportedId,
			unsupportedCode,
			sha256Hex(unsupportedCode),
			SANDBOX_COMPILED_FORMAT + 1,
		),
	},
];
const invalidScripts = new Map(invalidArtifacts.map(({ script }) => [script.id, script]));
const invalidReads = new Map<SandboxScriptId, number>();
const invalidArtifactsLayer = compiledArtifactsLayer(
	repositoryLayer((scriptId) =>
		Effect.sync(() => {
			invalidReads.set(scriptId, (invalidReads.get(scriptId) ?? 0) + 1);
			return invalidScripts.get(scriptId) ?? null;
		}),
	),
);

layer(invalidArtifactsLayer, { excludeTestServices: true })((test) => {
	test.effect("does not cache mismatched, oversized, or unsupported compiled bytes", () =>
		Effect.gen(function* () {
			const artifacts = yield* SandboxCompiledArtifacts;
			for (const { principal } of invalidArtifacts) {
				assertExitFails(yield* Effect.exit(artifacts.get(principal)), missingArtifact());
				assertExitFails(yield* Effect.exit(artifacts.get(principal)), missingArtifact());
				expect(invalidReads.get(principal.scriptId)).toBe(2);
			}
		}),
	);
});

const retryScriptId = SandboxScriptId.make("compiled-artifact-retry");
const retryCode = "compiled-artifact-after-retry";
const retryHash = sha256Hex(retryCode);
let retryScript: StoredScript | null = null;
let retryReads = 0;
const retryLayer = compiledArtifactsLayer(
	repositoryLayer((scriptId) =>
		Effect.sync(() => {
			retryReads += 1;
			return scriptId === retryScriptId ? retryScript : null;
		}),
	),
);

layer(retryLayer, { excludeTestServices: true })((test) => {
	test.effect("retries a failed lookup and returns newly available compiled bytes", () =>
		Effect.gen(function* () {
			const artifacts = yield* SandboxCompiledArtifacts;
			assertExitFails(
				yield* Effect.exit(artifacts.get({ contentHash: retryHash, scriptId: retryScriptId })),
				missingArtifact(),
			);
			retryScript = compiledScript(retryScriptId, retryCode);
			expect(yield* artifacts.get({ contentHash: retryHash, scriptId: retryScriptId })).toEqual({
				compiledCode: retryCode,
				compiledFormat: SANDBOX_COMPILED_FORMAT,
			});
			expect(retryReads).toBe(2);
		}),
	);
});

const capacityScripts = new Map<SandboxScriptId, StoredScript>();
const capacityPrincipals = Array.from({ length: 17 }, (_, index) => {
	const scriptId = SandboxScriptId.make(`compiled-artifact-capacity-${index}`);
	const compiledCode = `compiled artifact ${index}`;
	const script = compiledScript(scriptId, compiledCode);
	capacityScripts.set(scriptId, script);
	return { scriptId, contentHash: script.contentHash };
});
const capacityReads = new Map<SandboxScriptId, number>();
const capacityLayer = compiledArtifactsLayer(
	repositoryLayer((scriptId) =>
		Effect.sync(() => {
			capacityReads.set(scriptId, (capacityReads.get(scriptId) ?? 0) + 1);
			return capacityScripts.get(scriptId) ?? null;
		}),
	),
);

layer(capacityLayer, { excludeTestServices: true })((test) => {
	test.effect("reloads a valid old hash after capacity eviction", () =>
		Effect.gen(function* () {
			const artifacts = yield* SandboxCompiledArtifacts;
			for (const principal of capacityPrincipals.slice(0, 16)) {
				yield* artifacts.get(principal);
			}
			const evictingPrincipal = capacityPrincipals[16];
			const firstPrincipal = capacityPrincipals[0];
			assert(evictingPrincipal !== undefined);
			assert(firstPrincipal !== undefined);
			yield* artifacts.get(evictingPrincipal);
			yield* artifacts.get(firstPrincipal);
			expect(capacityReads.get(firstPrincipal.scriptId)).toBe(2);
			expect(capacityReads.get(evictingPrincipal.scriptId)).toBe(1);
		}),
	);
});
