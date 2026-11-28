import { customType, snakeCase, text, unique } from "drizzle-orm/pg-core";

const transactionId = customType<{ data: string; driverData: string }>({ dataType: () => "xid8" });

export const dataChange = snakeCase.table(
	"data_change",
	{ userId: text(), schemaSlug: text(), transactionId: transactionId().notNull() },
	(table) => [
		unique("data_change_user_schema_transaction_unique")
			.on(table.userId, table.schemaSlug, table.transactionId)
			.nullsNotDistinct(),
	],
);
