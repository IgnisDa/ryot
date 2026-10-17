import type { ContractSuccess } from "@ryot-app/contract/client";
import {
	decodeEntityWatchClientMessage,
	encodeEntityWatchServerMessage,
} from "@ryot-app/contract/modules/entity-watches/messages";
import { PluginId, PluginRevisionId, SandboxScriptId } from "@ryot-app/contract/schema/brands";
import { Effect, Result } from "effect";

import { downloadBackupArchive } from "~/fixtures/kernel/backups";
import { makeSession } from "~/fixtures/kernel/contract-client";
import { uploadImportFile } from "~/fixtures/kernel/imports";
import { openInterestWebSocketScoped } from "~/fixtures/kernel/interest-websocket";
import { uploadTemporaryArchive } from "~/fixtures/kernel/temporary-archive";
import {
	type InstalledTestPlugin,
	testPluginManifest,
	uninstallTestPluginStrict,
} from "~/fixtures/kernel/test-plugin";
import { describe, expect, it } from "~/support/effect-test";

import { apiProcessTarget, makeHarnessTarget } from "./harness-target";
import { makeTestResourceScope } from "./resource-scope";

const recordingTarget = (label: string) =>
	Effect.gen(function* () {
		const requests: Array<{ path: string; admin: string | null; authorization: string | null }> =
			[];
		const sockets: string[] = [];
		const httpServer = yield* Effect.acquireRelease(
			Effect.sync(() =>
				Bun.serve({
					port: 0,
					hostname: "127.0.0.1",
					websocket: {
						close: () => {
							sockets.push(`closed:${label}`);
						},
						message: (socket, data) => {
							const message = decodeEntityWatchClientMessage(String(data));
							if (
								Result.isFailure(message) ||
								message.success.type !== "authenticate" ||
								message.success.ticket !== label
							) {
								socket.close(1008);
								return;
							}
							sockets.push(`authenticated:${label}`);
							socket.send(
								encodeEntityWatchServerMessage({
									type: "ready",
									sessionId: label,
									maxEntityIds: 500,
									heartbeatIntervalMs: 30_000,
								}),
							);
						},
					},
					fetch: (request, server) => {
						const path = new URL(request.url).pathname;
						requests.push({
							path,
							admin: request.headers.get("Admin-Access-Token"),
							authorization: request.headers.get("Authorization"),
						});
						if (path === "/api/entity-watches/ws") {
							return server.upgrade(request, { data: undefined })
								? undefined
								: new Response(null, { status: 400 });
						}
						if (path === "/api/entity-watches/socket-ticket") {
							return Response.json({
								ticket: label,
								expiresAt: "2026-10-24T00:00:00.000Z",
							} satisfies ContractSuccess<"entity-watches", "createSocketTicket">);
						}
						if (path === "/api/uploads/intents") {
							return Response.json({
								headers: {},
								method: "PUT",
								intentId: label,
								uploadUrl: `raw-upload/${label}`,
								expiresAt: "2026-10-24T00:00:00.000Z",
							} satisfies ContractSuccess<"uploads", "createIntent">);
						}
						if (path === `/api/uploads/intents/${label}/complete`) {
							return Response.json({
								token: label,
								expiresAt: "2026-10-24T00:00:00.000Z",
							} satisfies ContractSuccess<"uploads", "completeIntent">);
						}
						if (path === `/api/raw-upload/${label}`) {
							return new Response(null, { status: 204 });
						}
						if (path === `/api/backups/runs/${label}/download-url`) {
							return Response.json({ url: `/raw-download/${label}` } satisfies ContractSuccess<
								"backups",
								"createDownloadTicket"
							>);
						}
						if (path === `/api/raw-download/${label}`) {
							return new Response(label, {
								headers: {
									"content-type": "application/zip",
									"content-disposition": "attachment; filename=backup.zip",
								},
							});
						}
						if (path === `/api/test-support/system-plugins/${label}/activation`) {
							return request.headers.get("Admin-Access-Token") === `admin-${label}`
								? Response.json({ pluginId: PluginId.make(label) } satisfies ContractSuccess<
										"testSupport",
										"uninstallSystemPlugin"
									>)
								: new Response(null, { status: 403 });
						}
						return new Response(null, { status: 404 });
					},
				}),
			),
			(server) => Effect.promise(() => server.stop(true)),
		);
		const target = makeHarnessTarget({
			adminAccessToken: `admin-${label}`,
			frontendUrl: `https://frontend-${label}.example`,
			apiUrl: `http://127.0.0.1:${httpServer.port}/api`,
		});
		return { target, sockets, requests };
	});

