import { expect, it } from "bun:test";

import { presentationDeclarationIssue } from "./presentation";

const title = {
	key: "title",
	expr: { field: "name", type: "column", tableAlias: "entity" },
} as const;
it("rejects whole public declarations containing private or correlated fields", () => {
	expect(presentationDeclarationIssue({ owner: [title], entity: [title] })).toBeNull();
	for (const field of ["userId", "rank", "private"]) {
		expect(
			presentationDeclarationIssue({
				owner: [title],
				entity: [title, { key: "private", expr: { ...title.expr, field } }],
			}),
		).toContain("must read only the subject entity");
	}
	expect(
		presentationDeclarationIssue({
			owner: [title],
			entity: [title, { key: "related", expr: { ...title.expr, tableAlias: "related" } }],
		}),
	).toContain("must read only the subject entity");
	expect(presentationDeclarationIssue({ owner: [title], entity: [title, title] })).toContain(
		"Invalid presentation field",
	);
});
