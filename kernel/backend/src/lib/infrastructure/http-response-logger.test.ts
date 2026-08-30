import { expect, layer } from "@effect/vitest";
import { Context, Effect, Layer, Logger, type LogLevel, MutableRef, References, Ref } from "effect";
import { HttpServerRequest, HttpServerResponse } from "effect/unstable/http";

import { logHttpResponse, logHttpResponseAtRoot } from "./http-response-logger";

type LogEntry = {
	readonly logLevel: LogLevel.LogLevel;
	readonly annotations: Readonly<Record<string, unknown>>;
};

class RecordedLogs extends Context.Service<
	RecordedLogs,
	{ readonly entries: Effect.Effect<ReadonlyArray<LogEntry>> }
>()("test/RecordedLogs") {}

const recordedLogsLayer = Layer.unwrap(
	Effect.gen(function* () {
		const entries = yield* Ref.make<ReadonlyArray<LogEntry>>([]);
		const logger = Logger.make<unknown, void>((options) =>
			MutableRef.update(entries.ref, (all) => [
				...all,
				{
					logLevel: options.logLevel,
					annotations: options.fiber.getRef(References.CurrentLogAnnotations),
				},
			]),
		);
		return Layer.mergeAll(
			Layer.succeed(RecordedLogs, { entries: Ref.get(entries) }),
			Layer.succeed(References.MinimumLogLevel, "Debug"),
			Logger.layer([logger]),
		);
	}),
);

layer(recordedLogsLayer)((test) => {
	test.effect("logs the route template instead of request path parameters", () =>
		Effect.gen(function* () {
			const request = HttpServerRequest.fromWeb(
				new Request("http://server.test/widgets/private-token/file.js"),
			);

			yield* logHttpResponse(
				Effect.succeed(HttpServerResponse.empty()),
				"/widgets/:token/:fileName",
			).pipe(Effect.provideService(HttpServerRequest.HttpServerRequest, request));

			const entries = (yield* (yield* RecordedLogs).entries).map(({ annotations }) => annotations);
			expect(entries).toContainEqual({
				"http.status": 204,
				"http.method": "GET",
				"http.url": "/widgets/:token/:fileName",
			});
			expect(entries.some((entry) => Object.values(entry).includes("private-token"))).toBe(false);
		}),
	);
});

layer(recordedLogsLayer)((test) => {
	test.effect("does not duplicate nested response logs", () =>
		Effect.gen(function* () {
			const request = HttpServerRequest.fromWeb(new Request("http://server.test/widgets"));
			const response = HttpServerResponse.empty();
			const authenticatedLog = logHttpResponse(Effect.succeed(response), "/widgets", {}, "Debug");

			yield* logHttpResponseAtRoot(authenticatedLog, "/widgets", {}, "Debug").pipe(
				Effect.provideService(HttpServerRequest.HttpServerRequest, request),
			);

			const levels = (yield* (yield* RecordedLogs).entries).map(({ logLevel }) => logLevel);
			expect(levels).toEqual(["Debug"]);
		}),
	);
});
