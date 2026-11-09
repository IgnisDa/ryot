import { describe, expect } from "bun:test";

import { PublicationUnavailable } from "@ryot-app/contract/modules/publications/schemas";
import { testTimeout } from "@ryot-app/testing/test-timeout";
import { it } from "@voila.dev/effect-bun-test";
import { Duration, Effect } from "effect";
import { TestClock } from "effect/testing";

import { ServerOrigin } from "#/api/origin";
import {
	PublicationVisitApiError,
	type PublicationVisitsApi,
	type PublicationVisitScope,
} from "#/api/publications";

import { makeVisitSession, previewHash, takeVisitCredentials } from "./visit-session";

const origin = ServerOrigin.make("https://ryot.example");
const unused = () => Effect.die("not used");
const sessionExpired = new PublicationVisitApiError({
	cause: new PublicationUnavailable({ reason: { code: "session-expired" } }),
});

const visitsApi = (exchanged: string[]): PublicationVisitsApi["Service"] => ({
	page: unused,
	assets: unused,
	ryotql: unused,
	document: unused,
	exchange: (_origin, request) => {
		exchanged.push(request.payload.secret);
		return Effect.succeed({
			expiresAt: "1970-01-01T01:00:00.000Z",
			sessionToken: `session-${exchanged.length}`,
		});
	},
});

const tokenOf = (scope: PublicationVisitScope) => Effect.succeed(scope.sessionToken);

describe("publication visit session", () => {
	it("reads a link secret or an owner preview from the fragment", () => {
		expect(takeVisitCredentials("p1", "#secret")).toEqual({ session: null, secret: "secret" });
		expect(takeVisitCredentials("p1", `#${previewHash("preview")}`)).toEqual({
			secret: null,
			session: { token: "preview", expiresAt: Number.MAX_SAFE_INTEGER },
		});
	});

	it.effect(
		"exchanges the secret once and renews the session before it expires",
		() =>
			Effect.gen(function* () {
				const exchanged: string[] = [];
				const session = makeVisitSession({
					origin,
					publicationId: "p1",
					api: visitsApi(exchanged),
					credentials: { session: null, secret: "secret" },
				});
				expect(yield* session.run(tokenOf)).toBe("session-1");
				expect(yield* session.run(tokenOf)).toBe("session-1");
				yield* TestClock.adjust(Duration.minutes(59.75));
				expect(yield* session.run(tokenOf)).toBe("session-2");
				expect(exchanged).toEqual(["secret", "secret"]);
			}),
		testTimeout,
	);

	it.effect(
		"re-exchanges the secret once when the server ends the session",
		() =>
			Effect.gen(function* () {
				const exchanged: string[] = [];
				const tokens: string[] = [];
				const session = makeVisitSession({
					origin,
					publicationId: "p1",
					api: visitsApi(exchanged),
					credentials: { secret: "secret", session: { token: "stale", expiresAt: 3_600_000 } },
				});
				const result = yield* session.run((scope) => {
					tokens.push(scope.sessionToken);
					return scope.sessionToken === "stale"
						? Effect.fail(sessionExpired)
						: Effect.succeed(scope.sessionToken);
				});
				expect(result).toBe("session-1");
				expect(tokens).toEqual(["stale", "session-1"]);
			}),
		testTimeout,
	);

	it.effect(
		"ends an owner preview when its session ends",
		() =>
			Effect.gen(function* () {
				const exchanged: string[] = [];
				const session = makeVisitSession({
					origin,
					publicationId: "p1",
					api: visitsApi(exchanged),
					credentials: {
						secret: null,
						session: { token: "preview", expiresAt: Number.MAX_SAFE_INTEGER },
					},
				});
				const error = yield* session.run(() => Effect.fail(sessionExpired)).pipe(Effect.flip);
				expect(error).toBe(sessionExpired);
				expect(exchanged).toEqual([]);
			}),
		testTimeout,
	);
});
