import { Effect } from "effect";
import { isbot } from "isbot";
import { renderToReadableStream } from "react-dom/server";
import { type AppLoadContext, type EntryContext, ServerRouter } from "react-router";

import { WebsiteFailure } from "~/lib/effect.server";
import { runPromise } from "~/lib/runtime.server";

const ABORT_DELAY = 5_000;

export default function handleRequest(
	request: Request,
	responseStatusCode: number,
	responseHeaders: Headers,
	reactRouterContext: EntryContext,
	_loadContext: AppLoadContext,
) {
	return runPromise(
		Effect.gen(function* () {
			if (request.method.toUpperCase() === "HEAD") {
				return new Response(null, { headers: responseHeaders, status: responseStatusCode });
			}

			const isBot = isbot(request.headers.get("user-agent") ?? "");

			const stream = yield* Effect.tryPromise({
				catch: (cause) => new WebsiteFailure({ cause }),
				try: (signal) =>
					renderToReadableStream(<ServerRouter url={request.url} context={reactRouterContext} />, {
						signal,
						onError(error: unknown) {
							// oxlint-disable-next-line no-param-reassign
							responseStatusCode = 500;
							console.error(error);
						},
					}),
			}).pipe(Effect.timeout(ABORT_DELAY));

			if (isBot) {
				yield* Effect.promise(() => stream.allReady);
			}

			responseHeaders.set("Content-Type", "text/html");

			return new Response(stream, { headers: responseHeaders, status: responseStatusCode });
		}),
	);
}
