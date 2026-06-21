import type { PluginIntegrationProvider } from "@ryot/contract/modules/plugins/manifest";
import * as schema from "@ryot/kernel-backend/lib/infrastructure/db/schema/tables/combined";
import { Database, mapDatabaseErrors } from "@ryot/kernel-backend/lib/infrastructure/db/service";
import type { DefinitionSnapshot } from "@ryot/kernel-backend/modules/definition-registry/service";
import {
	PluginLoader,
	type PluginRegistryEntry,
} from "@ryot/kernel-backend/modules/plugins/loader";
import { and, eq, inArray } from "drizzle-orm";
import { Effect } from "effect";

import { quoteSqlString, withReservedConnection } from "./shared";

export type QualifiedSchema = { pluginId: string | null; slug: string };

type ResolvedIntegrationProvider = PluginIntegrationProvider;

export type LegacyPackageResolution = {
	entitySchemas: Map<string, QualifiedSchema>;
	eventSchemas: Map<string, QualifiedSchema>;
	fitnessPluginId: string;
	installations: Map<string, string>;
	integrationProviders: Map<string, ResolvedIntegrationProvider>;
	mediaPluginId: string;
	providers: Map<string, string>;
	relationshipSchemas: Map<string, QualifiedSchema>;
	savedViews: Map<string, QualifiedSchema>;
	scripts: Map<string, { id: string; slug: string }>;
};

const qualifiedKey = (pluginId: string | null, slug: string) => JSON.stringify([pluginId, slug]);
const eventKey = (pluginId: string | null, entitySchemaSlug: string, slug: string) =>
	JSON.stringify([pluginId, entitySchemaSlug, slug]);
const installationKey = (userId: string, pluginId: string) => `${userId}\0${pluginId}`;

const requireSystemPlugin = (
	plugins: Readonly<Record<string, PluginRegistryEntry>>,
	slug: "fitness" | "media",
) => {
	const matches = Object.values(plugins).filter(
		(plugin) => plugin.slug === slug && plugin.scope === "system",
	);
	if (matches.length !== 1) {
		throw new Error(
			`Expected exactly one active trusted system plugin "${slug}", found ${matches.length}`,
		);
	}
	const match = matches[0];
	if (match === undefined) {
		throw new Error(`Expected exactly one active trusted system plugin "${slug}", found 0`);
	}
	return match;
};

const addUnique = <Value>(map: Map<string, Value>, key: string, value: Value, kind: string) => {
	if (map.has(key)) {
		throw new Error(`Ambiguous active ${kind} mapping for ${key}`);
	}
	map.set(key, value);
};

const buildSchemaMaps = (definitions: DefinitionSnapshot) => {
	const entitySchemas = new Map<string, QualifiedSchema>();
	const eventSchemas = new Map<string, QualifiedSchema>();
	const relationshipSchemas = new Map<string, QualifiedSchema>();
	const savedViews = new Map<string, QualifiedSchema>();

	for (const definition of Object.values(definitions.entitySchemas)) {
		const qualified = { pluginId: definition.pluginId ?? null, slug: definition.slug };
		addUnique(
			entitySchemas,
			qualifiedKey(qualified.pluginId, qualified.slug),
			qualified,
			"entity schema",
		);
		for (const event of Object.values(definition.eventSchemas)) {
			const eventPluginId = event.pluginId ?? null;
			addUnique(
				eventSchemas,
				eventKey(eventPluginId, definition.slug, event.slug),
				{ pluginId: eventPluginId, slug: event.slug },
				"event schema",
			);
		}
	}
	for (const definition of Object.values(definitions.relationshipSchemas)) {
		const qualified = { pluginId: definition.pluginId ?? null, slug: definition.slug };
		addUnique(
			relationshipSchemas,
			qualifiedKey(qualified.pluginId, qualified.slug),
			qualified,
			"relationship schema",
		);
	}
	for (const definition of Object.values(definitions.savedViews)) {
		const qualified = { pluginId: definition.pluginId ?? null, slug: definition.slug };
		addUnique(
			savedViews,
			qualifiedKey(qualified.pluginId, qualified.slug),
			qualified,
			"saved view",
		);
	}

	return { entitySchemas, eventSchemas, relationshipSchemas, savedViews };
};

