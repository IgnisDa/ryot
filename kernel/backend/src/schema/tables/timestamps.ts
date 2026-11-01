import { timestamp } from "drizzle-orm/pg-core";

export const timestamptz = () => timestamp({ precision: 3, withTimezone: true });

export const updatedAtColumn = () =>
	timestamptz()
		.defaultNow()
		.$onUpdate(() => /* @__PURE__ */ new Date())
		.notNull();
