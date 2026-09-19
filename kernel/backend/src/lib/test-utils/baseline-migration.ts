import { DbError } from "@ryot-app/contract/errors";
import { sortBy } from "@ryot-app/ts-utils/lodash";
import { Effect } from "effect";

export const baselineMigrationStatements = Effect.fnUntraced(function* () {
	const directory = new URL("../../drizzle/", import.meta.url).pathname;
	const paths = sortBy(
		[...new Bun.Glob("*/migration.sql").scanSync({ cwd: directory })],
		(path) => path,
	);
	const migrations = yield* Effect.tryPromise({
		catch: () => new DbError({ message: "Cannot read generated migrations" }),
		try: () => Promise.all(paths.map((path) => Bun.file(directory + path).text())),
	});
	return migrations.flatMap((ddl) => ddl.split("--> statement-breakpoint"));
});

export const applyBaselineMigration = Effect.fnUntraced(function* <A, E, R>(
	statements: readonly string[],
	execute: (statement: string) => Effect.Effect<A, E, R>,
) {
	for (const statement of statements) {
		yield* execute(statement);
	}
});
