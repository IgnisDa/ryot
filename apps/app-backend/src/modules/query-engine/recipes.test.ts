import type { QueryDocument } from "@ryot/contract/modules/query-engine/language";
import {
	buildAllCollectionsQueryDocument,
	buildDefaultSavedViewQueryDocument,
	buildEntityDetailQueryDocument,
	buildEntityInterestQueryDocument,
	buildEventHistoryQueryDocument,
} from "@ryot/query-engine/recipes/app";
import { describe, expect, it } from "vitest";

import { validateQueryDocument } from "./validator/document";

describe("shared query-engine recipes", () => {
	it("produces documents accepted by the query language validator", () => {
		const documents = [
			buildEntityDetailQueryDocument({ entityId: "entity", entitySchemaSlug: "book" }),
			buildEntityInterestQueryDocument({ entityIds: ["entity"], entitySchemaSlugs: ["book"] }),
			buildEventHistoryQueryDocument({
				page: 1,
				eventSchemaSlugs: ["complete"],
				entitySchemaSlugs: ["book"],
			}),
			buildAllCollectionsQueryDocument({}),
			buildDefaultSavedViewQueryDocument({ schemas: ["book"] }),
		] satisfies readonly QueryDocument[];

		expect(documents.map(validateQueryDocument)).toEqual(documents.map(() => null));
	});
});
