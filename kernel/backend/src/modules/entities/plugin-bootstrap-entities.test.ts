import { expect } from "bun:test";

import { PluginId } from "@ryot-app/contract/schema/brands";
import { testTimeout } from "@ryot-app/testing/test-timeout";
import { layer } from "@voila.dev/effect-bun-test";
import { and, eq } from "drizzle-orm";
import { DateTime, Effect, Layer } from "effect";

import { PluginBootstrapEntities } from "#modules/plugins/installations/bootstrap-entities";
import {
	installRevisionPackage,
	revisionPackage,
} from "#modules/plugins/packages/revision.test-support";
import { relationshipChangeSetsLayer, userId } from "#modules/relationships/lifecycle.test-support";
import { DatabaseSession } from "#platform/db/session";
import * as tables from "#schema/tables/combined";

import { PluginBootstrapEntitiesLive } from "./plugin-bootstrap-entities";

layer(PluginBootstrapEntitiesLive.pipe(Layer.provideMerge(relationshipChangeSetsLayer())))(
	(test) => {
		test.effect(
			"ensures a bootstrap entry's entities once through change sets",
			() =>
				Effect.gen(function* () {
					const installed = yield* installRevisionPackage(
						revisionPackage("bootstrap", "v1", "record"),
						userId,
					);
					const bootstrap = yield* PluginBootstrapEntities;
					const input = {
						userId,
						entrySlug: "seed",
						accountUserId: userId,
						executionId: "bootstrap-execution",
						installationId: installed.installation.id,
						pluginId: PluginId.make(installed.pluginId),
						installedAt: DateTime.toDateUtc(DateTime.makeUnsafe("2026-10-13T00:00:00.000Z")),
						entities: [{ name: "Seed", entitySchemaSlug: "record", properties: { name: "Seed" } }],
					};
					yield* bootstrap.ensure(input);
					yield* bootstrap.ensure({ ...input, executionId: "bootstrap-retry" });
					const rows = yield* (yield* DatabaseSession).run((db) =>
						db
							.select({
								name: tables.entity.name,
								userId: tables.entity.userId,
								properties: tables.entity.properties,
							})
							.from(tables.entity)
							.where(
								and(
									eq(tables.entity.entitySchemaPluginId, installed.pluginId),
									eq(tables.entity.entitySchemaSlug, "record"),
								),
							),
					);
					expect(rows).toEqual([{ userId, name: "Seed", properties: { name: "Seed" } }]);
				}),
			testTimeout,
		);
	},
);
