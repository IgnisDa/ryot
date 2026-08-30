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

			expect(second.identity.artifactKey).toBe(first.identity.artifactKey);
			expect(second.identity.artifactHash).toBe(first.identity.artifactHash);
			expect((yield* checkClientPageFreshness(client, first.identity)).current).toBe(true);

			for (const identity of [
				{ ...first.identity, artifactKey: `${first.identity.artifactKey}-substituted` },
				{ ...first.identity, artifactHash: `${first.identity.artifactHash}-substituted` },
			]) {
				expect((yield* checkClientPageFreshness(client, identity)).current).toBe(false);
			}
		}),
	);
});
