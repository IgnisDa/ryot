import { BunServices } from "@effect/platform-bun";
import { SandboxRunError, unknownToMessage } from "@ryot-app/contract/errors";
import { sandboxCompilerPlatformLayer } from "@ryot-app/sandbox-compiler/platform";
import { hostFailure } from "@ryot-app/sandbox-sdk/wire";
import { sha256Hex } from "@ryot-app/ts-utils/crypto";
import { Context, Effect, Exit, Layer, Result, Schema, Semaphore } from "effect";

import { makeAppConfigLayer } from "#lib/test-utils/effect";
import { sandboxRuntimeDirectory } from "#lib/test-utils/sandbox-runtime";
import { loadPluginSandboxScripts } from "#modules/plugins/source.test-support";

import { MiB, SANDBOX_LIMITS } from "./limits";
import { SandboxSidecarClient } from "./sidecar-client";
import {
	SandboxInvocationResponseSchema,
	SandboxInvocationSchema,
	type SidecarInboundFrame,
	type SidecarOutboundFrame,
	type SidecarTier,
} from "./sidecar-protocol";
import { selectSnapshotTier } from "./snapshot-tier";

type SnapshotTier = typeof SidecarTier.Type;
type SidecarHostCall = Extract<SidecarOutboundFrame, { readonly type: "hostCall" }>;
type PluginScriptOutput = Effect.Success<ReturnType<typeof loadPluginSandboxScripts>>[number];

class PluginLoadVerificationSlots extends Context.Service<
	PluginLoadVerificationSlots,
	Semaphore.Semaphore
>()("PluginLoadVerificationSlots") {}

const maximumDiagnosticLength = 2_048;
const fixedStartedAt = "2026-08-06T00:00:00.000Z";
const internalControlNames = new Set([
	"artifactReadRange",
	"inlineBatch",
	"journalRead",
	"replayJournal",
	"scratchWrite",
]);
const excludedApiFunctions = new Set<string>(["filesystem", "replayJournal"]);
const generationByTier = { core: 1, data: 2, full: 3 } satisfies Record<SnapshotTier, number>;

const boundedText = (text: string) => text.slice(0, maximumDiagnosticLength);
const errorText = (error: unknown) => boundedText(unknownToMessage(error));
const pluginLoadFailure = (script: string, reason: string) =>
	new SandboxRunError({ kind: "script-failure", message: boundedText(`${script}: ${reason}`) });

export const pluginLoadLayer = Layer.unwrap(
	Effect.map(sandboxRuntimeDirectory, (runtimeDirectory) => {
		const appConfig = makeAppConfigLayer({ sandbox: { runtimeDirectory } });
		const sidecar = SandboxSidecarClient.layer.pipe(
			Layer.provideMerge(
				Layer.mergeAll(BunServices.layer, sandboxCompilerPlatformLayer, appConfig),
			),
		);
		return Layer.mergeAll(sidecar, Layer.effect(PluginLoadVerificationSlots, Semaphore.make(2)));
	}),
).pipe(Layer.provide(BunServices.layer));

const hostResult = (frame: SidecarHostCall): SidecarInboundFrame =>
	internalControlNames.has(frame.name)
		? ({
				seq: frame.seq,
				type: "hostResult",
				handle: frame.handle,
				generation: frame.generation,
				result: {
					status: "failure",
					message: "Plugin load check does not dispatch internal sandbox controls",
				},
			} satisfies SidecarInboundFrame)
		: ({
				seq: frame.seq,
				type: "hostResult",
				handle: frame.handle,
				generation: frame.generation,
				result: {
					status: "success",
					value: hostFailure("Plugin load check does not dispatch application capabilities"),
				},
			} satisfies SidecarInboundFrame);

