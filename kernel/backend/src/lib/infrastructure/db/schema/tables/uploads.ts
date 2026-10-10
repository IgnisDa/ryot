import type { ManagedAssetLocator } from "@ryot-app/contract/modules/uploads/schemas";
import { index, integer, primaryKey, snakeCase, text, timestamp } from "drizzle-orm/pg-core";

import { user } from "./auth";

export const managedAsset = snakeCase.table(
	"managed_asset",
	{
		key: text().notNull(),
		sha256: text().notNull(),
		size: integer().notNull(),
		contentType: text().notNull(),
		provider: text().notNull().$type<ManagedAssetLocator["type"]>(),
		createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
		ownerUserId: text()
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
	},
	(table) => [
		primaryKey({ columns: [table.provider, table.key] }),
		index("managed_asset_owner_user_id_idx").on(table.ownerUserId),
	],
);