export const buildLegacyPackageResolution = Effect.fn("buildLegacyPackageResolution")(function* (
	userIds: ReadonlyArray<string>,
) {
	const database = yield* Database;
	const loader = yield* PluginLoader;
	const snapshot = loader.getSnapshot();
	const media = requireSystemPlugin(snapshot.plugins, "media");
	const fitness = requireSystemPlugin(snapshot.plugins, "fitness");
	const pluginIds = [media.id, fitness.id];

	const persistedPlugins = yield* mapDatabaseErrors(
		database
			.select({ id: schema.plugin.id, slug: schema.plugin.slug })
			.from(schema.plugin)
			.where(
				and(
					inArray(schema.plugin.id, pluginIds),
					eq(schema.plugin.scope, "system"),
					eq(schema.plugin.status, "active"),
				),
			),
	);
	for (const expected of [media, fitness]) {
		const matches = persistedPlugins.filter(
			(plugin) => plugin.id === expected.id && plugin.slug === expected.slug,
		);
		if (matches.length !== 1) {
			throw new Error(
				`Active loader plugin does not match one active persisted system plugin: ${expected.slug}`,
			);
		}
	}

	if (userIds.length > 0) {
		const pluginValues = [media, fitness]
			.map((plugin) => `(${quoteSqlString(plugin.id)})`)
			.join(", ");
		yield* withReservedConnection((connection) =>
			connection.executeRaw(
				`INSERT INTO "plugin_installation" ("id", "user_id", "plugin_id", "health")
				SELECT md5('legacy-plugin-installation:' || legacy_user.id || ':' || packages.plugin_id),
				legacy_user.id, packages.plugin_id, 'ready'
				FROM "old_user" legacy_user
				CROSS JOIN (VALUES ${pluginValues}) packages(plugin_id)
				ON CONFLICT ("user_id", "plugin_id") DO NOTHING;`,
				[],
			),
		);
	}

	const persistedProviders = yield* mapDatabaseErrors(
		database
			.select({
				id: schema.sandboxProvider.id,
				pluginId: schema.sandboxProvider.pluginId,
				slug: schema.sandboxProvider.slug,
			})
			.from(schema.sandboxProvider)
			.where(inArray(schema.sandboxProvider.pluginId, pluginIds)),
	);
	const persistedScripts = yield* mapDatabaseErrors(
		database
			.select({
				id: schema.sandboxScript.id,
				slug: schema.sandboxScript.slug,
				pluginId: schema.sandboxScript.pluginId,
				contentHash: schema.sandboxScript.contentHash,
			})
			.from(schema.sandboxScript)
			.where(inArray(schema.sandboxScript.pluginId, pluginIds)),
	);
	const providers = new Map<string, string>();
	for (const plugin of [media, fitness]) {
		const declared = new Set(plugin.manifest.providers.map(({ slug }) => slug));
		for (const provider of persistedProviders.filter(({ pluginId }) => pluginId === plugin.id)) {
			if (declared.has(provider.slug)) {
				addUnique(providers, qualifiedKey(plugin.id, provider.slug), provider.id, "provider");
			}
		}
	}

	const installations = new Map<string, string>();
	if (userIds.length > 0) {
		const rows = yield* mapDatabaseErrors(
			database
				.select({
					id: schema.pluginInstallation.id,
					userId: schema.pluginInstallation.userId,
					health: schema.pluginInstallation.health,
					isDisabled: schema.pluginInstallation.isDisabled,
					pluginId: schema.pluginInstallation.pluginId,
				})
				.from(schema.pluginInstallation)
				.where(
					and(
						inArray(schema.pluginInstallation.userId, [...userIds]),
						inArray(schema.pluginInstallation.pluginId, pluginIds),
					),
				),
		);
		for (const row of rows) {
			const expectedId = new Bun.CryptoHasher("md5")
				.update(`legacy-plugin-installation:${row.userId}:${row.pluginId}`)
				.digest("hex");
			if (row.health !== "ready" || row.isDisabled || row.id !== expectedId) {
				throw new Error(
					`Legacy system plugin installation is not the expected deterministic ready installation: ${row.userId}/${row.pluginId}`,
				);
			}
			addUnique(installations, installationKey(row.userId, row.pluginId), row.id, "installation");
		}
		for (const userId of userIds) {
			for (const pluginId of pluginIds) {
				if (!installations.has(installationKey(userId, pluginId))) {
					throw new Error(`Missing ready legacy system plugin installation: ${userId}/${pluginId}`);
				}
			}
		}
	}

	const integrationProviders = new Map<string, ResolvedIntegrationProvider>();
	const scripts = new Map<string, { id: string; slug: string }>();
	for (const plugin of [media, fitness]) {
		for (const provider of plugin.manifest.integrationProviders) {
			addUnique(
				integrationProviders,
				qualifiedKey(plugin.id, provider.slug),
				provider,
				"integration provider",
			);
		}
		for (const script of plugin.scripts) {
			const matches = persistedScripts.filter(
				(row) =>
					row.pluginId === plugin.id &&
					row.slug === script.slug &&
					row.contentHash === script.contentHash,
			);
			if (matches.length !== 1) {
				throw new Error(
					`Expected one current persisted script for "${plugin.id}/${script.slug}", found ${matches.length}`,
				);
			}
			const match = matches[0];
			if (!match) {
				throw new Error(`Missing current persisted script for "${plugin.id}/${script.slug}"`);
			}
			addUnique(
				scripts,
				qualifiedKey(plugin.id, script.slug),
				{ id: match.id, slug: script.slug },
				"script",
			);
		}
	}

	return {
		...buildSchemaMaps(snapshot.definitions),
		fitnessPluginId: fitness.id,
		integrationProviders,
		installations,
		mediaPluginId: media.id,
		providers,
		scripts,
	} satisfies LegacyPackageResolution;
});

