import { Effect } from "effect";

import {
	createAuthenticatedClient,
	checkClientPageFreshness,
	createEntityBrowserSavedView,
	prepareClientPage,
} from "~/fixtures/kernel";
import { assertCondition } from "~/support/assertions";
import { describe, expect, it } from "~/support/effect-test";

describe("kernel entity browser E2E", () => {
	it.live("reuses its durable build and rejects substituted build identities", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const view = yield* createEntityBrowserSavedView(client);
			const first = yield* prepareClientPage(client, view.slug);
			const second = yield* prepareClientPage(client, view.slug);
			assertCondition(
				first.identity.kind === "kernel-saved-view" && second.identity.kind === "kernel-saved-view",
				"Expected kernel saved-view preparation identities",
			);

			expect(second.identity.compositionKey).toBe(first.identity.compositionKey);
			expect(second.identity.compositionHash).toBe(first.identity.compositionHash);
			expect((yield* checkClientPageFreshness(client, first.identity)).current).toBe(true);

			for (const identity of [
				{ ...first.identity, compositionKey: `${first.identity.compositionKey}-substituted` },
				{ ...first.identity, compositionHash: `${first.identity.compositionHash}-substituted` },
			]) {
				expect((yield* checkClientPageFreshness(client, identity)).current).toBe(false);
			}
		}),
	);
});
