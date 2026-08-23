/* oxlint-disable */
// TODO: delete this file eventually

import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";

import { Effect } from "effect";

import { createTestUser } from "../fixtures/kernel/auth";
import {
	installFixtureClientPlugin,
	updateFixtureClientPlugin,
} from "../fixtures/kernel/client-plugin";
import { type ContractSession, makeSession } from "../fixtures/kernel/contract-client";

const API_BASE_URL = process.env.API_BASE_URL ?? "http://localhost:3000/api";
const repositoryRoot = fileURLToPath(new URL("../../..", import.meta.url));

async function buildFixturePlugin() {
	const build = Bun.spawn(["bun", "turbo", "--filter=@ryot/fixture-plugin", "build"], {
		stderr: "inherit",
		stdout: "inherit",
		cwd: repositoryRoot,
	});
	const exitCode = await build.exited;
	if (exitCode !== 0) {
		throw new Error(`Fixture plugin build failed with exit code ${exitCode}`);
	}
}

async function main() {
	await buildFixturePlugin();
	const { token, email, password } = await Effect.runPromise(createTestUser(API_BASE_URL));
	const client: ContractSession = makeSession(API_BASE_URL, { Authorization: `Bearer ${token}` });
	const installation = await Effect.runPromise(
		installFixtureClientPlugin(client, "A", "", API_BASE_URL),
	);

	if (installation.health !== "ready") {
		throw new Error(
			`Fixture client plugin installation finished with health '${installation.health}'`,
		);
	}

	console.log(`Email: ${email}`);
	console.log(`Password: ${password}`);
	console.log("Plugin URL: http://localhost:3000/fixture");

	const input = createInterface({ input: process.stdin, output: process.stdout });
	try {
		await input.question("Press Enter to update the fixture plugin to revision B...");
	} finally {
		input.close();
	}

	const updatedInstallation = await Effect.runPromise(
		updateFixtureClientPlugin(client, "B", "", API_BASE_URL),
	);
	if (updatedInstallation.health !== "ready") {
		throw new Error(
			`Fixture client plugin update finished with health '${updatedInstallation.health}'`,
		);
	}

	console.log("Updated fixture plugin to revision B.");
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
