import { snakeCase, text } from "drizzle-orm/pg-core";

import { timestamptz } from "./timestamps";

export const providerRateLimit = snakeCase.table("provider_rate_limit", {
	key: text().primaryKey(),
	nextAllowedAt: timestamptz().notNull(),
});
