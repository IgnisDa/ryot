import type { DownloadFileOptions } from "@capacitor/file-transfer";
import { describe, expect, it } from "@effect/vitest";
import { Deferred, Effect, Exit, Fiber } from "effect";

import {
	FileDownloadError,
	makeNativeFileDownload,
	type FileDownloadRequest,
} from "#/modules/downloads/file";

type NativeCalls = {
	readonly sequence: Array<string>;
	readonly created: Array<string>;
	readonly uriPaths: Array<string>;
	readonly transfers: Array<DownloadFileOptions>;
	readonly shared: Array<string>;
	readonly removed: Array<string>;
};

const makeCalls = (): NativeCalls => ({
	shared: [],
	created: [],
	removed: [],
	sequence: [],
	uriPaths: [],
	transfers: [],
});

const makePorts = (
	calls: NativeCalls,
	overrides: Partial<Parameters<typeof makeNativeFileDownload>[0]> = {},
) => ({
	share: (uri: string) => {
		calls.sequence.push("share");
		calls.shared.push(uri);
		return overrides.share?.(uri) ?? Effect.void;
	},
	create: (path: string) => {
		calls.sequence.push("create");
		calls.created.push(path);
		return overrides.create?.(path) ?? Effect.void;
	},
	remove: (path: string) => {
		calls.sequence.push("remove");
		calls.removed.push(path);
		return overrides.remove?.(path) ?? Effect.void;
	},
	uri: (path: string) => {
		calls.sequence.push("uri");
		calls.uriPaths.push(path);
		return overrides.uri?.(path) ?? Effect.succeed(`native://${path}`);
	},
	transfer: (options: DownloadFileOptions) => {
		calls.sequence.push("transfer");
		calls.transfers.push(options);
		return overrides.transfer?.(options) ?? Effect.void;
	},
});

const request = {
	fileName: "server.log",
	url: "https://logs.example/server.log",
} satisfies FileDownloadRequest;

describe("native file downloads", () => {
	it.live("creates, transfers, shares, and removes a temporary file in order", () =>
		Effect.gen(function* () {
			const calls = makeCalls();
			yield* makeNativeFileDownload(makePorts(calls))(request);

			expect(calls.sequence).toEqual(["create", "uri", "transfer", "share", "remove"]);
			expect(calls.created).toHaveLength(1);
			const [directory] = calls.created;
			expect(directory).toMatch(/^ryot-download-/);
			expect(calls.uriPaths).toEqual([`${directory}/server.log`]);
			expect(calls.transfers).toEqual([
				{ url: request.url, disableRedirects: true, path: `native://${directory}/server.log` },
			]);
			expect(calls.shared).toEqual([`native://${directory}/server.log`]);
			expect(calls.removed).toEqual([directory]);
		}),
	);

	it.live("sanitizes slashes without changing the file name", () =>
		Effect.gen(function* () {
			const calls = makeCalls();
			yield* makeNativeFileDownload(makePorts(calls))({
				...request,
				fileName: "logs\\rotated/server.log",
			});

			const [directory] = calls.created;
			expect(calls.uriPaths).toEqual([`${directory}/logs_rotated_server.log`]);
			expect(calls.transfers[0]?.path).toBe(`native://${directory}/logs_rotated_server.log`);
		}),
	);

	it.live("cleans up after a transfer failure without sharing", () =>
		Effect.gen(function* () {
			const calls = makeCalls();
			const failure = new FileDownloadError({ cause: "transfer failed" });
			const result = yield* Effect.exit(
				makeNativeFileDownload(makePorts(calls, { transfer: () => Effect.fail(failure) }))(request),
			);

			expect(Exit.isFailure(result)).toBe(true);
			expect(calls.sequence).toEqual(["create", "uri", "transfer", "remove"]);
			expect(calls.shared).toEqual([]);
			expect(calls.removed).toEqual(calls.created);
		}),
	);

	it.live("cleans up after a URI failure", () =>
		Effect.gen(function* () {
			const calls = makeCalls();
			const result = yield* Effect.exit(
				makeNativeFileDownload(
					makePorts(calls, {
						uri: () => Effect.fail(new FileDownloadError({ cause: "URI failed" })),
					}),
				)(request),
			);

			expect(Exit.isFailure(result)).toBe(true);
			expect(calls.sequence).toEqual(["create", "uri", "remove"]);
			expect(calls.removed).toEqual(calls.created);
		}),
	);

	it.live("cleans up after a share failure", () =>
		Effect.gen(function* () {
			const calls = makeCalls();
			const result = yield* Effect.exit(
				makeNativeFileDownload(
					makePorts(calls, {
						share: () => Effect.fail(new FileDownloadError({ cause: "share failed" })),
					}),
				)(request),
			);

			expect(Exit.isFailure(result)).toBe(true);
			expect(calls.sequence).toEqual(["create", "uri", "transfer", "share", "remove"]);
			expect(calls.removed).toEqual(calls.created);
		}),
	);

	it.live("treats a dismissed share sheet as cancellation and cleans up", () =>
		Effect.gen(function* () {
			const calls = makeCalls();
			yield* makeNativeFileDownload(
				makePorts(calls, {
					share: () => Effect.fail(new FileDownloadError({ cause: { message: "Share canceled" } })),
				}),
			)(request);
			expect(calls.sequence).toEqual(["create", "uri", "transfer", "share", "remove"]);
			expect(calls.removed).toEqual(calls.created);
		}),
	);

	it.live("does not remove a directory when creation fails", () =>
		Effect.gen(function* () {
			const calls = makeCalls();
			const result = yield* Effect.exit(
				makeNativeFileDownload(
					makePorts(calls, {
						create: () => Effect.fail(new FileDownloadError({ cause: "create failed" })),
					}),
				)(request),
			);

			expect(Exit.isFailure(result)).toBe(true);
			expect(calls.sequence).toEqual(["create"]);
			expect(calls.removed).toEqual([]);
		}),
	);

	it.live("waits for a pending native transfer before cleanup after interruption", () =>
		Effect.gen(function* () {
			const calls = makeCalls();
			const started = yield* Deferred.make<void>();
			const release = yield* Deferred.make<void>();
			const download = makeNativeFileDownload(
				makePorts(calls, {
					transfer: () =>
						Effect.gen(function* () {
							yield* Deferred.succeed(started, undefined);
							yield* Deferred.await(release);
						}),
				}),
			);
			const pending = yield* Effect.forkChild(download(request), { startImmediately: true });
			yield* Deferred.await(started);
			const interruption = yield* Effect.forkChild(Fiber.interrupt(pending), {
				startImmediately: true,
			});

			expect(calls.sequence).toEqual(["create", "uri", "transfer"]);
			expect(calls.removed).toEqual([]);
			yield* Deferred.succeed(release, undefined);
			yield* Fiber.join(interruption);

			expect(calls.sequence).toEqual(["create", "uri", "transfer", "remove"]);
			expect(calls.shared).toEqual([]);
			expect(calls.removed).toEqual(calls.created);
		}),
	);
});
