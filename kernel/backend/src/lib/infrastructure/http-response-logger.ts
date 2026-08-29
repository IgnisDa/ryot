import { Effect, Option } from "effect";
import { HttpServerError, HttpServerRequest, type HttpServerResponse } from "effect/unstable/http";

const responseLoggerDisabledRequests = new WeakSet<object>();

const logResponse = (status: number, message: unknown, level: "Debug" | "Info") => {
	if (status >= 500) {
		return Effect.logError(message);
	}
	if (status === 429) {
		return Effect.logWarning(message);
	}
	return level === "Debug" ? Effect.logDebug(message) : Effect.log(message);
};

const logHttpResponseEffect = <E, R>(
	httpEffect: Effect.Effect<HttpServerResponse.HttpServerResponse, E, R>,
	url: string,
	disableParentLogger: boolean,
	annotations: Readonly<Record<string, unknown>> = {},
	level: "Debug" | "Info" = "Info",
) =>
	Effect.gen(function* () {
		const request = yield* HttpServerRequest.HttpServerRequest;
		return yield* Effect.withLogSpan(
			Effect.flatMap(Effect.exit(httpEffect), (exit) => {
				if (responseLoggerDisabledRequests.has(request.source)) {
					return exit;
				}
				const markParentLoggerDisabled = disableParentLogger
					? Effect.sync(() => responseLoggerDisabledRequests.add(request.source))
					: Effect.void;
				let status: number;
				let message: unknown;
				if (exit._tag === "Failure") {
					const [response, cause] = HttpServerError.causeResponseStripped(exit.cause);
					status = response.status;
					message = Option.getOrElse(cause, () => "Sent HTTP Response");
				} else {
					status = exit.value.status;
					message = "Sent HTTP response";
				}
				return Effect.andThen(
					Effect.andThen(
						Effect.annotateLogs(logResponse(status, message, level), {
							...annotations,
							"http.url": url,
							"http.status": status,
							"http.method": request.method,
						}),
						markParentLoggerDisabled,
					),
					exit,
				);
			}),
			"http.span",
		);
	});

export const logHttpResponse = Effect.fn("logHttpResponse")(function* <E, R>(
	httpEffect: Effect.Effect<HttpServerResponse.HttpServerResponse, E, R>,
	url: string,
	annotations: Readonly<Record<string, unknown>> = {},
	level: "Debug" | "Info" = "Info",
) {
	return yield* logHttpResponseEffect(httpEffect, url, true, annotations, level);
});

export const logHttpResponseAtRoot = Effect.fn("logHttpResponseAtRoot")(function* <E, R>(
	httpEffect: Effect.Effect<HttpServerResponse.HttpServerResponse, E, R>,
	url: string,
	annotations: Readonly<Record<string, unknown>> = {},
	level: "Debug" | "Info" = "Info",
) {
	return yield* logHttpResponseEffect(httpEffect, url, false, annotations, level);
});
