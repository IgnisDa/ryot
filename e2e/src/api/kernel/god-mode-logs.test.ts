import { gunzipSync } from "node:zlib";

import { Effect } from "effect";
import { unzipSync } from "fflate";

import {
	adminAccessTokenHeaders,
	adminHeaders,
	getApiClient,
	seedServerLog,
} from "~/fixtures/kernel";
import { assertTaggedError } from "~/support/assertions";
import { assert, describe, expect, it } from "~/support/effect-test";
import { getApiUrl } from "~/support/harness-target";
import { webRequest } from "~/support/web-request";

const WRONG_TOKEN = "wrong-token";

const isExcludedLogName = (name: string) =>
	name.endsWith(".stdout") || name.endsWith(".stderr") || name.endsWith(".txt");

const downloadFileUrl = (id: string) =>
	getApiClient()
		.call((api) => api.serverLogs.createFileDownloadTicket({ params: { id } }), adminHeaders())
		.pipe(Effect.map((ticket) => `${getApiUrl()}${ticket.url}`));

describe("Server log API", () => {
	it.live("requires the admin token for listing and download ticket creation", () =>
		Effect.gen(function* () {
			for (const headers of [{}, adminAccessTokenHeaders(WRONG_TOKEN)]) {
				const list = yield* webRequest(`${getApiUrl()}/god-mode/logs/files?limit=25`, { headers });
				const fileTicket = yield* webRequest(
					`${getApiUrl()}/god-mode/logs/files/missing/download-url`,
					{ headers, method: "POST" },
				);
				const allTicket = yield* webRequest(`${getApiUrl()}/god-mode/logs/download-url`, {
					headers,
					method: "POST",
				});
				expect(list.status).toBe(401);
				expect(fileTicket.status).toBe(401);
				expect(allTicket.status).toBe(401);
			}
		}),
	);

	it.live("lists and downloads active and retained logs", () =>
		Effect.gen(function* () {
			const seeded = yield* seedServerLog();
			const firstPage = yield* getApiClient().call(
				(api) => api.serverLogs.list({ query: { limit: 1 } }),
				adminHeaders(),
			);
			const nextCursor = firstPage.pageInfo.nextCursor;
			assert(nextCursor);
			expect(firstPage.pageInfo).toEqual({
				limit: 1,
				hasMore: true,
				nextCursor: firstPage.files[0]?.name,
			});
			const secondPage = yield* getApiClient().call(
				(api) => api.serverLogs.list({ query: { limit: 100, after: nextCursor } }),
				adminHeaders(),
			);
			const files = [...firstPage.files, ...secondPage.files];
			const active = files.find((file) => file.name === seeded.activeName);
			const retained = files.find((file) => file.name === seeded.name);
			assert(active);
			assert(retained);

			expect(active).toMatchObject({ active: true, name: seeded.activeName });
			expect(retained).toMatchObject({
				active: false,
				name: seeded.name,
				size: seeded.bytes.byteLength,
			});
			expect(files.some((file) => isExcludedLogName(file.name))).toBe(false);

			const retainedResponse = yield* webRequest(yield* downloadFileUrl(retained.id));
			const retainedBytes = Buffer.from(
				yield* Effect.promise(() => retainedResponse.arrayBuffer()),
			);
			expect(retainedResponse.status).toBe(200);
			expect(retainedResponse.headers.get("content-type")).toBe("application/gzip");
			expect(retainedResponse.headers.get("content-disposition")).toContain(
				`filename="${seeded.name}"`,
			);
			expect(retainedResponse.headers.get("cache-control")).toBe("no-store");
			expect(retainedBytes).toEqual(seeded.bytes);

			const activeResponse = yield* webRequest(yield* downloadFileUrl(active.id));
			yield* Effect.promise(() => activeResponse.arrayBuffer());
			expect(activeResponse.status).toBe(200);
			expect(activeResponse.headers.get("content-type")).toBe("text/plain; charset=utf-8");
			expect(activeResponse.headers.get("content-disposition")).toContain(
				`filename="${seeded.activeName}"`,
			);

			const allTicket = yield* getApiClient().call(
				(api) => api.serverLogs.createAllDownloadTicket(),
				adminHeaders(),
			);
			const allResponse = yield* webRequest(`${getApiUrl()}${allTicket.url}`);
			expect(allResponse.status).toBe(200);
			expect(allResponse.headers.get("content-type")).toBe("application/zip");
			expect(allResponse.headers.get("cache-control")).toBe("no-store");
			expect(allResponse.headers.get("content-disposition")).toMatch(
				/^attachment; filename="ryot-server-logs-.+\.zip"; filename\*=UTF-8''ryot-server-logs-.+\.zip$/,
			);
			const archive = unzipSync(
				Buffer.from(yield* Effect.promise(() => allResponse.arrayBuffer())),
			);
			const archivedActive = archive[seeded.activeName];
			const archivedRetained = archive[seeded.name];
			assert(archivedActive);
			assert(archivedRetained);
			expect(Buffer.from(archivedRetained)).toEqual(seeded.bytes);
			expect(gunzipSync(archivedRetained).toString("utf8")).toBe(seeded.text);
			expect(Object.keys(archive).some(isExcludedLogName)).toBe(false);
		}),
	);

	it.live("returns the typed not-found error for an unavailable file id", () =>
		Effect.gen(function* () {
			const error = yield* Effect.flip(
				getApiClient().call(
					(api) =>
						api.serverLogs.createFileDownloadTicket({
							params: { id: `missing-${crypto.randomUUID()}` },
						}),
					adminHeaders(),
				),
			);
			assertTaggedError(error, "ServerLogsNotFound");
			expect(error.reason.code).toBe("log-file-unavailable");
		}),
	);
});
