import type { ContractSuccess } from "@ryot-app/contract/client";
import { ServerLogsFailure, ServerLogsNotFound } from "@ryot-app/contract/modules/god-mode/logs";
import { Context, DateTime, Effect, FileSystem, Layer, Option, Path, Stream } from "effect";
import { Base64Url } from "effect/encoding";
import { Zip, ZipDeflate, ZipPassThrough } from "fflate";

import { AppConfig } from "#lib/infrastructure/config/service";
import { DownloadTickets } from "#lib/infrastructure/download-tickets";
import { roleLogPath } from "#lib/infrastructure/server-role";

type LogFile = ContractSuccess<"serverLogs", "list">["files"][number];

const unavailable = () => new ServerLogsNotFound({ reason: { code: "log-file-unavailable" } });
const failed = () => new ServerLogsFailure({ reason: { code: "log-read-failed" } });
const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const fileId = (name: string, stat: FileSystem.File.Info) =>
	Base64Url.encode(new TextEncoder().encode(`${name}\0${stat.dev}\0${Option.getOrNull(stat.ino)}`));

export const makeServerLogs = Effect.fn("makeServerLogs")(function* (logPath: string) {
	const fs = yield* FileSystem.FileSystem;
	const path = yield* Path.Path;
	const configuredDirectory = path.dirname(path.resolve(logPath));
	const directory = yield* fs.realPath(configuredDirectory).pipe(
		Effect.catchIf(
			(error) => error.reason._tag === "NotFound",
			() => Effect.succeed(configuredDirectory),
		),
		Effect.mapError(failed),
	);
	const activeNames = (["all", "interactive", "background"] as const).map((role) =>
		path.basename(roleLogPath(path, logPath, role)),
	);
	const isActive = (name: string) => activeNames.includes(name);
	const rotatedName = new RegExp(
		`^\\d{8}-\\d{4}-\\d{2,3}-(?:${activeNames.map(escapeRegExp).join("|")})\\.gz$`,
	);
	const compareNames = (a: string, b: string) =>
		Number(isActive(b)) - Number(isActive(a)) || b.localeCompare(a);
	const logNames = Effect.fn("ServerLogs.logNames")(function* () {
		const names = yield* fs.readDirectory(directory).pipe(
			Effect.catchIf(
				(error) => error.reason._tag === "NotFound",
				() => Effect.succeed([]),
			),
			Effect.mapError(failed),
		);
		return names.filter((name) => isActive(name) || rotatedName.test(name)).sort(compareNames);
	});
	const readLogFile = (name: string) =>
		Effect.gen(function* () {
			const filePath = path.join(directory, name);
			const resolved = yield* fs.realPath(filePath).pipe(
				Effect.catchIf(
					(error) => error.reason._tag === "NotFound",
					() => Effect.void,
				),
			);
			if (resolved === undefined || resolved !== filePath) {
				return undefined;
			}
			const stat = yield* fs.stat(filePath).pipe(
				Effect.catchIf(
					(error) => error.reason._tag === "NotFound",
					() => Effect.void,
				),
			);
			if (stat?.type !== "File" || Option.isNone(stat.ino) || Option.isNone(stat.mtime)) {
				return undefined;
			}
			return {
				name,
				id: fileId(name, stat),
				active: isActive(name),
				size: Number(stat.size),
				modifiedAt: stat.mtime.value.toISOString(),
			};
		}).pipe(Effect.mapError(failed));
	const listAllFiles = Effect.fn("ServerLogs.listAllFiles")(function* () {
		const names = yield* logNames();
		const files = yield* Effect.forEach(names, readLogFile);
		return files.filter((file) => file !== undefined);
	});
	const list = Effect.fn("ServerLogs.list")(function* (after: string | undefined, limit: number) {
		const names = yield* logNames();
		const candidates =
			after === undefined ? names : names.filter((name) => compareNames(after, name) < 0);
		const files: LogFile[] = [];
		let index = 0;
		while (index < candidates.length && files.length <= limit) {
			const name = candidates[index];
			index += 1;
			if (name === undefined) {
				continue;
			}
			const file = yield* readLogFile(name);
			if (file !== undefined) {
				files.push(file);
			}
		}
		const hasMore = files.length > limit;
		const pageFiles = hasMore ? files.slice(0, limit) : files;
		return {
			files: pageFiles,
			pageInfo: { limit, hasMore, nextCursor: hasMore ? (pageFiles.at(-1)?.name ?? null) : null },
		};
	});
	const snapshot = Effect.fn("ServerLogs.snapshot")(function* (file: LogFile) {
		const filePath = path.join(directory, file.name);
		const resolved = yield* fs.realPath(filePath).pipe(Effect.mapError(unavailable));
		if (resolved !== filePath) {
			return yield* unavailable();
		}
		const handle = yield* fs
			.open(filePath)
			.pipe(
				Effect.mapError((error) => (error.reason._tag === "NotFound" ? unavailable() : failed())),
			);
		const stat = yield* handle.stat.pipe(Effect.mapError(failed));
		if (stat.type !== "File" || Option.isNone(stat.ino) || fileId(file.name, stat) !== file.id) {
			return yield* unavailable();
		}
		const size = Number(stat.size);
		const stream = Stream.unfold(0, (position) =>
			Effect.gen(function* () {
				if (position === size) {
					return undefined;
				}
				yield* handle.seek(BigInt(position), "start").pipe(Effect.mapError(failed));
				const chunk = yield* handle
					.readAlloc(Math.min(64 * 1024, size - position))
					.pipe(Effect.mapError(failed));
				if (Option.isNone(chunk) || chunk.value.byteLength === 0) {
					return yield* unavailable();
				}
				return [chunk.value, position + chunk.value.byteLength] as const;
			}),
		);
		return { size, stream, fileName: file.name };
	});
	const downloadFile = Effect.fn("ServerLogs.downloadFile")(function* (id: string) {
		const files = yield* listAllFiles();
		const file = files.find((f) => f.id === id);
		if (file === undefined) {
			return yield* unavailable();
		}
		return yield* snapshot(file);
	});
	const assertFileAvailable = Effect.fn("ServerLogs.assertFileAvailable")(function* (id: string) {
		const files = yield* listAllFiles();
		if (!files.some((file) => file.id === id)) {
			return yield* unavailable();
		}
		return yield* Effect.void;
	});
	const downloadAll = Effect.fn("ServerLogs.downloadAll")(function* () {
		const now = yield* DateTime.now;
		const files = yield* listAllFiles();
		const snapshots = yield* Effect.forEach(files, snapshot);
		const stream = Stream.unwrap(
			Effect.gen(function* () {
				const output: Uint8Array[] = [];
				let failure: Error | null = null;
				const zip = yield* Effect.acquireRelease(
					Effect.sync(
						() =>
							new Zip((error, chunk) => {
								if (error !== null) {
									failure = error;
								} else {
									output.push(chunk);
								}
							}),
					),
					(writer) => Effect.sync(() => writer.terminate()),
				);
				const drain = () => {
					if (failure !== null) {
						throw failed();
					}
					return output.splice(0);
				};
				const entries = snapshots.map((entry) =>
					Stream.unwrap(
						Effect.sync(() => {
							const file = entry.fileName.endsWith(".gz")
								? new ZipPassThrough(entry.fileName)
								: new ZipDeflate(entry.fileName);
							zip.add(file);
							return entry.stream.pipe(
								Stream.mapEffect((chunk) =>
									Effect.try({
										catch: failed,
										try: () => {
											file.push(chunk);
											return drain();
										},
									}),
								),
								Stream.flatMap(Stream.fromIterable),
								Stream.concat(
									Stream.fromEffect(
										Effect.try({
											catch: failed,
											try: () => {
												file.push(new Uint8Array(), true);
												return drain();
											},
										}),
									).pipe(Stream.flatMap(Stream.fromIterable)),
								),
							);
						}),
					),
				);
				return Stream.fromIterable(entries).pipe(
					Stream.flatMap((entry) => entry),
					Stream.concat(
						Stream.fromEffect(
							Effect.try({
								catch: failed,
								try: () => {
									zip.end();
									return drain();
								},
							}),
						).pipe(Stream.flatMap(Stream.fromIterable)),
					),
				);
			}),
		);
		return {
			stream,
			fileName: `ryot-server-logs-${DateTime.formatIso(now).replaceAll(":", "-")}.zip`,
		};
	});
	return { list, downloadAll, downloadFile, assertFileAvailable };
});

