import path from "node:path";
import { createRequestListener } from "@mjackson/node-fetch-server";
import compression from "compression";
import express from "express";
import morgan from "morgan";
import { createRequestHandler } from "react-router";

process.env.NODE_ENV ??= "production";

const app = express();
const build = await import("./build/server/index.js");
const handleRequest = createRequestHandler(build, process.env.NODE_ENV);

app.disable("x-powered-by");
app.set("trust proxy", "loopback");
app.use(compression());
app.use(
	path.posix.join(build.publicPath, "assets"),
	express.static(path.join(build.assetsBuildDirectory, "assets"), {
		maxAge: "1y",
		immutable: true,
	}),
);
app.use(build.publicPath, express.static(build.assetsBuildDirectory));
app.use(express.static("public", { maxAge: "1h" }));
app.use(morgan("tiny"));
app.use(async (request, response, next) => {
	try {
		const protocol = request.protocol.toLowerCase();
		const trustProxy = app.get("trust proxy fn");
		const forwardedHost = trustProxy(request.socket.remoteAddress, 0)
			? request.get("X-Forwarded-Host")?.split(",")[0].trim()
			: undefined;
		const host = forwardedHost || request.get("Host");
		if (
			!host ||
			/[\\/?#@]/.test(host) ||
			!request.url.startsWith("/") ||
			!["http", "https"].includes(protocol)
		) {
			response.sendStatus(400);
			return;
		}
		// Preserve the host when the request path starts with //.
		request.url = new URL(`${protocol}://${host}${request.url}`).href;
		await createRequestListener(handleRequest)(request, response);
	} catch (error) {
		next(error);
	}
});

const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || "127.0.0.1";
const server = app.listen(port, host, () => {
	console.log(`[frontend] Listening on ${host}:${port}`);
});

for (const signal of ["SIGTERM", "SIGINT"]) {
	process.once(signal, () => server.close());
}
