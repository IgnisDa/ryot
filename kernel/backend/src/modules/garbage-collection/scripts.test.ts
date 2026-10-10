import { assert, expect, layer } from "@effect/vitest";
import { SandboxScriptId } from "@ryot-app/contract/schema/brands";
import { eq, sql } from "drizzle-orm";
import { Context, Deferred, Effect, Fiber, Layer, Redacted } from "effect";

import { PLUGIN_INGESTION_ADVISORY_LOCK_KEY } from "#lib/infrastructure/db/advisory-locks";
import * as tables from "#lib/infrastructure/db/schema/tables/combined";
import { DatabaseSession } from "#lib/infrastructure/db/session";
import { makeAppConfigLayer, makeConfigProviderLayer } from "#lib/test-utils/effect";
import { IsolatedDatabase, isolatedDatabaseLayer } from "#lib/test-utils/isolated-database";
import { ClientArtifactsRepository } from "#modules/client-artifacts/repository";
import { DefinitionRepository } from "#modules/definition-registry/repository";
import { PluginConfigEncryptionKey } from "#modules/plugins/config-encryption-key";
import { PluginConfigRevisions } from "#modules/plugins/config-revisions";
import { PluginInstallationRepository } from "#modules/plugins/installation-repository";
import { PluginRepository } from "#modules/plugins/repository";
import { installRevisionPackage, revisionPackage } from "#modules/plugins/revision.test-support";
import { SandboxWorkflowReferenceRepository } from "#modules/sandbox/workflow-reference-repository";

import { ScriptGarbageCollector } from "./scripts";

const scheduledCollection = { limit: 500, scheduled: true, now: new Date(0) };

const collectorRepositories = Layer.mergeAll(
	ClientArtifactsRepository.layer,
	DefinitionRepository.layer,
	PluginConfigEncryptionKey.layer,
	PluginConfigRevisions.layer,
	PluginInstallationRepository.layer,
	SandboxWorkflowReferenceRepository.layer,
);
const collectorDatabaseLayer = Layer.effectDiscard(
	Effect.gen(function* () {
		const session = yield* DatabaseSession;
		yield* session.run((db) =>
			db
				.insert(tables.user)
				.values({
					id: "owner",
					name: "Owner",
					email: "owner@example.test",
					accountGeneration: "test-account-generation",
				}),
		);
	}),
).pipe(
	Layer.provideMerge(
		Layer.mergeAll(
			collectorRepositories,
			PluginRepository.layer.pipe(Layer.provide(collectorRepositories)),
		).pipe(Layer.provideMerge(isolatedDatabaseLayer("script_gc"))),
	),
	Layer.provide(makeConfigProviderLayer()),
);
const realCollectorLayer = ScriptGarbageCollector.layer.pipe(
	Layer.provideMerge(collectorDatabaseLayer),
	Layer.provide(makeAppConfigLayer()),
);

const installCollectorPackage = Effect.fn("test.installCollectorPackage")(function* (slug: string) {
	const session = yield* DatabaseSession;
	const installed = yield* installRevisionPackage(revisionPackage(slug));
	const [script] = yield* session.run((db) =>
		db
			.select()
			.from(tables.sandboxScript)
			.where(eq(tables.sandboxScript.pluginRevisionId, installed.revisionId))
			.limit(1),
	);
	assert(script !== undefined);
	return { script, installed };
});

