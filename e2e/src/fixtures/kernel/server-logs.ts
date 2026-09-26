import { gzipSync } from "node:zlib";

import { Effect, FileSystem, Path } from "effect";

import { getServerLogFile } from "~/support/harness-target";

export const seedServerLog = Effect.fn("seedServerLog")(function* () {
	const fs = yield* FileSystem.FileSystem;
	const path = yield* Path.Path;
	const activePath = getServerLogFile();
	const activeName = path.basename(activePath);
	const text = `retained-e2e-log-${crypto.randomUUID()}\n`;
	const bytes = gzipSync(text);
	for (let index = 500; index < 1000; index += 1) {
		const name = `20000101-0000-${index}-${activeName}.gz`;
		const filePath = path.join(path.dirname(activePath), name);
		const created = yield* Effect.acquireRelease(
			fs.writeFile(filePath, bytes, { flag: "wx" }).pipe(
				Effect.as(true),
				Effect.catchIf(
					(error) => error.reason._tag === "AlreadyExists",
					() => Effect.succeed(false),
				),
			),
			(wasCreated) => (wasCreated ? fs.remove(filePath).pipe(Effect.orDie) : Effect.void),
		);
		if (created) {
			return { name, text, bytes, activeName };
		}
	}
	throw new Error("No unused retained log filename is available");
});
