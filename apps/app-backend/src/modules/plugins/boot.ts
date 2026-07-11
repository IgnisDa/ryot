import { compilePluginSandboxSourceEntries } from "@ryot/sandbox-compiler/plugins";
import { stableStringify } from "@ryot/ts-utils/json";
import { Effect } from "effect";

import { DbRunner } from "#lib/infrastructure/db/service";
import { kernelScripts } from "#modules/definition-registry/kernel-source";

import { bootPluginSources } from "./boot-sources";
import { PluginRepository } from "./repository";
import { PluginIngestionService } from "./service";
import { loadPluginSource } from "./source";

const digest = (value: string) => new Bun.CryptoHasher("sha256").update(value).digest("hex");

export class FirstPartyPluginBootstrap extends Effect.Service<FirstPartyPluginBootstrap>()(
	"FirstPartyPluginBootstrap",
	{
		effect: Effect.gen(function* () {
			const runWithDb = yield* DbRunner;
			const repository = yield* PluginRepository;
			const ingestion = yield* PluginIngestionService;

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
					for (const script of kernelScripts) {
						const output = outputs.find(({ entry }) => entry === script.entry);
						if (!output) {
							return yield* Effect.dieMessage(`Compiler returned no output for ${script.entry}`);
						}
						const { entry: _entry, ...declaredMetadata } = script;
						if (stableStringify(declaredMetadata) !== stableStringify(output.compiled.manifest)) {
							return yield* Effect.dieMessage(
								`Declared kernel script metadata does not match ${script.entry}`,
							);
						}
						yield* runWithDb(
							repository.persistKernelScript({
								slug: script.slug,
								name: script.name,
								source: output.source,
								compiledFormat: output.compiled.format,
								compiledCode: output.compiled.javascript,
								contentHash: digest(output.compiled.javascript),
								metadata: declaredMetadata,
							}),
						);
					}
					return yield* Effect.void;
				},
			);

			const ingest = Effect.fn("FirstPartyPluginBootstrap.ingest")(function* () {
				yield* ingestion.rebuild();
				yield* ingestKernelScripts();
				for (const source of bootPluginSources) {
					const sourceEffect = loadPluginSource(source.packageRoot, source.manifest).pipe(
						Effect.flatMap(ingestion.ingestPlugin),
					);
					yield* sourceEffect;
				}
			});

			yield* ingest();
			return { ingested: true as const };
		}),
	},
) {}
