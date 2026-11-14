import { describe, expect } from "bun:test";

import { DbError } from "@ryot-app/contract/errors";
import { UserId } from "@ryot-app/contract/schema/brands";
import { CLIENT_API_VERSION } from "@ryot-app/plugin-client-contract";
import { assert } from "@ryot-app/testing/assert";
import { testTimeout } from "@ryot-app/testing/test-timeout";
import { layer } from "@voila.dev/effect-bun-test";
import { eq, sql } from "drizzle-orm";
import { Effect, Result } from "effect";

import { entityOccursAtStatements } from "#platform/db/entity-occurs-at";
import { immutableRevisionStatements } from "#platform/db/immutable-revisions";
import { DatabaseSession } from "#platform/db/session";
import * as tables from "#schema/tables/combined";

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
			.where(eq(tables.pluginRevision.id, revisionId)),
	);
	assert(row);
	return row;
});

describe("immutable plugin revisions", () => {
	layer(revisionDatabaseLayer)((test) => {
		test.effect(
			"stores every section exactly as the manifest expression derives it",
			() =>
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
			testTimeout,
		);

		test.effect(
			"rejects a manifest whose sections differ from its revision",
			() =>
				Effect.gen(function* () {
					const session = yield* DatabaseSession;
					const packageValue = revisionPackage("drift");
					const installed = yield* installRevisionPackage(packageValue, owner);
					const [revision] = yield* session.run((db) =>
						db
							.select()
							.from(tables.pluginRevision)
							.where(eq(tables.pluginRevision.id, installed.revisionId)),
					);
					assert(revision);
					const drifted = yield* Effect.result(
						session.run((db) =>
							db
								.insert(tables.pluginRevision)
								.values({
									...revision,
									id: "drift-revision",
									contentHash: "drift-source",
									client: { exports: {}, homeView: null, apiVersion: CLIENT_API_VERSION },
								}),
						),
					);
					assert(Result.isFailure(drifted));
					assert(drifted.failure instanceof DbError);
					expect(drifted.failure.code).toBe("23514");
				}),
			testTimeout,
		);

		test.effect(
			"reinstalls the statement list idempotently",
			() =>
				Effect.gen(function* () {
					const session = yield* DatabaseSession;
					const installed = yield* installRevisionPackage(revisionPackage("reinstall"), owner);
					for (const statement of [
						...immutableRevisionStatements,
						...entityOccursAtStatements,
						...immutableRevisionStatements,
						...entityOccursAtStatements,
					]) {
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
						"collection_order_changed",
						"ryot_entity_occurs_at",
						"ryot_entity_occurs_at_revision",
						"ryot_plugin_revision_immutable",
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
			testTimeout,
		);
	});
});
