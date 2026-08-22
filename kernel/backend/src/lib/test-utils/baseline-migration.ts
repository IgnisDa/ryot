import { DbError } from "@ryot-app/contract/errors";
import { Effect } from "effect";
import { assert } from "vitest";

export const baselineMigrationStatements = Effect.fnUntraced(function* () {
	const directory = new URL("../../drizzle/", import.meta.url).pathname;
	const paths = [...new Bun.Glob("*/migration.sql").scanSync({ cwd: directory })];
	assert(paths.length === 1);
	const ddl = yield* Effect.tryPromise({
		try: () => Bun.file(directory + paths[0]).text(),
		catch: () => new DbError({ message: "Cannot read generated baseline" }),
	});
	return ddl.split("--> statement-breakpoint");
});

export const applyBaselineMigration = Effect.fnUntraced(function* <A, E, R>(
	statements: readonly string[],
	execute: (statement: string) => Effect.Effect<A, E, R>,
) {
	for (const statement of statements) {
		yield* execute(statement);
	}
});
