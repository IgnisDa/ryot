import { expect, it } from "bun:test";

import { EntityId } from "@ryot-app/contract/schema/brands";

import {
	publicationSourceArguments,
	publicationsRecipe,
	sourcePublicationsRecipe,
} from "./publications";
import { bindRecipe, requireRowsQuery } from "./test-utils";

it("reads persisted publication definitions and finds only active kernel pages bound to the exact encoded source", () => {
	const args = publicationSourceArguments({
		kind: "collection",
		collectionId: EntityId.make("collection"),
	});
	expect(args).toEqual({ source: '{"collectionId":"collection","kind":"collection"}' });
	const query = requireRowsQuery(
		bindRecipe(sourcePublicationsRecipe, args).document.queries["publications"],
	);
	expect(JSON.stringify(query.where)).toContain('"path":["page","kind"]');
	expect(JSON.stringify(query.where)).toContain('"value":"kernel"');
	expect(JSON.stringify(query.where)).toContain('"path":["page","name"]');
	expect(JSON.stringify(query.where)).toContain('"value":"publication"');
	expect(JSON.stringify(query.where)).toContain('"path":["arguments","source"]');
	expect(JSON.stringify(query.where)).toContain('"type":"isNull"');
	const list = requireRowsQuery(publicationsRecipe.document.queries["publications"]);
	expect(list.output.fields).toContainEqual({
		key: "definition",
		expr: { type: "column", field: "definition", tableAlias: "publication" },
	});
	expect(list.output.fields.some((field) => "key" in field && field.key === "source")).toBe(false);
});
