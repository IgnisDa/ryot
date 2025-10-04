import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { apiApp } from "./api";

export const app = new Hono()
	.route("/api", apiApp)
	.use("*", serveStatic({ root: "./client" }))
	.use("*", serveStatic({ path: "./client/_shell.html" }));
