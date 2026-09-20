import { expect, it } from "@effect/vitest";
import { is } from "drizzle-orm";
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";

import * as tables from "./tables/combined";

it("stores every timestamp at the millisecond precision of JavaScript dates", () => {
	const timestamps = Object.values(tables)
		.filter((value) => is(value, PgTable))
		.flatMap((table) => {
			const config = getTableConfig(table);
			return config.columns
				.filter((column) => column.getSQLType().startsWith("timestamp"))
				.map((column) => ({
					column: `${config.name}.${column.name}`,
					precision: "precision" in column ? column.precision : undefined,
				}));
		});
	expect(timestamps.length).toBeGreaterThan(0);
	expect(timestamps.filter(({ precision }) => precision !== 3)).toEqual([]);
});
