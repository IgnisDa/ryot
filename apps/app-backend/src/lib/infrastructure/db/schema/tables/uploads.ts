import type { ManagedAssetLocator } from "@ryot/contract/modules/uploads/schemas";
import { index, integer, primaryKey, snakeCase, text, timestamp } from "drizzle-orm/pg-core";

import { user } from "./auth";

export const managedAsset = snakeCase.table(
	"managed_asset",
	{
		provider: text().notNull().$type<ManagedAssetLocator["type"]>(),
		key: text().notNull(),
		ownerUserId: text()
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		size: integer().notNull(),
		contentType: text().notNull(),
		sha256: text().notNull(),
		createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [
		primaryKey({ columns: [table.provider, table.key] }),
		index("managed_asset_owner_user_id_idx").on(table.ownerUserId),
	],
);
