import { expect, it } from "bun:test";

import type { NamedQuery, RyotQLDocument } from "@ryot-app/contract/modules/ryotql/authored";
import type { AppPropertyDefinition } from "@ryot-app/contract/schema/property-schema";
import { Result } from "effect";

import { importQueryDocuments } from "./imports";

const query: NamedQuery = {
	from: { table: "entity", alias: "entity" },
	output: { fields: [], orderBy: [], type: "rows", pagination: { limit: 1, maxLimit: 1 } },
};
const text = (label: string): AppPropertyDefinition => ({
	label,
	type: "string",
	description: label,
});
const failure = (result: Result.Result<RyotQLDocument, Error>) =>
	Result.isFailure(result) ? result.failure.message : null;

it("adds imported queries under their local name and shares identical parameters", () => {
	const page: RyotQLDocument = {
		queries: { own: query },
		parameters: { fields: { range: text("Range") } },
	};
	const imported: RyotQLDocument = {
		queries: { metrics: query, averages: query },
		parameters: { fields: { range: text("Range"), metricIds: text("Metrics") } },
	};
	expect(importQueryDocuments(page, {})).toEqual(Result.succeed(page));
	expect(importQueryDocuments(page, { series: imported })).toEqual(
		Result.succeed({
			queries: { own: query, "series.metrics": query, "series.averages": query },
			parameters: { fields: { range: text("Range"), metricIds: text("Metrics") } },
		}),
	);
});

it("refuses conflicting parameters, duplicate names and imported controls", () => {
	const page: RyotQLDocument = {
		queries: { "series.metrics": query },
		parameters: { fields: { range: text("Range") } },
	};
	expect(
		failure(
			importQueryDocuments(
				{ queries: {}, parameters: page.parameters },
				{
					series: {
						queries: { metrics: query },
						parameters: { fields: { range: text("Period") } },
					},
				},
			),
		),
	).toBe(
		"Parameter 'range' of imported query 'series' differs from another parameter named 'range'",
	);
	expect(failure(importQueryDocuments(page, { series: { queries: { metrics: query } } }))).toBe(
		"Query 'series.metrics' is declared twice",
	);
	expect(
		failure(
			importQueryDocuments(
				{ queries: {} },
				{
					series: {
						queries: { metrics: query },
						controls: { sort: { fields: [], kind: "outputs" } },
					},
				},
			),
		),
	).toBe("Imported query 'series' declares controls, which pages cannot import");
});
