import { assert, describe, expect, layer } from "@effect/vitest";
import { DbError } from "@ryot-app/contract/errors";
import { UserId } from "@ryot-app/contract/schema/brands";
import { CLIENT_API_VERSION } from "@ryot-app/plugin-client-contract";
import { eq, sql } from "drizzle-orm";
import { Effect, Exit, Result } from "effect";

import { databaseError } from "#platform/db/errors";
import { immutableRevisionStatements } from "#platform/db/immutable-revisions";
import { DatabaseSession } from "#platform/db/session";
import * as tables from "#schema/tables/combined";

import { insertPluginRevision } from "../test-support";
import {
	installRevisionPackage,
	oauthRevisionPackage,
	revisionDatabaseLayer,
	revisionPackage,
} from "./revision.test-support";

const owner = UserId.make("owner");

const generatedSections = [
	[tables.pluginRevision.name, "manifest -> 'metadata' ->> 'name'"],
	[tables.pluginRevision.icon, "manifest -> 'metadata' ->> 'icon'"],
	[tables.pluginRevision.description, "manifest -> 'metadata' ->> 'description'"],
	[tables.pluginRevision.version, "manifest -> 'metadata' ->> 'version'"],
	[tables.pluginRevision.client, "manifest -> 'client'"],
	[tables.pluginRevision.hooks, "manifest -> 'hooks'"],
	[tables.pluginRevision.crons, "manifest -> 'crons'"],
	[tables.pluginRevision.scripts, "manifest -> 'scripts'"],
	[tables.pluginRevision.workflows, "manifest -> 'workflows'"],
	[tables.pluginRevision.providers, "manifest -> 'providers'"],
	[tables.pluginRevision.oauthProviders, "manifest -> 'oauthProviders'"],
	[tables.pluginRevision.packageId, "manifest -> 'metadata' ->> 'packageId'"],
	[tables.pluginRevision.operations, "manifest -> 'operations'"],
	[tables.pluginRevision.configSchema, "manifest -> 'configSchema'"],
	[tables.pluginRevision.signalSchemas, "manifest -> 'signalSchemas'"],
	[tables.pluginRevision.entitySchemas, "manifest -> 'entitySchemas'"],
	[tables.pluginRevision.userBootstrap, "manifest -> 'userBootstrap'"],
	[tables.pluginRevision.userSettingsSchema, "manifest -> 'userSettingsSchema'"],
	[tables.pluginRevision.httpRateLimits, "manifest -> 'httpRateLimits'"],
	[tables.pluginRevision.relationshipSchemas, "manifest -> 'relationshipSchemas'"],
	[tables.pluginRevision.integrationProviders, "manifest -> 'integrationProviders'"],
] as const;

const readSections = Effect.fn(function* (revisionId: string) {
	const [row] = yield* (yield* DatabaseSession).run((db) =>
		db
			.select({
				stored: sql<ReadonlyArray<unknown>>`jsonb_build_array(${sql.join(
					generatedSections.map(([column]) => sql`${column}`),
					sql`, `,
				)})`,
				generated: sql<ReadonlyArray<unknown>>`jsonb_build_array(${sql.raw(
					generatedSections.map(([, expression]) => expression).join(", "),
				)})`,
			})
			.from(tables.pluginRevision)
			.innerJoin(
				tables.pluginRevisionManifest,
				eq(tables.pluginRevisionManifest.pluginRevisionId, tables.pluginRevision.id),
			)
			.where(eq(tables.pluginRevision.id, revisionId)),
	);
	assert(row);
	return row;
});

const readManifestIds = Effect.fn(function* (revisionId: string) {
	return yield* (yield* DatabaseSession).run((db) =>
		db
			.select({ id: tables.pluginRevisionManifest.pluginRevisionId })
			.from(tables.pluginRevisionManifest)
			.where(eq(tables.pluginRevisionManifest.pluginRevisionId, revisionId)),
	);
});

