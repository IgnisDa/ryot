import type { PluginArchiveCompiledScript } from "@ryot-app/plugin-archive";
import { sha256Hex } from "@ryot-app/ts-utils/crypto";
import { Context, Effect, Layer } from "effect";

import { Database, mapDatabaseErrors } from "#lib/infrastructure/db/service";
import { kernelScriptCompiledOutputs } from "#modules/definition-registry/kernel-scripts.compiled.generated";
import { kernelDefinitionSource, kernelScripts } from "#modules/definition-registry/kernel-source";
import { DefinitionRepository } from "#modules/definition-registry/repository";

import { ClientSurfaceMaterializer } from "./client-surface-materializer";
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
			const surfaces = yield* ClientSurfaceMaterializer;
			const loadKernelScripts = Effect.fn("SystemPluginBootstrap.loadKernelScripts")(function* () {
				const declaredScripts: ReadonlyArray<(typeof kernelScripts)[number]> = kernelScripts;
				const outputs = new Map<string, PluginArchiveCompiledScript>(
					(kernelScriptCompiledOutputs satisfies ReadonlyArray<PluginArchiveCompiledScript>).map(
						(output: PluginArchiveCompiledScript) => [output.entry, output],
					),
				);
				if (
					outputs.size !== kernelScriptCompiledOutputs.length ||
					outputs.size !== declaredScripts.length
				) {
					return yield* Effect.die(
						new Error("Generated kernel compiled scripts do not match declarations"),
					);
				}
				return yield* Effect.forEach(declaredScripts, (script) => {
					const output = outputs.get(script.entry);
					if (!output) {
						return Effect.die(
							new Error(`Generated kernel script output is missing ${script.entry}`),
						);
					}
					const { entry: _entry, ...metadata } = script;
					return Effect.succeed({
						metadata,
						slug: script.slug,
						name: script.name,
						source: output.source,
						compiledFormat: output.format,
						compiledCode: output.javascript,
						contentHash: digest(output.javascript),
					});
				});
			});
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
				const compiledScripts = yield* loadKernelScripts();
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
				yield* surfaces.materializeSystemCompositions;
				yield* scriptGarbageCollector.collect();
			});

			yield* ingest();
			return { ingested: true as const };
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
