import { compilePluginSandboxSourceEntries } from "@ryot/sandbox-compiler/plugins";
import { sha256Hex } from "@ryot/ts-utils/crypto";
import { stableStringify } from "@ryot/ts-utils/json";
import { Context, Effect, Layer } from "effect";

import { DbRunner } from "#lib/infrastructure/db/service";
import { kernelScripts } from "#modules/definition-registry/kernel-source";

import { bootPluginSources } from "./boot-sources";
import { PluginRepository } from "./repository";
import { ScriptGarbageCollector } from "./script-garbage-collector";
import { PluginIngestionService } from "./service";
import { loadPluginSource } from "./source";

const digest = sha256Hex;

export class FirstPartyPluginBootstrap extends Context.Service<FirstPartyPluginBootstrap>()(
	"FirstPartyPluginBootstrap",
	{
		make: Effect.gen(function* () {
			const runWithDb = yield* DbRunner;
			const repository = yield* PluginRepository;
			const ingestion = yield* PluginIngestionService;
			const scriptGarbageCollector = yield* ScriptGarbageCollector;

			const ingestKernelScripts = Effect.fn("FirstPartyPluginBootstrap.ingestKernelScripts")(
				function* () {
					const files = Object.fromEntries(
						yield* Effect.forEach(kernelScripts, (script) =>
							Effect.tryPromise(() =>
								Bun.file(new URL(`../../../${script.entry}`, import.meta.url)).text(),
							).pipe(Effect.map((source) => [script.entry, source] as const)),
						),
					);
					const outputs = yield* compilePluginSandboxSourceEntries(files, kernelScripts);
					const compiledScripts = yield* Effect.forEach(kernelScripts, (script) =>
						Effect.gen(function* () {
							const output = outputs.find(({ entry }) => entry === script.entry);
							if (!output) {
								return yield* Effect.die(
									new Error(`Compiler returned no output for ${script.entry}`),
								);
							}
							const { entry: _entry, ...declaredMetadata } = script;
							if (stableStringify(declaredMetadata) !== stableStringify(output.compiled.manifest)) {
								return yield* Effect.die(
									new Error(`Declared kernel script metadata does not match ${script.entry}`),
								);
							}
							return {
								slug: script.slug,
								name: script.name,
								source: output.source,
								metadata: declaredMetadata,
								compiledFormat: output.compiled.format,
								compiledCode: output.compiled.javascript,
								contentHash: digest(output.compiled.javascript),
							};
						}),
					);
					yield* scriptGarbageCollector.recordKernelContentHashes(
						new Set(compiledScripts.map(({ contentHash }) => contentHash)),
					);
					yield* Effect.forEach(
						compiledScripts,
						(script) => runWithDb(repository.persistKernelScript(script)),
						{ discard: true },
					);
				},
			);

			const ingest = Effect.fn("FirstPartyPluginBootstrap.ingest")(function* () {
				yield* ingestion.rebuild();
				yield* ingestKernelScripts();
				for (const source of bootPluginSources) {
					const sourceEffect = loadPluginSource(source.packageRoot, source.manifest).pipe(
						Effect.flatMap(ingestion.ingestTrustedPlugin),
					);
					yield* sourceEffect;
				}
				yield* scriptGarbageCollector.collect();
			});

			yield* ingest();
			return { ingested: true as const };
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