export const resolveEntityMigrationTargets = <
	T extends { source: string; entitySchemaSlug: string; providerSlug: string | null },
>(
	targets: readonly T[],
	resolution: LegacyPackageResolution,
	pluginId: string,
) =>
	targets.map((target) => {
		const entitySchema = requireSchema(
			resolution.entitySchemas,
			pluginId,
			target.entitySchemaSlug,
			"entity schema",
		);
		const providerId =
			target.providerSlug === null
				? null
				: requireMapped(resolution.providers, pluginId, target.providerSlug, "provider");
		return {
			...target,
			entitySchemaPluginId: entitySchema.pluginId,
			entitySchemaSlug: entitySchema.slug,
			providerId,
		};
	});

export const resolveRelationshipMigrationTargets = (input: {
	lotToEntitySchemaSlug: Map<string, string>;
	pluginId: string;
	resolution: LegacyPackageResolution;
	sourceEntitySchemaSlug: "person" | "company";
}) => {
	const targets = [];
	for (const [lot, targetEntitySchemaSlug] of input.lotToEntitySchemaSlug.entries()) {
		const slug = `${input.sourceEntitySchemaSlug}-to-${targetEntitySchemaSlug}`;
		const relationshipSchema = requireSchema(
			input.resolution.relationshipSchemas,
			input.pluginId,
			slug,
			"relationship schema",
		);
		targets.push({
			lot,
			relationshipSchemaPluginId: relationshipSchema.pluginId,
			relationshipSchemaSlug: relationshipSchema.slug,
		});
	}
	return targets;
};

export const requireMapped = <T>(
	map: Map<string, T>,
	pluginId: string,
	slug: string,
	kind: string,
) => {
	const value = map.get(qualifiedKey(pluginId, slug));
	if (value === undefined) {
		throw new Error(`Missing active ${kind} mapping for "${pluginId}/${slug}"`);
	}
	return value;
};

export const requireSchema = (
	map: Map<string, QualifiedSchema>,
	pluginId: string | null,
	slug: string,
	kind: string,
) => {
	const value = map.get(qualifiedKey(pluginId, slug));
	if (value === undefined) {
		throw new Error(`Missing active ${kind} mapping for "${pluginId ?? "kernel"}/${slug}"`);
	}
	return value;
};

export const requireEventSchema = (
	resolution: LegacyPackageResolution,
	pluginId: string | null,
	entitySchemaSlug: string,
	slug: string,
) => {
	const value = resolution.eventSchemas.get(eventKey(pluginId, entitySchemaSlug, slug));
	if (!value) {
		throw new Error(
			`Missing active event schema mapping for "${pluginId ?? "kernel"}/${entitySchemaSlug}/${slug}"`,
		);
	}
	return value;
};

export const requireInstallation = (
	resolution: LegacyPackageResolution,
	userId: string,
	pluginId: string,
) => {
	const value = resolution.installations.get(installationKey(userId, pluginId));
	if (!value) {
		throw new Error(`Missing ready installation mapping for "${userId}/${pluginId}"`);
	}
	return value;
};

export const buildUniqueLotEntitySchemaSlugMap = (
	targets: readonly { lot: string; entitySchemaSlug: string }[],
) => {
	const values = new Map<string, string>();
	for (const target of targets) {
		const existing = values.get(target.lot);
		if (existing !== undefined && existing !== target.entitySchemaSlug) {
			throw new Error(
				`Conflicting entity schema slugs for legacy lot "${target.lot}" (${existing} vs ${target.entitySchemaSlug})`,
			);
		}
		values.set(target.lot, target.entitySchemaSlug);
	}
	return values;
};
