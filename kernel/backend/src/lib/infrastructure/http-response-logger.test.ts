import { expect, it } from "@effect/vitest";
import { Effect, Layer, Logger, References } from "effect";
import { HttpServerRequest, HttpServerResponse } from "effect/unstable/http";

import { logHttpResponse, logHttpResponseAtRoot } from "./http-response-logger";

it.effect("logs the route template instead of request path parameters", () => {
	const entries: Array<Readonly<Record<string, unknown>>> = [];
	const logger = Logger.make<unknown, void>((options) =>
		entries.push(options.fiber.getRef(References.CurrentLogAnnotations)),
	);
	const request = HttpServerRequest.fromWeb(
		new Request("http://server.test/widgets/private-token/file.js"),
	);

	return logHttpResponse(
		Effect.succeed(HttpServerResponse.empty()),
		"/widgets/:token/:fileName",
	).pipe(
		Effect.provideService(HttpServerRequest.HttpServerRequest, request),
		Effect.provide(
			Layer.mergeAll(Layer.succeed(References.MinimumLogLevel, "Debug"), Logger.layer([logger])),
		),
		Effect.tap(() =>
			Effect.sync(() => {
				expect(entries).toContainEqual({
					"http.status": 204,
					"http.method": "GET",
					"http.url": "/widgets/:token/:fileName",
				});
				expect(entries.some((entry) => Object.values(entry).includes("private-token"))).toBe(false);
			}),
		),
	);
});

it.effect("does not duplicate nested response logs", () => {
	const levels: Array<unknown> = [];
	const logger = Logger.make<unknown, void>((options) => levels.push(options.logLevel));
	const request = HttpServerRequest.fromWeb(new Request("http://server.test/widgets"));
	const response = HttpServerResponse.empty();
	const authenticatedLog = logHttpResponse(Effect.succeed(response), "/widgets", {}, "Debug");

	return logHttpResponseAtRoot(authenticatedLog, "/widgets", {}, "Debug").pipe(
		Effect.provideService(HttpServerRequest.HttpServerRequest, request),
		Effect.provide(
			Layer.mergeAll(Layer.succeed(References.MinimumLogLevel, "Debug"), Logger.layer([logger])),
		),
		Effect.tap(() =>
			Effect.sync(() => {
				expect(levels).toEqual(["Debug"]);
			}),
		),
	);
});