const installedPlugin = (
	target: ReturnType<typeof makeHarnessTarget>,
	label: string,
): InstalledTestPlugin => ({
	target,
	files: {},
	slug: label,
	active: true,
	scriptIds: {},
	scope: "system",
	pluginSlug: label,
	contentHash: label,
	installationId: null,
	configRevisionId: null,
	activationId: "activation",
	pluginId: PluginId.make(label),
	scriptId: SandboxScriptId.make(label),
	manifest: testPluginManifest({ pluginSlug: label }),
	activePluginRevisionId: PluginRevisionId.make(label),
});

describe("harness target ownership", () => {
	it("captures process configuration without coupling API and frontend origins", () => {
		const env = {
			PORT: "3001",
			SERVER_ADMIN_ACCESS_TOKEN: "admin-a",
			FRONTEND_URL: "https://frontend.example",
		};
		const target = apiProcessTarget(env, 123);
		env.PORT = "3002";
		env.SERVER_ADMIN_ACCESS_TOKEN = "admin-b";
		expect(target).toEqual({
			serverPid: 123,
			serverLogFile: undefined,
			adminAccessToken: "admin-a",
			apiUrl: "http://127.0.0.1:3001/api",
			frontendUrl: "https://frontend.example",
		});
		expect(Object.isFrozen(target)).toBe(true);
		expect(() => apiProcessTarget({ PORT: "3001" })).toThrow();
	});

	it.live(
		"keeps simultaneous uploads, downloads, sockets and strict cleanup on their session targets",
		() =>
			Effect.gen(function* () {
				const [a, b] = yield* Effect.all([recordingTarget("a"), recordingTarget("b")], {
					concurrency: "unbounded",
				});
				const input = { ...a.target };
				const headers = { Authorization: "Bearer user-a" };
				const clients = [
					makeSession(input, headers),
					makeSession(b.target, { Authorization: "Bearer user-b" }),
				];
				input.apiUrl = b.target.apiUrl;
				input.adminAccessToken = b.target.adminAccessToken;
				headers.Authorization = "Bearer user-b";
				const resources = makeTestResourceScope();
				yield* Effect.addFinalizer(() => resources.close);
				const results = yield* resources.run(
					Effect.forEach(
						clients,
						(client, index) =>
							Effect.gen(function* () {
								const label = index === 0 ? "a" : "b";
								const installed = installedPlugin(client.target, label);
								yield* Effect.addFinalizer(() =>
									uninstallTestPluginStrict(installed).pipe(Effect.orDie),
								);
								const archive = yield* uploadTemporaryArchive(client, new Uint8Array([1, 2]), {
									fileName: "plugin.zip",
								});
								const imported = yield* uploadImportFile(
									client,
									"fixture",
									"fixture.csv",
									"text/csv",
								);
								const download = yield* downloadBackupArchive(client, label);
								const socket = yield* openInterestWebSocketScoped({ client });
								return {
									archive,
									imported,
									sessionId: socket.ready.sessionId,
									download: new TextDecoder().decode(download.bytes),
								};
							}),
						{ concurrency: "unbounded" },
					),
				);
				expect(results).toEqual([
					{ archive: "a", imported: "a", download: "a", sessionId: "a" },
					{ archive: "b", imported: "b", download: "b", sessionId: "b" },
				]);
				yield* resources.close;
				yield* resources.close;
				for (const [server, label] of [
					[a, "a"],
					[b, "b"],
				] as const) {
					expect(server.requests.filter(({ path }) => path.includes("/system-plugins/"))).toEqual([
						{
							authorization: null,
							admin: `admin-${label}`,
							path: `/api/test-support/system-plugins/${label}/activation`,
						},
					]);
					expect(
						server.requests
							.filter(({ path }) => path === "/api/uploads/intents")
							.map(({ authorization }) => authorization),
					).toEqual([`Bearer user-${label}`, `Bearer user-${label}`]);
					expect(server.sockets).toEqual([`authenticated:${label}`, `closed:${label}`]);
				}
			}),
	);

	it.live("uses the source for a backup download and the destination for its archive upload", () =>
		Effect.gen(function* () {
			const source = yield* recordingTarget("source");
			const destination = yield* recordingTarget("destination");
			const archive = yield* downloadBackupArchive(makeSession(source.target), "source");
			expect(new TextDecoder().decode(archive.bytes)).toBe("source");
			expect(
				yield* uploadTemporaryArchive(makeSession(destination.target), archive.bytes, {
					fileName: "backup.zip",
				}),
			).toBe("destination");
			expect(source.requests.map(({ path }) => path)).toEqual([
				"/api/backups/runs/source/download-url",
				"/api/raw-download/source",
			]);
			expect(destination.requests.map(({ path }) => path)).toEqual([
				"/api/uploads/intents",
				"/api/raw-upload/destination",
				"/api/uploads/intents/destination/complete",
			]);
		}),
	);
});
