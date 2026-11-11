import { describe, expect, it } from "bun:test";

import { DateTime, Result } from "effect";

import { compileFilter, outputFilterTargets } from "./filters";
import {
	ascending,
	column,
	conditional,
	descending,
	eq,
	field,
	literal,
	rows,
	table,
} from "./index";
import { compileSort } from "./sort";

const entity = table("entity", "entity");
const source = rows(entity, { fields: [field("score", column(entity, "score"))] });

describe("shared request controls", () => {
	it("resolves output targets and rejects missing targets and invalid operators", () => {
		const targets = Result.getOrThrow(
			outputFilterTargets(source, [
				{ key: "score", kind: "value", field: "score", label: "Score", type: "number" },
			]),
		);
		expect(
			Result.getOrThrow(
				compileFilter({
					source,
					targets,
					subject: undefined,
					now: DateTime.makeUnsafe("2026-01-01T00:00:00Z"),
					filter: { value: 4, field: "score", operator: "gte" },
				}),
			),
		).toMatchObject({
			operator: "gte",
			type: "comparison",
			right: { value: 4 },
			left: { type: "cast", target: "number" },
		});
		expect(
			Result.isFailure(
				outputFilterTargets(source, [
					{ type: "text", kind: "value", key: "missing", field: "missing", label: "Missing" },
				]),
			),
		).toBe(true);
		for (const filter of [
			{ value: 1, operator: "gte", field: "missing" },
			{ value: "text", field: "score", operator: "contains" },
		] as const) {
			expect(
				Result.isFailure(
					compileFilter({
						source,
						filter,
						targets,
						subject: undefined,
						now: DateTime.makeUnsafe("2026-01-01T00:00:00Z"),
					}),
				),
			).toBe(true);
		}
	});
	it("compiles conditional sort targets with a stable ID tie-breaker and rejects unknown choices", () => {
		const score = column(entity, "score");
		const id = column(entity, "id");
		const when = eq(column(entity, "kind"), literal("selected"));
		const targets = [
			{
				key: "score",
				label: "Score",
				ascending: "Low first",
				descending: "High first",
				defaultDirection: "desc",
				branches: [{ when, value: score }],
			},
		] as const;
		expect(Result.getOrThrow(compileSort(targets, "score-desc", id))).toEqual([
			descending(conditional(when, score, literal(null))),
			ascending(id),
		]);
		expect(Result.isFailure(compileSort(targets, "unknown-asc", id))).toBe(true);
	});
});