export class ServerLogs extends Context.Service<ServerLogs>()("ServerLogs", {
	make: Effect.gen(function* () {
		const config = yield* AppConfig;
		const tickets = yield* DownloadTickets;
		const logs = yield* makeServerLogs(config.observability.logging.file.path);
		const createFileDownloadTicket = Effect.fn("ServerLogs.createFileDownloadTicket")(function* (
			id: string,
		) {
			yield* logs.assertFileAvailable(id);
			return yield* tickets.issue({ resource: id, subject: null, purpose: "server-log-file" });
		});
		const createAllDownloadTicket = Effect.fn("ServerLogs.createAllDownloadTicket")(() =>
			tickets.issue({ subject: null, resource: "all", purpose: "server-logs-all" }),
		);
		const downloadFileWithTicket = Effect.fn("ServerLogs.downloadFileWithTicket")(function* (
			id: string,
			ticket: string,
		) {
			yield* tickets
				.verify(ticket, { resource: id, purpose: "server-log-file" })
				.pipe(Effect.catchTag("DownloadTicketInvalid", () => Effect.fail(unavailable())));
			return yield* logs.downloadFile(id);
		});
		const downloadAllWithTicket = Effect.fn("ServerLogs.downloadAllWithTicket")(function* (
			ticket: string,
		) {
			yield* tickets
				.verify(ticket, { resource: "all", purpose: "server-logs-all" })
				.pipe(Effect.catchTag("DownloadTicketInvalid", () => Effect.fail(unavailable())));
			return yield* logs.downloadAll();
		});
		return {
			list: logs.list,
			downloadAllWithTicket,
			downloadFileWithTicket,
			createAllDownloadTicket,
			createFileDownloadTicket,
		};
	}),
}) {
	static readonly layer = Layer.effect(this, this.make);
}
