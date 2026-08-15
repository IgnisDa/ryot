import { Effect } from "effect";

import {
	createAuthenticatedClient,
	createClientPageSession,
	createEntityBrowserSavedView,
	prepareClientPage,
} from "~/fixtures/kernel";
import { assertCondition, assertTaggedError } from "~/support/assertions";
import { describe, expect, it } from "~/support/effect-test";

describe("kernel entity browser E2E", () => {
	it.live("reuses its durable build and rejects substituted build identities", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const view = yield* createEntityBrowserSavedView(client);
			const first = yield* prepareClientPage(client, view.id);
			const second = yield* prepareClientPage(client, view.id);
			assertCondition(
				first.identity.kind === "kernel-saved-view" && second.identity.kind === "kernel-saved-view",
				"Expected kernel saved-view preparation identities",
			);

			expect(second.identity.buildId).toBe(first.identity.buildId);
			expect(second.identity.artifactHash).toBe(first.identity.artifactHash);
			yield* createClientPageSession(client, first.identity);

			for (const identity of [
				{ ...first.identity, buildId: `${first.identity.buildId}-substituted` },
				{ ...first.identity, artifactHash: `${first.identity.artifactHash}-substituted` },
			]) {
				const stale = yield* Effect.flip(createClientPageSession(client, identity));
				assertTaggedError(stale, "ClientPageStalePreparation");
				expect(stale.reason).toEqual({ code: "stale-preparation" });
			}
		}),
	);
});
