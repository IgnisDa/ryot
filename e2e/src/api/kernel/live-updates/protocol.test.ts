import { MAX_POPULATE_ENTITY_IDS } from "@ryot-app/contract/modules/live-updates/messages";
import { randomUuid } from "@ryot-app/testing/random";
import { Effect } from "effect";

import { createAuthenticatedClient, populateEntities } from "~/fixtures/kernel";
import { describe, expect, it } from "~/support/effect-test";

describe("entity populate request", () => {
	it.live("accepts a full batch and rejects one over the cap", () =>
		Effect.gen(function* () {
			const auth = yield* createAuthenticatedClient();
			const id = yield* randomUuid;
			const ids = Array.from({ length: MAX_POPULATE_ENTITY_IDS }, () => id);
			yield* populateEntities(auth, ids);

			const rejected = yield* populateEntities(auth, [...ids, id]).pipe(Effect.result);
			expect(rejected._tag).toBe("Failure");
		}),
	);
});
