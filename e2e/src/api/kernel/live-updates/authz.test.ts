import { OAUTH_IMPERSONATION_WEB_CLIENT_ID } from "@ryot-app/contract/oauth";
import { Effect } from "effect";

import {
	createApiKey,
	createAuthenticatedClient,
	createImpersonationSession,
	createPluginSchemaAndEntity,
	endImpersonationSession,
	makeSession,
	openLiveUpdatesScoped,
} from "~/fixtures/kernel";
import { describe, expect, it } from "~/support/effect-test";
import { getApiUrl } from "~/support/harness-target";
import { webRequest } from "~/support/web-request";

describe("live updates authorization", () => {
	it.live("ignores another user's private entity", () =>
		Effect.gen(function* () {
			const authA = yield* createAuthenticatedClient();
			const authB = yield* createAuthenticatedClient();
			const privateEntity = yield* createPluginSchemaAndEntity(authA.client);

			const streamB = yield* openLiveUpdatesScoped(authB);
			yield* streamB.populate([privateEntity.entityId], "interactive");
			yield* streamB.expectNoEntityUpdated(privateEntity.entityId, { windowMs: 4000 });
		}),
	);

	it.live("rejects an unauthenticated stream and populate request", () =>
		Effect.gen(function* () {
			const stream = yield* webRequest(`${getApiUrl()}/events`);
			expect(stream.status).toBe(401);
			const populate = yield* webRequest(`${getApiUrl()}/entities/populate`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: '{"entityIds":[],"priority":"background"}',
			});
			expect(populate.status).toBe(401);
		}),
	);

	it.live("opens a stream with an API key", () =>
		Effect.gen(function* () {
			const auth = yield* createAuthenticatedClient();
			const apiKey = yield* createApiKey(auth.sessionCookie);
			yield* openLiveUpdatesScoped({ client: makeSession(undefined, { "X-Api-Key": apiKey }) });
		}),
	);

	it.live("ends an impersonation stream when its session ends", () =>
		Effect.gen(function* () {
			const target = yield* createAuthenticatedClient();
			const impersonation = yield* createImpersonationSession(
				target.userId,
				OAUTH_IMPERSONATION_WEB_CLIENT_ID,
			);
			const stream = yield* openLiveUpdatesScoped({ client: impersonation.client });
			const ended = yield* endImpersonationSession(impersonation);
			expect(ended.status).toBe(302);
			yield* stream.waitForEnd();
		}),
	);
});
