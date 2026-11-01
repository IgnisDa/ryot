import { getTableColumns } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";

export const bindParameterLimit = 32_767;

export const insertChunkSize = (table: PgTable) =>
	Math.floor(bindParameterLimit / Object.keys(getTableColumns(table)).length);
