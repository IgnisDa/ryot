import { compilePluginSandboxSourceEntries } from "@ryot-app/sandbox-compiler/plugins";
import { sha256Hex } from "@ryot-app/ts-utils/crypto";
import { stableStringify } from "@ryot-app/ts-utils/json";
import { Context, Effect, Layer } from "effect";

import { Database, mapDatabaseErrors } from "#lib/infrastructure/db/service";
import { kernelScriptSources } from "#modules/definition-registry/kernel-scripts.generated";
import { kernelDefinitionSource, kernelScripts } from "#modules/definition-registry/kernel-source";
import { DefinitionRepository } from "#modules/definition-registry/repository";

import { PluginInstallationService } from "./installation-service";
import { PluginRepository } from "./repository";
import { ScriptGarbageCollector } from "./script-garbage-collector";
import { PluginIngestionService } from "./service";
import { SystemPlugins } from "./system";

const digest = sha256Hex;

export class SystemPluginBootstrap extends Context.Service<SystemPluginBootstrap>()(
	"SystemPluginBootstrap",
	{
		make: Effect.gen(function* () {
			const database = yield* Database;
			const repository = yield* PluginRepository;
			const definitions = yield* DefinitionRepository;
			const systemPlugins = yield* SystemPlugins;
			const ingestion = yield* PluginIngestionService;
			const installations = yield* PluginInstallationService;
			const scriptGarbageCollector = yield* ScriptGarbageCollector;
			const compileKernelScripts = Effect.fn("SystemPluginBootstrap.compileKernelScripts")(
				function* () {
					const outputs = yield* compilePluginSandboxSourceEntries(
						kernelScriptSources,
						kernelScripts,
					);
					return yield* Effect.forEach(kernelScripts, (script) =>
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
				},
			);
			const inTransaction = <A, E>(effect: Effect.Effect<A, E, Database>) =>
				mapDatabaseErrors(
					database.transaction((transaction) =>
						repository
							.lockIngestion()
							.pipe(Effect.andThen(effect), Effect.provideService(Database, transaction)),
					),
				);

			const ingest = Effect.fn("SystemPluginBootstrap.ingest")(function* () {
				yield* repository.validateConfigurationKeys();
				const compiledScripts = yield* compileKernelScripts();
				yield* inTransaction(
					Effect.gen(function* () {
						yield* Effect.forEach(
							compiledScripts,
							(script) => repository.persistKernelScript(script),
							{ discard: true },
						);
						yield* definitions.replaceKernelDefinitions(kernelDefinitionSource());
						yield* ingestion.validateActiveSystemPlugins();
					}),
				);
				for (const source of systemPlugins.sources) {
					yield* ingestion.ingestSystemPlugin(source);
				}
				yield* inTransaction(repository.resolveEnvironmentConfigs());
				yield* installations.reconcileSystemInstallations();
				yield* scriptGarbageCollector.collect();
			});

			yield* ingest();
			return { ingested: true as const };
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
