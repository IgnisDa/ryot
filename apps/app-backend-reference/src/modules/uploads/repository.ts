import { and, eq } from "drizzle-orm";
import { Effect } from "effect";

import { DbService, dbEffect, schema } from "../../lib/db";
import { UploadNotFound } from "../../lib/errors";
import type { UploadedFile } from "./schemas";

type UploadRow = typeof schema.upload.$inferSelect;
type UploadInsert = typeof schema.upload.$inferInsert;

export type StoredUpload = {
	readonly id: string;
	readonly size: number;
	readonly userId: string;
	readonly contents: string;
	readonly fileName: string;
	readonly contentType: string;
	readonly createdAt: string;
};

const mapStoredUpload = (row: UploadRow): StoredUpload => ({
	id: row.id,
	size: row.size,
	userId: row.userId,
	contents: row.contents,
	fileName: row.fileName,
	contentType: row.contentType,
	createdAt: row.createdAt.toISOString(),
});

const mapUploadedFile = (row: UploadRow): UploadedFile => ({
	id: row.id,
	size: row.size,
	fileName: row.fileName,
	contentType: row.contentType,
	createdAt: row.createdAt.toISOString(),
});

export class UploadsRepository extends Effect.Service<UploadsRepository>()("UploadsRepository", {
	effect: Effect.gen(function* () {
		const { db } = yield* DbService;

		return {
			createMany: (files: ReadonlyArray<UploadInsert>) =>
				files.length === 0
					? Effect.succeed([])
					: dbEffect(() =>
							db
								.insert(schema.upload)
								.values([...files])
								.returning(),
						).pipe(Effect.map((rows) => rows.map(mapUploadedFile))),
			getOwnedById: (userId: string, uploadId: string) =>
				dbEffect(() =>
					db
						.select()
						.from(schema.upload)
						.where(and(eq(schema.upload.id, uploadId), eq(schema.upload.userId, userId)))
						.limit(1),
				).pipe(
					Effect.flatMap(([row]) =>
						row
							? Effect.succeed(mapStoredUpload(row))
							: Effect.fail(new UploadNotFound({ id: uploadId })),
					),
				),
		};
	}),
}) {}