layer(realCollectorLayer, { excludeTestServices: true })((test) => {
	test.effect("collects inactive unreferenced rows in an idle scheduled collection", () =>
		Effect.gen(function* () {
			const session = yield* DatabaseSession;
			const repository = yield* PluginRepository;
			const { script, installed } = yield* installCollectorPackage("gc-idle");
			yield* repository.deactivate(installed.pluginId);
			const collector = yield* ScriptGarbageCollector;
			const result = yield* collector.collect(scheduledCollection);
			expect(result.removedCount).toBeGreaterThan(0);
			expect(
				yield* session.run((db) =>
					db.select().from(tables.sandboxScript).where(eq(tables.sandboxScript.id, script.id)),
				),
			).toEqual([]);
			expect(yield* collector.collect(scheduledCollection)).toEqual({ removedCount: 0 });
		}),
	);

	test.effect("defers for suspension pins while explicit collection preserves their scripts", () =>
		Effect.gen(function* () {
			const session = yield* DatabaseSession;
			const references = yield* SandboxWorkflowReferenceRepository;
			const repository = yield* PluginRepository;
			const collector = yield* ScriptGarbageCollector;
			const { script, installed } = yield* installCollectorPackage("gc-suspension");
			yield* session.transaction(
				Effect.gen(function* () {
					yield* references.lockIngestionShared();
					yield* references.registerInTransaction({
						pluginId: installed.pluginId,
						contentHash: script.contentHash,
						executionId: "suspended-gc-workflow",
						scriptId: SandboxScriptId.make(script.id),
					});
				}),
			);
			yield* repository.deactivate(installed.pluginId);
			expect(yield* collector.collect(scheduledCollection)).toEqual({ removedCount: 0 });
			yield* collector.collect();
			expect(
				yield* session.run((db) =>
					db
						.select({ id: tables.sandboxScript.id })
						.from(tables.sandboxScript)
						.where(eq(tables.sandboxScript.id, script.id)),
				),
			).toEqual([{ id: script.id }]);
			yield* references.release("suspended-gc-workflow");
			yield* collector.collect(scheduledCollection);
			expect(
				yield* session.run((db) =>
					db.select().from(tables.sandboxScript).where(eq(tables.sandboxScript.id, script.id)),
				),
			).toEqual([]);
		}),
	);

	test.effect(
		"defers without waiting behind a busy ingestion fence and retries after release",
		() =>
			Effect.gen(function* () {
				const session = yield* DatabaseSession;
				const repository = yield* PluginRepository;
				const { script, installed } = yield* installCollectorPackage("gc-fence");
				yield* repository.deactivate(installed.pluginId);
				const collector = yield* ScriptGarbageCollector;
				const { url } = yield* IsolatedDatabase;
				const admin = Context.get(
					yield* Layer.build(
						DatabaseSession.layer.pipe(
							Layer.provide(makeAppConfigLayer({ database: { url: Redacted.make(url) } })),
							Layer.fresh,
						),
					),
					DatabaseSession,
				);
				const held = yield* Deferred.make<void>();
				const release = yield* Deferred.make<void>();
				const holder = yield* Effect.forkChild(
					admin.transaction(
						Effect.gen(function* () {
							yield* admin.run((db) =>
								db.execute(
									sql`select pg_advisory_xact_lock_shared(hashtext(${PLUGIN_INGESTION_ADVISORY_LOCK_KEY}))`,
								),
							);
							yield* Deferred.succeed(held, undefined);
							yield* Deferred.await(release);
						}),
					),
				);
				yield* Deferred.await(held);
				const result = yield* collector
					.collect(scheduledCollection)
					.pipe(Effect.timeout("2 seconds"), Effect.ensuring(Deferred.succeed(release, undefined)));
				expect(result).toEqual({ removedCount: 0 });
				expect(
					yield* session.run((db) =>
						db
							.select({ id: tables.sandboxScript.id })
							.from(tables.sandboxScript)
							.where(eq(tables.sandboxScript.id, script.id)),
					),
				).toEqual([{ id: script.id }]);
				yield* Fiber.join(holder);
				expect((yield* collector.collect(scheduledCollection)).removedCount).toBeGreaterThan(0);
				expect(
					yield* session.run((db) =>
						db.select().from(tables.sandboxScript).where(eq(tables.sandboxScript.id, script.id)),
					),
				).toEqual([]);
			}).pipe(Effect.scoped),
	);
});
