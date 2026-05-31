import { isbot } from "isbot";
import { renderToReadableStream } from "react-dom/server";
import { type AppLoadContext, type EntryContext, ServerRouter } from "react-router";

const ABORT_DELAY = 5_000;

export default async function handleRequest(
	request: Request,
	responseStatusCode: number,
	responseHeaders: Headers,
	reactRouterContext: EntryContext,
	_loadContext: AppLoadContext,
) {
	if (request.method.toUpperCase() === "HEAD") {
		return new Response(null, { status: responseStatusCode, headers: responseHeaders });
	}

	const isBot = isbot(request.headers.get("user-agent") ?? "");

	const abortController = new AbortController();
	const timeoutId = setTimeout(() => abortController.abort(), ABORT_DELAY);

	const stream = await renderToReadableStream(
		<ServerRouter context={reactRouterContext} url={request.url} />,
		{
			signal: abortController.signal,
			onError(error: unknown) {
				// oxlint-disable-next-line no-param-reassign
				responseStatusCode = 500;
				console.error(error);
			},
		},
	);

	clearTimeout(timeoutId);

	if (isBot) {
		await stream.allReady;
	}

	responseHeaders.set("Content-Type", "text/html");

	return new Response(stream, {
		headers: responseHeaders,
		status: responseStatusCode,
	});
}
