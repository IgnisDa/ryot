import { expect, it } from "@effect/vitest";
import { assertExitFails } from "@ryot-app/testing/effect-assertions";
import { Effect } from "effect";

import { DataReferenceError, rewritePropertyReferences } from "./data-references";

const schema = {
	fields: {
		links: {
			label: "Links",
			type: "array" as const,
			description: "Recorded event references",
			items: {
				label: "Event",
				type: "string" as const,
				description: "Source record",
				reference: { kind: "event-id" as const },
			},
		},
	},
};

it.effect("rewrites streamed event references without an event-sized identity map", () =>
	Effect.gen(function* () {
		const visited: string[] = [];
		const rewritten = yield* rewritePropertyReferences(
			{ label: "source-a", links: ["source-a", "deleted-source"] },
			schema,
			new Map(),
			new Map(),
			(id) => {
				visited.push(id);
				return `restored:${id}`;
			},
		);
		expect(rewritten).toEqual({
			label: "source-a",
			links: ["restored:source-a", "restored:deleted-source"],
		});
		expect(visited).toEqual(["source-a", "deleted-source"]);
	}),
);

it.effect("refuses event-reference rewrites without an identity resolver", () =>
	Effect.gen(function* () {
		assertExitFails(
			yield* Effect.exit(
				rewritePropertyReferences({ links: ["source-a"] }, schema, new Map(), new Map()),
			),
			new DataReferenceError({
				code: "missing_reference_mapping",
				message: "Missing event reference mapping for 'source-a'",
			}),
		);
	}),
);
