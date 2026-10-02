import { type ChildProcess, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import path from "node:path";
import getPort from "get-port";
import { GraphQLClient } from "graphql-request";
import { TEST_ADMIN_ACCESS_TOKEN } from "../utils";
import { executeTestDatabaseSql } from "./security-database";

const MONOREPO_ROOT = path.resolve(__dirname, "../../../");
const BACKEND_PATH = path.join(MONOREPO_ROOT, "target/release/backend");
const STARTUP_TIMEOUT_MS = 45_000;

type CapturedOutput = {
	add: (chunk: Buffer) => void;
	summary: () => string;
};

function captureOutput(secrets: string[]): CapturedOutput {
	let pending = "";
	const lines: string[] = [];
	const sanitizeLine = (line: string) => {
		let safeLine = line;
		for (const secret of secrets) {
			if (secret) safeLine = safeLine.replaceAll(secret, "[redacted]");
		}
		return safeLine.slice(0, 300);
	};
	const addLine = (line: string) => {
		lines.push(sanitizeLine(line));
		if (lines.length > 20) lines.shift();
	};
	return {
		add: (chunk) => {
			const output = `${pending}${chunk.toString()}`;
			const completeLines = output.split(/\r?\n/);
			pending = completeLines.pop() ?? "";
			for (const line of completeLines) addLine(line);
		},
		summary: () =>
			[...lines, ...(pending ? [sanitizeLine(pending)] : [])]
				.slice(-8)
				.join("\n"),
	};
}

function wait(ms: number) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function waitForExit(process: ChildProcess, timeoutMs: number) {
	if (process.exitCode !== null || process.signalCode !== null) {
		return Promise.resolve(true);
	}
	return new Promise<boolean>((resolve) => {
		const finish = (exited: boolean) => {
			clearTimeout(timer);
			process.off("exit", onExit);
			resolve(exited);
		};
		const onExit = () => finish(true);
		const timer = setTimeout(() => finish(false), timeoutMs);
		process.once("exit", onExit);
	});
}

async function stopBackend(process: ChildProcess) {
	if (process.exitCode !== null || process.signalCode !== null) return;
	process.kill("SIGTERM");
	if (await waitForExit(process, 5000)) return;
	process.kill("SIGKILL");
	if (!(await waitForExit(process, 5000))) {
		throw new Error("Registration test backend did not stop");
	}
}

async function waitForBackend(
	process: ChildProcess,
	graphqlUrl: string,
	output: CapturedOutput,
	processErrors: string[],
) {
	const timeoutAt = Date.now() + STARTUP_TIMEOUT_MS;
	while (Date.now() < timeoutAt) {
		if (process.exitCode !== null || process.signalCode !== null) break;
		if (processErrors.length > 0) break;
		try {
			const response = await fetch(graphqlUrl, {
				method: "POST",
				headers: { "content-type": "application/json" },
				signal: AbortSignal.timeout(1000),
				body: JSON.stringify({ query: "{ __typename }" }),
			});
			if (response.ok) {
				const result = (await response.json()) as {
					data?: { __typename?: string };
					errors?: unknown[];
				};
				if (result.data?.__typename && !result.errors?.length) return;
			}
		} catch {
			// The backend may not be listening yet.
		}
		await wait(250);
	}
	throw new Error(
		`Registration test backend did not become ready within 45 seconds. ${processErrors.join(" ")}\n${output.summary()}`,
	);
}

export async function withRegistrationServer<T>(
	options: { allowRegistration: boolean },
	callback: (server: { client: GraphQLClient; url: string }) => Promise<T>,
) {
	const baseDatabaseUrl = process.env.TEST_DATABASE_URL;
	if (!baseDatabaseUrl) throw new Error("TEST_DATABASE_URL is not set");
	const databaseName = `registration${randomBytes(12).toString("hex")}`;
	const databaseUrl = new URL(baseDatabaseUrl);
	databaseUrl.pathname = `/${databaseName}`;
	const port = await getPort();
	const url = `http://127.0.0.1:${port}`;
	const graphqlUrl = `${url}/graphql`;
	let databaseCreated = false;
	let backendProcess: ChildProcess | undefined;

	try {
		executeTestDatabaseSql(`CREATE DATABASE "${databaseName}"`);
		databaseCreated = true;
		const output = captureOutput([
			databaseUrl.toString(),
			TEST_ADMIN_ACCESS_TOKEN,
			"dummy-root-key",
		]);
		const processErrors: string[] = [];
		backendProcess = spawn(BACKEND_PATH, [], {
			cwd: MONOREPO_ROOT,
			stdio: ["ignore", "pipe", "pipe"],
			env: {
				...process.env,
				DATABASE_URL: databaseUrl.toString(),
				SERVER_BACKEND_HOST: "127.0.0.1",
				SERVER_BACKEND_PORT: port.toString(),
				SERVER_ADMIN_ACCESS_TOKEN: TEST_ADMIN_ACCESS_TOKEN,
				SERVER_DISABLE_BACKGROUND_JOBS: "true",
				USERS_ALLOW_REGISTRATION: options.allowRegistration.toString(),
				USERS_VALIDATE_PASSWORD: "true",
				USERS_DISABLE_LOCAL_AUTH: "false",
				UNKEY_ROOT_KEY: "dummy-root-key",
				SERVER_OIDC_CLIENT_ID: "",
				SERVER_OIDC_CLIENT_SECRET: "",
				SERVER_OIDC_ISSUER_URL: "",
				FRONTEND_URL: url,
			},
		});
		backendProcess.stdout?.on("data", output.add);
		backendProcess.stderr?.on("data", output.add);
		backendProcess.on("error", (error) => processErrors.push(error.message));
		await waitForBackend(backendProcess, graphqlUrl, output, processErrors);
		return await callback({ client: new GraphQLClient(graphqlUrl), url });
	} finally {
		try {
			if (backendProcess) await stopBackend(backendProcess);
		} finally {
			if (databaseCreated) {
				executeTestDatabaseSql(
					`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`,
				);
			}
		}
	}
}
