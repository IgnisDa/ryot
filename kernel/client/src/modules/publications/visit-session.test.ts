import { describe, expect } from "bun:test";

import { PublicationUnavailable } from "@ryot-app/contract/modules/publications/schemas";
import { ExecutionSource } from "@ryot-app/contract/modules/ryotql/request";
import { testTimeout } from "@ryot-app/testing/test-timeout";
import { it } from "@voila.dev/effect-bun-test";
import { Duration, Effect, Result, Schema } from "effect";
import { TestClock } from "effect/testing";

import { ServerOrigin } from "#/api/origin";
import {
	PublicationVisitApiError,
	type PublicationVisitsApi,
	type PublicationVisitScope,
} from "#/api/publications";

import {
	makeVisitSession,
	previewHash,
	queryPublication,
	takeVisitCredentials,
} from "./visit-session";

const origin = ServerOrigin.make("https://ryot.example");
const unused = () => Effect.die("not used");
const sessionExpired = new PublicationVisitApiError({
	cause: new PublicationUnavailable({ reason: { code: "session-expired" } }),
});

const visitsApi = (exchanged: string[]): PublicationVisitsApi["Service"] => ({
	page: unused,
	assets: unused,
	ryotql: unused,
	describe: unused,
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
	it.effect(
		"rejects stored visitor sources before opening a session and forwards inline execution and describe",
		() =>
			Effect.gen(function* () {
				const exchanged: string[] = [];
				const calls: unknown[] = [];
				const api: PublicationVisitsApi["Service"] = {
					...visitsApi(exchanged),
					ryotql: (scope, request) =>
						Effect.sync(() => {
							calls.push({ scope, request, action: "execute" });
							return { data: {} };
						}),
					describe: (scope, request) =>
						Effect.sync(() => {
							calls.push({ scope, request, action: "describe" });
							return { sort: [], filter: [], parameters: { fields: {} } };
						}),
				};
				const session = makeVisitSession({
					api,
					origin,
					publicationId: "p1",
					credentials: { session: null, secret: "secret" },
				});
				for (const source of [
					{ query: "items", kind: "savedView", reference: { slug: "items", kind: "kernel" } },
					{ kind: "page", query: "items", pageId: "page-1" },
					{ kind: "plugin", query: "items", scope: "system", packageId: "example/plugin" },
				]) {
					const validated = Result.getOrThrow(Schema.decodeUnknownResult(ExecutionSource)(source));
					for (const action of ["execute", "describe"] as const) {
						expect(
							yield* queryPublication(session, api, { action, request: { source: validated } }),
						).toEqual({ outcome: "failure", reason: "query-failed" });
					}
				}
				expect(calls).toEqual([]);
				expect(exchanged).toEqual([]);
				const source = { kind: "inline", document: { queries: {} } } as const;
				expect(
					yield* queryPublication(session, api, {
						action: "execute",
						request: { source, arguments: { name: "selected" } },
					}),
				).toEqual({ outcome: "success", response: { data: {} } });
				expect(
					yield* queryPublication(session, api, {
						action: "describe",
						request: { source, arguments: { name: "selected" } },
					}),
				).toMatchObject({ outcome: "success" });
				expect(calls).toMatchObject([
					{
						action: "execute",
						scope: { sessionToken: "session-1" },
						request: { payload: { source, arguments: { name: "selected" } } },
					},
					{
						action: "describe",
						scope: { sessionToken: "session-1" },
						request: { payload: { source, arguments: { name: "selected" } } },
					},
				]);
				expect(exchanged).toEqual(["secret"]);
			}),
		testTimeout,
	);

	it("reads a link secret or an owner preview from the fragment", () => {
		expect(takeVisitCredentials("p1", "#secret")).toEqual({ session: null, secret: "secret" });
		const preview = previewHash({ sessionToken: "preview", expiresAt: "1970-01-01T01:00:00.000Z" });
		expect(takeVisitCredentials("p1", `#${preview}`)).toEqual({
			secret: null,
			session: { token: "preview", expiresAt: 3_600_000 },
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
					credentials: { secret: null, session: { token: "preview", expiresAt: 3_600_000 } },
				});
				const error = yield* session.run(() => Effect.fail(sessionExpired)).pipe(Effect.flip);
				expect(error).toBe(sessionExpired);
				expect(exchanged).toEqual([]);
			}),
		testTimeout,
	);
});