describe("immutable plugin revisions", () => {
	layer(revisionDatabaseLayer)((test) => {
		test.effect("stores every section exactly as the manifest expression derives it", () =>
			Effect.gen(function* () {
				const oauth = oauthRevisionPackage("complete", "complete-yank");
				const complete = {
					...oauth,
					manifest: {
						...oauth.manifest,
						userSettingsSchema: { fields: {} },
						client: { exports: {}, homeView: null, apiVersion: CLIENT_API_VERSION },
					},
				};
				const completeRevision = yield* installRevisionPackage(complete, owner);
				const completeSections = yield* readSections(completeRevision.revisionId);
				expect(completeSections.stored).toEqual(completeSections.generated);
				expect(completeSections.stored).not.toContain(null);

				const bare = yield* installRevisionPackage(revisionPackage("bare"), owner);
				const bareSections = yield* readSections(bare.revisionId);
				expect(bareSections.stored).toEqual(bareSections.generated);
				expect(bareSections.stored.filter((value) => value === null)).toHaveLength(3);
			}),
		);

		test.effect("rejects a manifest whose sections differ from its revision", () =>
			Effect.gen(function* () {
				const session = yield* DatabaseSession;
				const packageValue = revisionPackage("drift");
				const installed = yield* installRevisionPackage(packageValue, owner);
				const drifted = yield* Effect.result(
					session.run((db) =>
						db.transaction((tx) =>
							Effect.gen(function* () {
								yield* insertPluginRevision(tx, {
									id: "drift-revision",
									contentHash: "drift-source",
									pluginId: installed.pluginId,
									manifest: packageValue.manifest,
								});
								yield* tx
									.delete(tables.pluginRevisionManifest)
									.where(eq(tables.pluginRevisionManifest.pluginRevisionId, "drift-revision"));
								yield* tx
									.insert(tables.pluginRevisionManifest)
									.values({
										pluginRevisionId: "drift-revision",
										manifest: {
											...packageValue.manifest,
											client: { exports: {}, homeView: null, apiVersion: CLIENT_API_VERSION },
										},
									});
							}),
						),
					),
				);
				assert(Result.isFailure(drifted));
				assert(drifted.failure instanceof DbError);
				expect(drifted.failure.code).toBe("P0001");
				expect(drifted.failure.message).toContain("sections do not match");
			}),
		);

		test.effect("rejects a committed revision without a manifest", () =>
			Effect.gen(function* () {
				const session = yield* DatabaseSession;
				const packageValue = revisionPackage("orphan");
				const installed = yield* installRevisionPackage(packageValue, owner);
				const orphaned = yield* Effect.exit(
					session.run((db) =>
						db.transaction((tx) =>
							Effect.gen(function* () {
								yield* insertPluginRevision(tx, {
									id: "orphan-revision",
									contentHash: "orphan-source",
									pluginId: installed.pluginId,
									manifest: packageValue.manifest,
								});
								yield* tx
									.delete(tables.pluginRevisionManifest)
									.where(eq(tables.pluginRevisionManifest.pluginRevisionId, "orphan-revision"));
							}),
						),
					),
				);
				assert(Exit.isFailure(orphaned));
				const commitFailure = databaseError(orphaned.cause);
				expect(commitFailure.code).toBe("P0001");
				expect(commitFailure.message).toContain("has no manifest");
				const remaining = yield* session.run((db) =>
					db
						.select({ id: tables.pluginRevision.id })
						.from(tables.pluginRevision)
						.where(eq(tables.pluginRevision.id, "orphan-revision")),
				);
				expect(remaining).toEqual([]);
			}),
		);

		test.effect("rejects replacing the manifest of a committed revision", () =>
			Effect.gen(function* () {
				const session = yield* DatabaseSession;
				const packageValue = revisionPackage("replace");
				const installed = yield* installRevisionPackage(packageValue, owner);
				const replaced = yield* Effect.exit(
					session.run((db) =>
						db.transaction((tx) =>
							Effect.gen(function* () {
								yield* tx
									.delete(tables.pluginRevisionManifest)
									.where(eq(tables.pluginRevisionManifest.pluginRevisionId, installed.revisionId));
								yield* tx
									.insert(tables.pluginRevisionManifest)
									.values({
										manifest: packageValue.manifest,
										pluginRevisionId: installed.revisionId,
									});
							}),
						),
					),
				);
				assert(Exit.isFailure(replaced));
				const commitFailure = databaseError(replaced.cause);
				expect(commitFailure.code).toBe("P0001");
				expect(commitFailure.message).toContain("cannot be deleted while their revision exists");
			}),
		);

		test.effect("rejects deleting the manifest of a revision that remains", () =>
			Effect.gen(function* () {
				const session = yield* DatabaseSession;
				const installed = yield* installRevisionPackage(revisionPackage("retained"), owner);
				const deleted = yield* Effect.exit(
					session.run((db) =>
						db
							.delete(tables.pluginRevisionManifest)
							.where(eq(tables.pluginRevisionManifest.pluginRevisionId, installed.revisionId)),
					),
				);
				assert(Exit.isFailure(deleted));
				const commitFailure = databaseError(deleted.cause);
				expect(commitFailure.code).toBe("P0001");
				expect(commitFailure.message).toContain("cannot be deleted while their revision exists");
				const remaining = yield* readManifestIds(installed.revisionId);
				expect(remaining).toEqual([{ id: installed.revisionId }]);
			}),
		);

		test.effect("deletes manifests when their plugin is deleted", () =>
			Effect.gen(function* () {
				const session = yield* DatabaseSession;
				const installed = yield* installRevisionPackage(revisionPackage("cascade"), owner);
				yield* session.run((db) =>
					db.delete(tables.plugin).where(eq(tables.plugin.id, installed.pluginId)),
				);
				const remaining = yield* readManifestIds(installed.revisionId);
				expect(remaining).toEqual([]);
			}),
		);

		test.effect("rejects truncating revision manifests", () =>
			Effect.gen(function* () {
				const session = yield* DatabaseSession;
				const installed = yield* installRevisionPackage(revisionPackage("truncate"), owner);
				const truncated = yield* Effect.exit(
					session.run((db) => db.execute(sql`truncate plugin_revision_manifest`)),
				);
				assert(Exit.isFailure(truncated));
				expect(databaseError(truncated.cause).code).toBe("P0001");
				const remaining = yield* readManifestIds(installed.revisionId);
				expect(remaining).toEqual([{ id: installed.revisionId }]);
			}),
		);

		test.effect("reinstalls the statement list idempotently", () =>
			Effect.gen(function* () {
				const session = yield* DatabaseSession;
				const installed = yield* installRevisionPackage(revisionPackage("reinstall"), owner);
				for (const statement of [...immutableRevisionStatements, ...immutableRevisionStatements]) {
					yield* session.run((db) => db.execute(sql.raw(statement)));
				}
				const triggers = yield* session.run((db) =>
					db.execute<{ readonly name: string }>(
						sql`
						select t.tgname as name from pg_trigger t
						join pg_class c on c.oid = t.tgrelid
						where c.relnamespace = current_schema()::regnamespace and not t.tgisinternal
						order by t.tgname
					`,
						"objects",
					),
				);
				expect(triggers.map(({ name }) => name)).toEqual([
					"ryot_plugin_revision_immutable",
					"ryot_plugin_revision_manifest_immutable",
					"ryot_plugin_revision_manifest_truncate",
					"ryot_revision_manifest_present",
					"ryot_revision_manifest_retained",
					"ryot_revision_manifest_sections",
				]);
				const updated = yield* Effect.result(
					session.run((db) =>
						db
							.update(tables.pluginRevision)
							.set({ crons: [] })
							.where(eq(tables.pluginRevision.id, installed.revisionId)),
					),
				);
				assert(Result.isFailure(updated));
				assert(updated.failure instanceof DbError);
				expect(updated.failure.code).toBe("P0001");
			}),
		);
	});
});
