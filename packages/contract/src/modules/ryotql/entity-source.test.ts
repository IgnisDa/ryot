import { expect, it } from "bun:test";

import { Result } from "effect";

import { EntityId, SavedViewId } from "../../schema/brands";
import { decodeEntitySourceReference, encodeEntitySourceReference } from "./entity-source";

it("uses the same tagged encoding for collection and saved-view selections without guessing raw IDs", () => {
	const collection = {
		kind: "collection",
		collectionId: EntityId.make("id:{unconstrained}"),
	} as const;
	const saved = {
		kind: "saved-view",
		reference: { kind: "custom", savedViewId: SavedViewId.make("view:1") },
	} as const;
	for (const reference of [collection, saved]) {
		expect(
			Result.getOrThrow(decodeEntitySourceReference(encodeEntitySourceReference(reference))),
		).toEqual(reference);
	}
	expect(Result.isFailure(decodeEntitySourceReference("id:{unconstrained}"))).toBe(true);
	expect(Result.isFailure(decodeEntitySourceReference('{"kind":"collection"}'))).toBe(true);
});
