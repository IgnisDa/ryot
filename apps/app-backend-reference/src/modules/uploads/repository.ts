import { and, eq } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";

import { DbService, dbEffect, schema } from "../../lib/db";
import type { DbError } from "../../lib/errors";
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

export class UploadsRepository extends Context.Tag("UploadsRepository")<
	UploadsRepository,
	{
		readonly createMany: (
			files: ReadonlyArray<UploadInsert>,
		) => Effect.Effect<ReadonlyArray<UploadedFile>, DbError>;
		readonly getOwnedById: (
			userId: string,
			uploadId: string,
		) => Effect.Effect<StoredUpload, DbError | UploadNotFound>;
	}
>() {}

export const UploadsRepositoryLive = Layer.effect(
	UploadsRepository,
	Effect.gen(function* () {
		const { db } = yield* DbService;

		return {
			createMany: (files) =>
				files.length === 0
					? Effect.succeed([])
					: dbEffect(() =>
							db
								.insert(schema.upload)
								.values([...files])
								.returning(),
						).pipe(Effect.map((rows) => rows.map(mapUploadedFile))),
			getOwnedById: (userId, uploadId) =>
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
);
