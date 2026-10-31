import type { ManagedAssetLocator } from "@ryot-app/contract/modules/assets/schemas";
import { sql } from "drizzle-orm";
import { index, integer, primaryKey, snakeCase, text } from "drizzle-orm/pg-core";

import { user } from "./auth";
import { timestamptz } from "./timestamps";

export const managedAsset = snakeCase.table(
	"managed_asset",
	{
		key: text().notNull(),
		sha256: text().notNull(),
		retiredAt: timestamptz(),
		size: integer().notNull(),
		contentType: text().notNull(),
		createdAt: timestamptz().defaultNow().notNull(),
		provider: text().notNull().$type<ManagedAssetLocator["type"]>(),
		checkAfter: timestamptz()
			.notNull()
			.default(sql`now() + interval '24 hours'`),
		ownerUserId: text()
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
	},
	(table) => [
		primaryKey({ columns: [table.provider, table.key] }),
		index("managed_asset_owner_user_id_idx").on(table.ownerUserId),
		index("managed_asset_check_after_idx")
			.on(table.checkAfter)
			.where(sql`${table.retiredAt} is null`),
		index("managed_asset_retired_at_idx")
			.on(table.retiredAt)
			.where(sql`${table.retiredAt} is not null`),
	],
);
