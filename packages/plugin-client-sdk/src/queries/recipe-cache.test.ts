import { describe, expect, it } from "bun:test";

import {
	column,
	defineRecipe,
	selectedField,
	selectedRows,
	selectRecipe,
	table,
} from "@ryot-app/ryotql";
import { parameters } from "@ryot-app/ryotql/authoring";
import { Context, Schema } from "effect";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";

import { RyotScheduleService } from "../schedule";
import { createTestRyotClock } from "../testing";
import { createRyotQuery, isQueryDefinition } from "./definitions";

const entity = table("entity", "entity");
const input = parameters({
	fields: {
		name: {
			label: "Name",
			type: "string",
			description: "Selection name",
			validation: { required: true },
		},
	},
});
const rows = selectedRows(entity, {
	selection: { id: selectedField(column(entity, "id"), Schema.String) },
});
const recipe = defineRecipe({ parameters: input.schema, queries: { first: rows, second: rows } });

describe("recipe query cache selection", () => {
	it("reuses equal request values and separates arguments, pages and selected queries", () => {
		const clock = createTestRyotClock();
		const registry = AtomRegistry.make();
		try {
			const schedule = clock.runtime.runSync(RyotScheduleService);
			const query = createRyotQuery(selectRecipe(recipe, "first"));
			const other = createRyotQuery(selectRecipe(recipe, "second"));
			if (!isQueryDefinition(query) || !isQueryDefinition(other)) {
				throw new Error("Expected query definitions");
			}
			const atom = query.atom(registry, clock.client, schedule, Context.empty(), {
				arguments: { name: "one" },
				pages: { first: { limit: 10 } },
			});
			expect(
				query.atom(registry, clock.client, schedule, Context.empty(), {
					arguments: { name: "one" },
					pages: { first: { limit: 10 } },
				}),
			).toBe(atom);
			expect(
				query.atom(registry, clock.client, schedule, Context.empty(), {
					arguments: { name: "two" },
					pages: { first: { limit: 10 } },
				}),
			).not.toBe(atom);
			expect(
				query.atom(registry, clock.client, schedule, Context.empty(), {
					arguments: { name: "one" },
					pages: { first: { limit: 10, after: "cursor" } },
				}),
			).not.toBe(atom);
			const firstPage = query.atom(registry, clock.client, schedule, Context.empty(), {
				arguments: { name: "one" },
			});
			expect(
				query.atom(registry, clock.client, schedule, Context.empty(), {
					pages: undefined,
					arguments: { name: "one" },
				}),
			).toBe(firstPage);
			expect(
				other.atom(registry, clock.client, schedule, Context.empty(), {
					arguments: { name: "one" },
				}),
			).not.toBe(atom);
		} finally {
			registry.dispose();
			void clock.dispose();
		}
	});
});
