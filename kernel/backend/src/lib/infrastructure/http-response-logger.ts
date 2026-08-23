import { Effect, Option } from "effect";
import {
	HttpMiddleware,
	HttpServerError,
	HttpServerRequest,
	type HttpServerResponse,
} from "effect/unstable/http";

const logResponse = (status: number, message: unknown, level: "Debug" | "Info") => {
	if (status >= 500) {
		return Effect.logError(message);
	}
	if (status === 429) {
		return Effect.logWarning(message);
	}
	return level === "Debug" ? Effect.logDebug(message) : Effect.log(message);
};

export const logHttpResponse = Effect.fn("logHttpResponse")(function* <E, R>(
	httpEffect: Effect.Effect<HttpServerResponse.HttpServerResponse, E, R>,
	url: string,
	annotations: Readonly<Record<string, unknown>> = {},
	level: "Debug" | "Info" = "Info",
) {
	const request = yield* HttpServerRequest.HttpServerRequest;
	return yield* Effect.withLogSpan(
		Effect.flatMap(Effect.exit(httpEffect), (exit) => {
			if (exit._tag === "Failure") {
				const [response, cause] = HttpServerError.causeResponseStripped(exit.cause);
				return Effect.andThen(
					Effect.annotateLogs(
						logResponse(
							response.status,
							Option.getOrElse(cause, () => "Sent HTTP Response"),
							level,
						),
						{
							...annotations,
							"http.url": url,
							"http.method": request.method,
							"http.status": response.status,
						},
					),
					exit,
				);
			}
			return Effect.andThen(
				Effect.annotateLogs(logResponse(exit.value.status, "Sent HTTP response", level), {
					...annotations,
					"http.url": url,
					"http.method": request.method,
					"http.status": exit.value.status,
				}),
				exit,
			);
		}),
		"http.span",
	);
}, HttpMiddleware.withLoggerDisabled);
