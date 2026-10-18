import { integer, snakeCase, text } from "drizzle-orm/pg-core";

import { user } from "./auth";
import { plugin } from "./core";

export const dataRevision = snakeCase.table("data_revision", {
	id: text().primaryKey(),
	revision: integer().notNull().default(0),
	userId: text().references(() => user.id, { onDelete: "cascade" }),
	pluginId: text().references(() => plugin.id, { onDelete: "cascade" }),
});
