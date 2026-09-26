import type {
	OAuthConnectionClient,
	OAuthConnectionStatus,
} from "@ryot-app/contract/modules/oauth-connections/schemas";
import { sql } from "drizzle-orm";
import {
	check,
	foreignKey,
	index,
	integer,
	jsonb,
	snakeCase,
	text,
	timestamp,
	unique,
} from "drizzle-orm/pg-core";

import type { SubkeyCiphertext } from "#lib/infrastructure/config/plugin-config-encryption";

import { user } from "./auth";
import { pluginInstallation } from "./core";
import { integration } from "./imports";

export const oauthConnection = snakeCase.table(
	"oauth_connection",
	{
		integrationId: text(),
		id: text().primaryKey(),
		field: text().notNull(),
		stateHash: text().notNull(),
		pluginSlug: text().notNull(),
		completionSecretHash: text(),
		tokenUrlOrigin: text().notNull(),
		oauthProviderSlug: text().notNull(),
		pluginInstallationId: text().notNull(),
		code: jsonb().$type<SubkeyCiphertext>(),
		integrationProviderSlug: text().notNull(),
		expiresAt: timestamp({ withTimezone: true }),
		tokenVersion: integer().notNull().default(0),
		accessToken: jsonb().$type<SubkeyCiphertext>(),
		codeVerifier: jsonb().$type<SubkeyCiphertext>(),
		refreshToken: jsonb().$type<SubkeyCiphertext>(),
		refreshLeaseUntil: timestamp({ withTimezone: true }),
		status: text().$type<OAuthConnectionStatus>().notNull(),
		accessTokenExpiresAt: timestamp({ withTimezone: true }),
		client: jsonb().$type<OAuthConnectionClient>().notNull(),
		createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
		userId: text()
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		updatedAt: timestamp({ withTimezone: true })
			.defaultNow()
			.$onUpdate(() => /* @__PURE__ */ new Date())
			.notNull(),
	},
	(table) => [
		unique("oauth_connection_state_hash_unique").on(table.stateHash),
		unique("oauth_connection_integration_field_unique").on(table.integrationId, table.field),
		index("oauth_connection_user_id_status_idx").on(table.userId, table.status),
		index("oauth_connection_expires_at_idx").on(table.expiresAt),
		check(
			"oauth_connection_status_check",
			sql`${table.status} in ('pending', 'authorized', 'connected', 'failed', 'expired')`,
		),
		check(
			"oauth_connection_integration_status_check",
			sql`${table.integrationId} is null or ${table.status} in ('connected', 'expired')`,
		),
		foreignKey({
			name: "oauth_connection_installation_owner_fk",
			columns: [table.pluginInstallationId, table.userId],
			foreignColumns: [pluginInstallation.id, pluginInstallation.userId],
		}).onDelete("cascade"),
		foreignKey({
			name: "oauth_connection_integration_owner_fk",
			columns: [
				table.integrationId,
				table.userId,
				table.pluginInstallationId,
				table.integrationProviderSlug,
			],
			foreignColumns: [
				integration.id,
				integration.userId,
				integration.pluginInstallationId,
				integration.provider,
			],
		}).onDelete("cascade"),
	],
);
