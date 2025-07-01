import { writeFileSync } from "node:fs";
import { PassThrough } from "node:stream";
import { createReadableStreamFromReadable } from "@react-router/node";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { isbot } from "isbot";
import { renderToPipeableStream } from "react-dom/server";
import {
	type AppLoadContext,
	type EntryContext,
	ServerRouter,
} from "react-router";
import { TEMP_DIRECTORY, db, serverVariables } from "./lib/config.server";

migrate(db, { migrationsFolder: "app/drizzle/migrations" }).catch((error) => {
	console.error("Database migrations failed", error);
	process.exit(1);
});

writeFileSync(
	`${TEMP_DIRECTORY}/website-config.json`,
	JSON.stringify(serverVariables, null, 2),
);

const ABORT_DELAY = 5_000;

export default function handleRequest(
	request: Request,
	responseStatusCode: number,
	responseHeaders: Headers,
	reactRouterContext: EntryContext,
	_loadContext: AppLoadContext,
) {
	return isbot(request.headers.get("user-agent") || "")
		? handleBotRequest(
				request,
				responseStatusCode,
				responseHeaders,
				reactRouterContext,
			)
		: handleBrowserRequest(
				request,
				responseStatusCode,
				responseHeaders,
				reactRouterContext,
			);
}

function handleBotRequest(
	request: Request,
	responseStatusCode: number,
	responseHeaders: Headers,
	reactRouterContext: EntryContext,
) {
	return new Promise((resolve, reject) => {
		let shellRendered = false;
		const { pipe, abort } = renderToPipeableStream(
			<ServerRouter context={reactRouterContext} url={request.url} />,
			{
				onAllReady() {
					shellRendered = true;
					const body = new PassThrough();
					const stream = createReadableStreamFromReadable(body);

					responseHeaders.set("Content-Type", "text/html");

					resolve(
						new Response(stream, {
							headers: responseHeaders,
							status: responseStatusCode,
						}),
					);

					pipe(body);
				},
				onShellError(error: unknown) {
					reject(error);
				},
				onError(error: unknown) {
					// biome-ignore lint/style/noParameterAssign: part of the starter template
					responseStatusCode = 500;
					if (shellRendered) {
						console.error(error);
					}
				},
			},
		);

		setTimeout(abort, ABORT_DELAY);
	});
}

function handleBrowserRequest(
	request: Request,
	responseStatusCode: number,
	responseHeaders: Headers,
	reactRouterContext: EntryContext,
) {
	return new Promise((resolve, reject) => {
		let shellRendered = false;
		const { pipe, abort } = renderToPipeableStream(
			<ServerRouter context={reactRouterContext} url={request.url} />,
			{
				onShellReady() {
					shellRendered = true;
					const body = new PassThrough();
					const stream = createReadableStreamFromReadable(body);

					responseHeaders.set("Content-Type", "text/html");

					resolve(
						new Response(stream, {
							headers: responseHeaders,
							status: responseStatusCode,
						}),
					);

					pipe(body);
				},
				onShellError(error: unknown) {
					reject(error);
				},
				onError(error: unknown) {
					// biome-ignore lint/style/noParameterAssign: part of the starter template
					responseStatusCode = 500;
					if (shellRendered) {
						console.error(error);
					}
				},
			},
		);

		setTimeout(abort, ABORT_DELAY);
	});
}