const verifyScript = (
	connection: Effect.Success<ReturnType<SandboxSidecarClient["Service"]["connect"]>>,
	tier: SnapshotTier,
	generation: number,
	output: PluginScriptOutput,
	index: number,
) =>
	Effect.gen(function* () {
		const { compiled } = output;
		const { slug } = compiled.manifest;
		const moduleHash = sha256Hex(compiled.javascript);
		const handle = sha256Hex(`${generation}:${slug}:${moduleHash}:${index}`);
		const scriptId = `plugin-load:${slug}:${moduleHash}`;
		const executionId = `plugin-load:${slug}:${moduleHash}`;
		const filesystem = { scratch: false, artifact: false, namedArtifacts: [] };
		const apiFunctions = compiled.manifest.capabilities.filter(
			(capability) => !excludedApiFunctions.has(capability),
		);
		let runSent = false;
		let terminal = false;

		yield* connection
			.register(handle, "interactive")
			.pipe(Effect.mapError((error) => pluginLoadFailure(slug, errorText(error))));

		const waitForDone = Effect.gen(function* () {
			for (;;) {
				const event = yield* connection.next.pipe(
					Effect.mapError((error) => pluginLoadFailure(slug, errorText(error))),
				);
				if (event.type === "hostCall") {
					if (event.handle !== handle || event.generation !== generation) {
						return yield* pluginLoadFailure(slug, "Sidecar host call identity did not match");
					}
					yield* connection
						.send(hostResult(event))
						.pipe(Effect.mapError((error) => pluginLoadFailure(slug, errorText(error))));
					continue;
				}
				if (event.type === "done") {
					if (event.handle !== handle || event.generation !== generation) {
						return yield* pluginLoadFailure(slug, "Sidecar completion identity did not match");
					}
					terminal = true;
					return event;
				}
				if (event.type === "invalid") {
					return yield* pluginLoadFailure(slug, event.message);
				}
				return yield* pluginLoadFailure(slug, `Unexpected sidecar event: ${event.type}`);
			}
		});

		const awaitCancellation = Effect.gen(function* () {
			for (;;) {
				const event = yield* connection.next;
				if (event.type === "done" && event.handle === handle && event.generation === generation) {
					terminal = true;
					return true;
				}
				if (
					event.type === "hostCall" &&
					event.handle === handle &&
					event.generation === generation
				) {
					yield* connection.send(hostResult(event));
					continue;
				}
				return false;
			}
		});

		const cleanup = Effect.gen(function* () {
			if (runSent && !terminal) {
				yield* connection.send({ handle, seq: 0, generation, type: "cancel" }).pipe(Effect.ignore);
				const cancellation = yield* awaitCancellation.pipe(
					Effect.timeoutOrElse({ duration: "2 seconds", orElse: () => Effect.succeed(false) }),
					Effect.exit,
				);
				if (Exit.isFailure(cancellation) || !cancellation.value) {
					yield* connection.close.pipe(Effect.orDie);
				}
			}
			yield* connection.retire(handle);
		});

		const run = Effect.gen(function* () {
			const invocation = yield* Schema.decodeEffect(SandboxInvocationSchema)({
				scriptId,
				filesystem,
				executionId,
				context: {},
				apiFunctions,
				mode: "definition",
				startedAt: fixedStartedAt,
				metadata: compiled.manifest,
				compiledFormat: compiled.format,
			}).pipe(Effect.mapError((error) => pluginLoadFailure(slug, errorText(error))));
			const input = yield* Schema.decodeUnknownEffect(Schema.Json)(invocation).pipe(
				Effect.mapError((error) => pluginLoadFailure(slug, errorText(error))),
			);
			yield* connection
				.send({
					tier,
					input,
					seq: 0,
					handle,
					generation,
					type: "run",
					lane: "interactive",
					module: { sha256: moduleHash, source: compiled.javascript },
					limits: { ...SANDBOX_LIMITS.isolate, deadlineMs: SANDBOX_LIMITS.execution.timeoutMs },
				})
				.pipe(Effect.mapError((error) => pluginLoadFailure(slug, errorText(error))));
			runSent = true;
			const done = yield* waitForDone;
			if (done.outcome.status !== "completed") {
				let reason: string = done.outcome.status;
				if (done.outcome.status === "failed") {
					reason = `${done.outcome.phase}: ${done.outcome.message}`;
				} else if (done.outcome.status === "limit") {
					reason = `${done.outcome.limit}: ${done.outcome.message}`;
				}
				return yield* pluginLoadFailure(slug, `Sidecar execution did not complete: ${reason}`);
			}
			const response = yield* Schema.decodeUnknownEffect(SandboxInvocationResponseSchema)(
				done.outcome.value,
			).pipe(Effect.mapError((error) => pluginLoadFailure(slug, errorText(error))));
			if (!response.success && response.error.phase === "load") {
				return yield* pluginLoadFailure(slug, response.error.message);
			}
			return undefined;
		});

		return yield* Effect.ensuring(run, cleanup);
	});

const verifyTier = (tier: SnapshotTier, outputs: ReadonlyArray<PluginScriptOutput>) =>
	Effect.scoped(
		Effect.gen(function* () {
			const client = yield* SandboxSidecarClient;
			const generation = generationByTier[tier];
			const connection = yield* client
				.connect({
					tier,
					generation,
					threads: 1,
					maxActive: 1,
					trust: "user",
					maxRss: 450 * MiB,
					memoryBudget: 388 * MiB,
				})
				.pipe(Effect.mapError((error) => pluginLoadFailure(tier, errorText(error))));
			const ready = yield* connection.next.pipe(
				Effect.mapError((error) => pluginLoadFailure(tier, errorText(error))),
			);
			if (ready.type !== "ready" || ready.generation !== generation) {
				return yield* pluginLoadFailure(
					tier,
					boundedText(
						`Sidecar did not become ready${connection.diagnostics() ? `: ${connection.diagnostics()}` : ""}`,
					),
				);
			}

			for (const [index, output] of outputs.entries()) {
				yield* verifyScript(connection, tier, generation, output, index);
			}
			yield* connection.close.pipe(
				Effect.mapError((error) => pluginLoadFailure(tier, errorText(error))),
			);
			const exit = yield* connection.exit;
			if (exit.code !== 0) {
				return yield* pluginLoadFailure(
					tier,
					`Sidecar exited with code ${String(exit.code)} and signal ${String(exit.signal)}`,
				);
			}
			return undefined;
		}),
	);

export const verifyPluginSandboxScriptsLoad = (packageRoot: string) =>
	Effect.scoped(
		Effect.gen(function* () {
			const outputs = yield* loadPluginSandboxScripts(packageRoot);
			const grouped = new Map<SnapshotTier, Array<(typeof outputs)[number]>>();
			for (const output of outputs) {
				const selectedTier = selectSnapshotTier(output.compiled.manifest.runtimeImports);
				if (Result.isFailure(selectedTier)) {
					return yield* pluginLoadFailure(
						output.compiled.manifest.slug,
						`Unknown runtime imports: ${selectedTier.failure.imports.join(", ")}`,
					);
				}
				const scripts = grouped.get(selectedTier.success) ?? [];
				scripts.push(output);
				grouped.set(selectedTier.success, scripts);
			}

			const slots = yield* PluginLoadVerificationSlots;
			yield* Effect.forEach(
				[...grouped.entries()],
				([tier, scripts]) => slots.withPermits(1)(verifyTier(tier, scripts)),
				{ discard: true, concurrency: 2 },
			);
			return undefined;
		}),
	);
