import { assert, expect, it, layer } from "@effect/vitest";
import { UserId } from "@ryot-app/contract/schema/brands";
import type { AppSchema } from "@ryot-app/contract/schema/property-schema";
import { assertExitFails } from "@ryot-app/testing/effect-assertions";
import { eq } from "drizzle-orm";
import { Effect } from "effect";

import { ManagedAssetReferenceRejected } from "#lib/domain/managed-asset-writes";
import {
	insertManagedAsset,
	managedAssetProperty,
} from "#modules/assets/storage/managed-assets.test-support";
import { DatabaseSession } from "#platform/db/session";
import * as tables from "#schema/tables/core";

import { PluginRepository } from "../packages/repository";
import {
	installRevisionPackage,
	revisionDatabaseLayer,
	revisionPackage,
} from "../packages/revision.test-support";
import { PluginConfigRevisions, validateRestoredProperties } from "./revisions";

const schema = {
	unknownKeys: "strict",
	fields: {
		region: {
			type: "string",
			label: "Region",
			description: "Region",
			validation: { required: true },
		},
		token: {
			secret: true,
			type: "string",
			label: "Token",
			description: "Token",
			validation: { required: true },
		},
	},
} satisfies AppSchema;

it.effect("allows only missing required secrets for needs-configuration restores", () =>
	Effect.gen(function* () {
		expect(yield* validateRestoredProperties({ region: "local" }, schema, [], true)).toEqual({
			needsConfiguration: true,
			properties: { region: "local" },
		});
		yield* validateRestoredProperties({}, schema, [], true).pipe(
			Effect.flip,
			Effect.tap((error) =>
				Effect.sync(() =>
					expect(error.message).toBe(
						"Plugin configuration does not match the selected package revision",
					),
				),
			),
		);
		yield* validateRestoredProperties({ region: "local" }, schema, [], false).pipe(
			Effect.flip,
			Effect.tap((error) =>
				Effect.sync(() =>
					expect(error.message).toBe(
						"Plugin configuration does not match the selected package revision",
					),
				),
			),
		);
	}),
);

it.effect("detects invalid redacted secret-array cardinality across backup generations", () => {
	const arraySchema = {
		unknownKeys: "strict",
		fields: {
			tokens: {
				type: "array",
				label: "Tokens",
				description: "Tokens",
				validation: { minItems: 1 },
				items: { secret: true, type: "string", label: "Token", description: "Token" },
			},
		},
	} satisfies AppSchema;
	return Effect.gen(function* () {
		expect(
			yield* validateRestoredProperties({ tokens: [] }, arraySchema, ["/tokens/0"], false),
		).toEqual({ needsConfiguration: true, properties: { tokens: [] } });
		expect(yield* validateRestoredProperties({ tokens: [] }, arraySchema, [], true)).toEqual({
			needsConfiguration: true,
			properties: { tokens: [] },
		});
	});
});

const assetConfigSchema: AppSchema = {
	unknownKeys: "strict",
	fields: { image: managedAssetProperty },
};

const assetConfigPackage = () => {
	const value = revisionPackage("asset-config");
	return { ...value, manifest: { ...value.manifest, configSchema: assetConfigSchema } };
};

layer(revisionDatabaseLayer)((test) => {
	test.effect("rejects an installation config revision with another user's managed asset", () =>
		Effect.gen(function* () {
			const session = yield* DatabaseSession;
			const configs = yield* PluginConfigRevisions;
			const installed = yield* installRevisionPackage(assetConfigPackage(), UserId.make("owner"));
			const foreign = yield* insertManagedAsset(UserId.make("config-asset-foreign"));
			assertExitFails(
				yield* Effect.exit(
					session.transaction(
						configs.create({
							ownerUserId: "owner",
							scope: "installation",
							properties: { image: foreign },
							pluginRevisionId: installed.revisionId,
							pluginInstallationId: installed.installation.id,
						}),
					),
				),
				new ManagedAssetReferenceRejected(),
			);
		}),
	);

	test.effect("rejects an environment config revision with a user's own managed asset", () =>
		Effect.gen(function* () {
			const session = yield* DatabaseSession;
			const configs = yield* PluginConfigRevisions;
			const plugins = yield* PluginRepository;
			const pluginId = yield* session.transaction(
				Effect.gen(function* () {
					yield* plugins.lockIngestion();
					return yield* plugins.persist(assetConfigPackage(), { ownerId: null, scope: "system" });
				}),
			);
			const [plugin] = yield* session.run((db) =>
				db.select().from(tables.plugin).where(eq(tables.plugin.id, pluginId)),
			);
			assert(plugin?.activeRevisionId);
			const own = yield* insertManagedAsset(UserId.make("owner"));
			assertExitFails(
				yield* Effect.exit(
					session.transaction(
						configs.create({
							ownerUserId: null,
							scope: "environment",
							pluginInstallationId: null,
							properties: { image: own },
							pluginRevisionId: plugin.activeRevisionId,
						}),
					),
				),
				new ManagedAssetReferenceRejected(),
			);
		}),
	);
});
