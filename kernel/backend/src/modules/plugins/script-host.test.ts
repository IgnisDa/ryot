import { assert, expect, layer } from "@effect/vitest";
import { pluginConfigEnvironmentKey } from "@ryot-app/contract/modules/plugins/plugin-config";
import { UserId } from "@ryot-app/contract/schema/brands";
import { eq } from "drizzle-orm";
import { ConfigProvider, Effect, Layer, Schema } from "effect";

import { ImportSourceStateStore } from "#modules/imports/runtime/source-state-store";
import { ScriptPluginRevision } from "#modules/scripts/authorization/principal";
import { makeUserRunInput } from "#modules/scripts/authorization/principal.test-support";
import { DatabaseSession } from "#platform/db/session";
import * as tables from "#schema/tables/combined";

import { PluginRepository } from "./packages/repository";
import {
	installRevisionPackage,
	revisionDatabaseLayer,
	revisionPackage,
} from "./packages/revision.test-support";
import { PluginUserSettingsWriter } from "./preferences/user-settings-writer";
import { makePluginScriptHost } from "./script-host";

const hostLayer = Layer.mergeAll(
	revisionDatabaseLayer,
	Layer.succeed(PluginUserSettingsWriter, {
		save: () => Effect.die("unused"),
		patch: () => Effect.die("unused"),
	}),
	Layer.succeed(ImportSourceStateStore, {
		load: () => Effect.die("unused"),
		store: () => Effect.die("unused"),
		materialize: () => Effect.die("unused"),
		loadEnvelope: () => Effect.die("unused"),
		storeEnvelope: () => Effect.die("unused"),
		materializeEnvelope: () => Effect.die("unused"),
	}),
);

layer(hostLayer)((test) => {
	test.effect("late host reads retain exact config pins after environment reactivation", () =>
		Effect.gen(function* () {
			const plugin = revisionPackage("pinned-config");
			const environmentKey = pluginConfigEnvironmentKey(
				plugin.manifest.metadata.packageId,
				"token",
			);
			const installed = yield* installRevisionPackage(plugin).pipe(
				Effect.provideService(
					ConfigProvider.ConfigProvider,
					ConfigProvider.fromUnknown({ [environmentKey]: "admitted-token" }),
				),
			);
			const database = yield* DatabaseSession;
			const readPin = Effect.gen(function* () {
				const [row] = yield* database.run((db) =>
					db.select().from(tables.plugin).where(eq(tables.plugin.id, installed.pluginId)),
				);
				assert(row?.environmentConfigRevisionId);
				return row.environmentConfigRevisionId;
			});
			const admittedPin = yield* readPin;
			const revision = yield* Schema.decodeEffect(ScriptPluginRevision)({
				ownerId: null,
				scope: "system",
				compiledHashes: {},
				workflowScripts: {},
				id: installed.pluginId,
				userBootstrapScriptSlugs: [],
				configRevisionId: admittedPin,
				revisionId: installed.revisionId,
				configSchema: plugin.manifest.configSchema,
				packageId: plugin.manifest.metadata.packageId,
				schemaScope: {
					eventSchemas: [],
					entitySchemaSlugs: [],
					signalSchemaSlugs: [],
					relationshipSchemaSlugs: [],
				},
			});
			const input = makeUserRunInput({
				lane: "background",
				workflowExecutionId: "retained-execution",
				principal: {
					pluginRevision: revision,
					metadata: { runtimeImports: [], requiredPluginConfigKeys: ["token"] },
				},
			});
			const host = yield* makePluginScriptHost;
			expect(yield* host.getPluginConfig(input, { required: ["token"] })).toEqual({
				token: "admitted-token",
			});
			const plugins = yield* PluginRepository;
			yield* database
				.transaction(
					plugins.lockIngestion().pipe(Effect.andThen(plugins.resolveEnvironmentConfigs())),
				)
				.pipe(
					Effect.provideService(
						ConfigProvider.ConfigProvider,
						ConfigProvider.fromUnknown({ [environmentKey]: "reactivated-token" }),
					),
				);
			const activePin = yield* readPin;
			expect(activePin).not.toBe(admittedPin);
			expect(
				yield* host
					.getPluginConfig(input, { required: ["token"] })
					.pipe(
						Effect.provideService(
							ConfigProvider.ConfigProvider,
							ConfigProvider.fromUnknown({ [environmentKey]: "live-token" }),
						),
					),
			).toEqual({ token: "admitted-token" });
			expect(
				yield* host.getPluginConfig(
					{
						...input,
						principal: {
							...input.principal,
							pluginRevision: yield* Schema.decodeEffect(ScriptPluginRevision)({
								...revision,
								configRevisionId: activePin,
							}),
						},
					},
					{ required: ["token"] },
				),
			).toEqual({ token: "reactivated-token" });
			for (const invalid of [
				{ ...revision, ownerId: UserId.make("recipient") },
				{ ...revision, revisionId: "missing-revision" },
				{ ...revision, configRevisionId: "missing-config" },
			]) {
				expect(
					yield* host
						.getPluginConfig(
							{
								...input,
								principal: {
									...input.principal,
									pluginRevision: yield* Schema.decodeEffect(ScriptPluginRevision)(invalid),
								},
							},
							{ required: ["token"] },
						)
						.pipe(Effect.result),
				).toMatchObject({ _tag: "Failure" });
			}
		}),
	);
});
