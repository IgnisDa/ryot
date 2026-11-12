import type { PluginManifest } from "@ryot-app/contract/modules/plugins/manifest";
import type { AppSchema } from "@ryot-app/contract/schema/property-schema";
import { sql } from "drizzle-orm";
import type { EffectPgDatabase } from "drizzle-orm/effect-postgres";

import { pluginSandboxAuthority } from "#modules/scripts/authorization/plugin-authority";
import { pluginRevisionSections } from "#platform/db/immutable-revisions";
import { pluginRevision } from "#schema/tables/core";

export const fixturePackageRoot = (kind: "valid" | "diagnostic" = "valid") =>
	new URL(`./test-fixtures/${kind}`, import.meta.url).pathname;

export const insertPluginRevision = (
	db: EffectPgDatabase,
	revision: {
		readonly id: string;
		readonly pluginId: string;
		readonly contentHash: string;
		readonly manifest: PluginManifest;
		readonly clientConfigSchema?: AppSchema;
	},
) =>
	db
		.insert(pluginRevision)
		.select((qb) =>
			qb
				.select({
					...pluginRevisionSections(sql`source.manifest`),
					id: sql`${revision.id}`.as("id"),
					pluginId: sql`${revision.pluginId}`.as("plugin_id"),
					contentHash: sql`${revision.contentHash}`.as("content_hash"),
					sandboxAuthority:
						sql`${JSON.stringify(pluginSandboxAuthority(revision.manifest))}::jsonb`.as(
							"sandbox_authority",
						),
					clientConfigSchema:
						sql`${JSON.stringify(revision.clientConfigSchema ?? { fields: {} })}::jsonb`.as(
							"client_config_schema",
						),
				})
				.from(sql`(select ${JSON.stringify(revision.manifest)}::jsonb as manifest) as source`),
		);
