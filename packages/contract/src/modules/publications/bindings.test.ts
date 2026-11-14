import { describe, expect, it } from "bun:test";

import { Result } from "effect";

import type { AppSchema } from "../../schema/property-schema";
import { parameterExposureRisk } from "../ryotql/parameters";
import { bindPublicationArguments } from "./bindings";

const schema: AppSchema = {
	rules: [
		{
			path: ["year"],
			kind: "validation",
			validation: { required: true },
			when: { value: true, operator: "eq", path: ["yearly"] },
		},
	],
	fields: {
		year: { label: "Year", type: "integer", description: "Year" },
		yearly: { type: "boolean", label: "Yearly", description: "Group by year" },
		entity: {
			type: "string",
			label: "Entity",
			description: "Entity",
			reference: { kind: "entity-id" },
		},
		heading: {
			type: "string",
			label: "Heading",
			description: "Heading",
			validation: { required: true },
		},
	},
};

describe("publication bindings", () => {
	it("requires owner values only for parameters visitors cannot change", () => {
		const live = { mode: "live" as const, arguments: { yearly: true } };
		expect(
			Result.getFailure(bindPublicationArguments(schema, { ...live, visitorParameters: [] })),
		).toMatchObject({ value: [{ path: ["year"] }, { path: ["heading"] }] });
		expect(
			Result.getOrThrow(
				bindPublicationArguments(schema, { ...live, visitorParameters: ["heading", "year"] }),
			),
		).toEqual({ yearly: true });
	});

	it("rejects undeclared visitor parameters and any in snapshots", () => {
		expect(
			Result.getFailure(
				bindPublicationArguments(schema, {
					mode: "snapshot",
					arguments: { heading: "Recap" },
					visitorParameters: ["missing", "entity"],
				}),
			),
		).toMatchObject({
			value: [
				{ path: ["missing"], message: "Visitors can change only declared parameters" },
				{ path: ["entity"], message: "Visitors cannot change snapshot parameters" },
			],
		});
	});

	it("classifies identifier and free-text parameters", () => {
		expect(
			Object.fromEntries(
				Object.entries(schema.fields).map(([key, field]) => [key, parameterExposureRisk(field)]),
			),
		).toEqual({ year: "bounded", yearly: "bounded", heading: "free-text", entity: "identifier" });
	});
});
