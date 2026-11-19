import { index, snakeCase, text } from "drizzle-orm/pg-core";

import { timestamptz } from "./timestamps";

export const transientValue = snakeCase.table(
	"transient_value",
	{ value: text().notNull(), key: text().primaryKey(), expiresAt: timestamptz() },
	(table) => [index("transient_value_expires_at_idx").on(table.expiresAt)],
);
