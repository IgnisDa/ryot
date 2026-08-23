import {
	PluginClientArtifact as PluginClientArtifactSchema,
	type PluginClientArtifact,
} from "@ryot-app/client-plugin-contract";
import { DbError } from "@ryot-app/contract/errors";
import { eq, and, asc } from "drizzle-orm";
import { Context, Effect, Layer, Schema } from "effect";

import {
	clientArtifact,
	clientArtifactFile,
} from "#lib/infrastructure/db/schema/tables/client-artifacts";
import { Database, mapDatabaseErrors } from "#lib/infrastructure/db/service";

type ArtifactRow = typeof clientArtifact.$inferSelect;
type FileRow = typeof clientArtifactFile.$inferSelect;

const bytesEqual = (left: Uint8Array, right: Uint8Array) =>
	left.byteLength === right.byteLength && left.every((byte, index) => byte === right[index]);

export const clientArtifactMatches = (
	artifact: PluginClientArtifact,
	metadata: ArtifactRow,
	files: ReadonlyArray<FileRow>,
) =>
	metadata.hash === artifact.hash &&
	metadata.format === artifact.format &&
	metadata.apiVersion === artifact.apiVersion &&
	metadata.bridgeVersion === artifact.bridgeVersion &&
	metadata.compilerVersion === artifact.compilerVersion &&
	files.length === artifact.files.length &&
	artifact.files.every((file) =>
		files.some(
			(stored) =>
				stored.name === file.name &&
				bytesEqual(stored.contents, file.contents) &&
				stored.contentType === file.contentType,
		),
	);

export class ClientArtifactsRepository extends Context.Service<ClientArtifactsRepository>()(
	"ClientArtifactsRepository",
	{
		make: Effect.succeed({
			findArtifactFile: Effect.fn("ClientArtifactsRepository.findArtifactFile")(function* (
				hash: string,
				name: string,
			) {
				const db = yield* Database;
				const [row] = yield* mapDatabaseErrors(
					db
						.select({
							contents: clientArtifactFile.contents,
							contentType: clientArtifactFile.contentType,
						})
						.from(clientArtifactFile)
						.where(
							and(eq(clientArtifactFile.artifactHash, hash), eq(clientArtifactFile.name, name)),
						)
						.limit(1),
				);
				return row
					? { contentType: row.contentType, contents: new Uint8Array(row.contents) }
					: null;
			}),
			describe: Effect.fn("ClientArtifactsRepository.describe")(function* (hash: string) {
				const db = yield* Database;
				const [metadata] = yield* mapDatabaseErrors(
					db.select().from(clientArtifact).where(eq(clientArtifact.hash, hash)).limit(1),
				);
				if (!metadata) {
					return null;
				}
				const files = yield* mapDatabaseErrors(
					db
						.select({ name: clientArtifactFile.name, contentType: clientArtifactFile.contentType })
						.from(clientArtifactFile)
						.where(eq(clientArtifactFile.artifactHash, hash))
						.orderBy(asc(clientArtifactFile.name)),
				);
				return { ...metadata, files };
			}),
			loadClientArtifact: Effect.fn("ClientArtifactsRepository.loadClientArtifact")(function* (
				hash: string,
			) {
				const db = yield* Database;
				const [metadata] = yield* mapDatabaseErrors(
					db.select().from(clientArtifact).where(eq(clientArtifact.hash, hash)).limit(1),
				);
				if (!metadata) {
					return yield* new DbError({ message: `Client artifact ${hash} is missing` });
				}
				const files = yield* mapDatabaseErrors(
					db.select().from(clientArtifactFile).where(eq(clientArtifactFile.artifactHash, hash)),
				);
				const artifact = yield* Schema.decodeUnknownEffect(PluginClientArtifactSchema)({
					...metadata,
					files: files.map(({ name, contents, contentType }) => ({
						name,
						contentType,
						contents: new Uint8Array(contents),
					})),
				}).pipe(
					Effect.mapError(() => new DbError({ message: `Client artifact ${hash} is invalid` })),
				);
				if (!clientArtifactMatches(artifact, metadata, files)) {
					return yield* new DbError({
						message: `Client artifact ${hash} conflicts with immutable stored data`,
					});
				}
				return artifact;
			}),
			persistClientArtifact: Effect.fn("ClientArtifactsRepository.persistClientArtifact")(
				function* (artifact: PluginClientArtifact) {
					const db = yield* Database;
					const [inserted] = yield* mapDatabaseErrors(
						db
							.insert(clientArtifact)
							.values({
								hash: artifact.hash,
								format: artifact.format,
								apiVersion: artifact.apiVersion,
								bridgeVersion: artifact.bridgeVersion,
								compilerVersion: artifact.compilerVersion,
							})
							.onConflictDoNothing()
							.returning({ hash: clientArtifact.hash }),
					);
					if (inserted) {
						if (artifact.files.length > 0) {
							yield* mapDatabaseErrors(
								db
									.insert(clientArtifactFile)
									.values(
										artifact.files.map((file) => ({
											...file,
											artifactHash: artifact.hash,
											contents: Buffer.from(file.contents),
										})),
									),
							);
						}
						return yield* Effect.void;
					}
					const [metadata] = yield* mapDatabaseErrors(
						db.select().from(clientArtifact).where(eq(clientArtifact.hash, artifact.hash)).limit(1),
					);
					const files = yield* mapDatabaseErrors(
						db
							.select()
							.from(clientArtifactFile)
							.where(eq(clientArtifactFile.artifactHash, artifact.hash)),
					);
					if (!metadata || !clientArtifactMatches(artifact, metadata, files)) {
						return yield* new DbError({
							message: `Client artifact ${artifact.hash} conflicts with immutable stored data`,
						});
					}
					return yield* Effect.void;
				},
			),
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
