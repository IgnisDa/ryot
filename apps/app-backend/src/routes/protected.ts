import { spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { generateId } from "better-auth";
import { Hono } from "hono";
import { requireAuth } from "../auth/middleware";
import { getQueues } from "../queue";

export const protectedApi = new Hono()
	.use("*", requireAuth)
	.get("/me", async (c) => {
		const user = c.get("user");
		const session = c.get("session");

		const queues = getQueues();
		await queues.exampleQueue.add("user-login", {
			message: `User ${user.id} accessed /me endpoint and id is ${generateId()}`,
		});

		const scriptContent = `
console.log("Hello from Deno!");
console.log("User ID: ${user.id}");
console.log("Deno version:", Deno.version.deno);
console.log("Environment:", Deno.env.toObject());
`;

		const scriptPath = "/tmp/ryot-deno-script.js";
		await writeFile(scriptPath, scriptContent);

		const denoOutput = await new Promise<string>((resolve, reject) => {
			const proc = spawn("deno", ["run", scriptPath]);
			let output = "";
			let errorOutput = "";

			proc.stdout.on("data", (data) => {
				output += data.toString();
			});

			proc.stderr.on("data", (data) => {
				errorOutput += data.toString();
			});

			proc.on("close", (code) => {
				if (code === 0) {
					resolve(output);
				} else {
					reject(new Error(`Deno exited with code ${code}: ${errorOutput}`));
				}
			});
		});

		return c.json({ user, session, denoOutput });
	});
