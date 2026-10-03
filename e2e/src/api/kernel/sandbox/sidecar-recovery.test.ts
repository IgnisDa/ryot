import { Config, Effect, FileSystem, Schema } from "effect";

import {
	createAuthenticatedClient,
	enqueueSandboxScript,
	getImportRun,
	installSandboxScriptScoped,
	listImportedEntityNames,
	pollImportRunUntilTerminal,
	pollSandboxResult,
	pollUntil,
	requireCompletedSandboxValue,
	uninstallTestPlugin,
} from "~/fixtures/kernel";
import { installSidecarRecoveryImport } from "~/fixtures/kernel/sidecar-recovery-import";
import { requirePresent } from "~/support/assertions";
import { describe, expect, it } from "~/support/effect-test";
import { startFakeHttpServerScoped } from "~/support/fake-http-server";

const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));

const userCoreProcess = Effect.fnUntraced(function* (backendPid: number) {
	const command = Bun.spawn(["ps", "-axo", "pid,ppid,args"], { stdout: "pipe" });
	const output = yield* Effect.tryPromise(() => new Response(command.stdout).text());
	expect(yield* Effect.promise(() => command.exited)).toBe(0);
	const matches = output.split("\n").flatMap((line) => {
		const fields = line.trim().split(/\s+/);
		return fields[1] === String(backendPid) &&
			line.includes("ryot-sandboxd") &&
			line.includes("--tier core --trust user")
			? [{ pid: Number(fields[0]), generation: Number(fields[fields.indexOf("--generation") + 1]) }]
			: [];
	});
	expect(matches.length).toBeLessThanOrEqual(1);
	return matches[0] ?? null;
});

describe("sandbox sidecar recovery", () => {
	it.live("sandbox_sidecar_recovers_mid_import", () =>
		Effect.gen(function* () {
			const { client, userId } = yield* createAuthenticatedClient();
			const http = yield* startFakeHttpServerScoped(() => Response.json({ entered: true }));
			const fixture = yield* Effect.acquireRelease(
				installSidecarRecoveryImport(client, http.url),
				({ plugin }) => uninstallTestPlugin(plugin),
			);
			expect(fixture.plugin.scope).toBe("user");
			const resolvedJob = yield* enqueueSandboxScript(userId, {
				context: { value: fixture.suffix, identifierType: "source-id" },
				scriptId: requirePresent(fixture.plugin.scriptIds[fixture.resolveSlug], "resolve script"),
			});
			expect(
				requireCompletedSandboxValue(
					yield* pollSandboxResult(userId, resolvedJob.jobId),
					"healthy user-scope provider preflight",
				),
			).toEqual({ externalId: fixture.suffix });
			const slug = `sidecar-fatal-${crypto.randomUUID()}`;
			const installed = yield* installSandboxScriptScoped({
				slug,
				client,
				name: "Sidecar fatal builtin",
				source: `
import { defineManifest, defineScript } from "@ryot-app/sandbox-sdk/driver";
import { Effect, Schema } from "@ryot-app/sandbox-sdk/effect";
export const manifest = defineManifest({ kind: "script", name: "Sidecar fatal builtin", slug: ${encodeJson(slug)} });
export default defineScript({ manifest, input: Schema.Unknown, output: Schema.Unknown,
  run: () => Effect.sync(() => new Array(2 ** 28).fill(0)),
});`,
			});
			const fs = yield* FileSystem.FileSystem;
			const logFile = yield* Config.String("E2E_SERVER_LOG_FILE");
			const checkpoints = fs
				.readFileString(logFile)
				.pipe(Effect.map((contents) => contents.split(fixture.checkpoint).length - 1));
			const pid = yield* Config.Int("E2E_SERVER_PID");
			const before = requirePresent(
				yield* userCoreProcess(pid),
				"User/core sidecar must be resident",
			);
			const run = yield* client.call((c) =>
				c.imports.createRun({ payload: { source: fixture.source } }),
			);
			yield* pollUntil(
				"provider to park in its live isolate",
				Effect.gen(function* () {
					const detail = yield* getImportRun(client, run.id, undefined, 100);
					if (detail.run?.status === "failed" || detail.run?.status === "completed") {
						throw new Error(`Import ended before the provider checkpoint: ${encodeJson(detail)}`);
					}
					return (yield* checkpoints) === 1 ? true : null;
				}),
			);
			expect((yield* getImportRun(client, run.id, undefined, 100)).run).toMatchObject({
				status: "running",
				failureReason: null,
				summary: [{ counts: { created: 1, unsuccessful: 0 } }],
			});
			expect(yield* listImportedEntityNames(client, fixture.entitySchemaSlug)).toEqual([
				fixture.committedName,
			]);
			expect(yield* userCoreProcess(pid)).toEqual(before);
			const job = yield* enqueueSandboxScript(userId, { scriptId: installed.scriptId });
			const after = yield* pollUntil(
				"native user/core generation replacement",
				userCoreProcess(pid).pipe(
					Effect.map((child) => (child !== null && child.pid !== before.pid ? child : null)),
				),
			);
			expect(after.generation).toBeGreaterThan(before.generation);
			yield* pollUntil(
				"collateral provider replay to park again",
				checkpoints.pipe(Effect.map((count) => (count === 2 ? true : null))),
			);
			const entered = http.requests.filter(({ path }) => path === "/enter");
			expect(entered).toHaveLength(1);
			expect(
				(yield* listImportedEntityNames(client, fixture.entitySchemaSlug)).filter(
					(name) => name === fixture.committedName,
				),
			).toEqual([fixture.committedName]);
			expect((yield* pollSandboxResult(userId, job.jobId)).status).toBe("failed");
			expect(yield* pollImportRunUntilTerminal(client, run.id)).toMatchObject({
				status: "completed",
				failureReason: null,
				summary: [
					{ counts: { created: 1, updated: 0, skipped: 0, unchanged: 1, unsuccessful: 0 } },
				],
			});
			expect(yield* listImportedEntityNames(client, fixture.entitySchemaSlug)).toEqual([
				fixture.committedName,
				fixture.recoveredName,
			]);
			expect(http.requests.filter(({ path }) => path === "/enter")).toHaveLength(1);
			expect(yield* userCoreProcess(pid)).toEqual(after);
		}),
	);
});
