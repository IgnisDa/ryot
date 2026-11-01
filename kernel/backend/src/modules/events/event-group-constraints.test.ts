import { pluginEventGroupIssue } from "@ryot-app/contract/modules/plugins/event-groups";
import type { AppSchema } from "@ryot-app/contract/schema/property-schema";
import { expect, it } from "vitest";

import { eventGroupDeclaration } from "./event-groups.test-support";

const propertiesSchema: AppSchema = {
	fields: {
		kind: { label: "Kind", type: "string", description: "Kind" },
		evidence: { type: "string", label: "Evidence", description: "Evidence" },
		position: { type: "integer", label: "Position", description: "Position" },
	},
};
const schemas = () => [
	{ slug: "anchor", propertiesSchema, eventGroup: eventGroupDeclaration },
	{ slug: "member", propertiesSchema },
];

it("requires a dependent schema in the same containing entity schema", () => {
	expect(pluginEventGroupIssue(schemas())).toBeUndefined();
	expect(pluginEventGroupIssue(schemas().filter(({ slug }) => slug !== "member"))).toBe(
		"Event group anchor dependent member must name one unclaimed non-anchor schema in the same entity schema",
	);
});

it("does not match ordinary strings with typed entity references", () => {
	const referenced: AppSchema = {
		fields: {
			...propertiesSchema.fields,
			kind: {
				label: "Kind",
				type: "string",
				description: "Kind",
				reference: { kind: "entity-id" },
			},
		},
	};
	expect(
		pluginEventGroupIssue(
			schemas().map((schema) =>
				schema.slug === "member"
					? Object.assign({}, schema, { propertiesSchema: referenced })
					: schema,
			),
		),
	).toBe("Event group anchor match kind must have compatible declared scalar types and references");
});

it("requires every key in the dependent match", () => {
	expect(
		pluginEventGroupIssue([
			{
				slug: "anchor",
				propertiesSchema,
				eventGroup: {
					...eventGroupDeclaration,
					dependents: [{ ...eventGroupDeclaration.dependents[0], matchProperties: ["kind"] }],
				},
			},
			{ slug: "member", propertiesSchema },
		]),
	).toBe("Event group anchor dependent matches must include every key property");
});

it("requires declared scalar keys and declared immutable properties", () => {
	const compound: AppSchema = {
		fields: {
			...propertiesSchema.fields,
			position: { type: "object", properties: {}, label: "Position", description: "Position" },
		},
	};
	expect(
		pluginEventGroupIssue(
			schemas().map((schema) => Object.assign({}, schema, { propertiesSchema: compound })),
		),
	).toBe("Event group anchor key position must be a declared scalar property");
	expect(
		pluginEventGroupIssue([
			{
				slug: "anchor",
				propertiesSchema,
				eventGroup: { ...eventGroupDeclaration, immutableProperties: ["missing"] },
			},
			{ slug: "member", propertiesSchema },
		]),
	).toBe("Event group anchor immutable property missing is not declared");
});

it("rejects multiple anchor declarations claiming the same dependent", () => {
	expect(
		pluginEventGroupIssue([
			...schemas(),
			{ propertiesSchema, slug: "other-anchor", eventGroup: eventGroupDeclaration },
		]),
	).toBe(
		"Event group other-anchor dependent member must name one unclaimed non-anchor schema in the same entity schema",
	);
});
