import { DbError } from "@ryot-app/contract/errors";
import { ClientArtifact } from "@ryot-app/plugin-client-contract";
import { stableStringify } from "@ryot-app/ts-utils/json";
import { eq, and, asc } from "drizzle-orm";
import { Context, Effect, Layer, Schema } from "effect";

import { DatabaseSession } from "#platform/db/session";
import { clientArtifact, clientArtifactFile } from "#schema/tables/client-artifacts";

type ArtifactRow = typeof clientArtifact.$inferSelect;
type FileRow = typeof clientArtifactFile.$inferSelect;

const bytesEqual = (left: Uint8Array, right: Uint8Array) =>
	left.byteLength === right.byteLength && left.every((byte, index) => byte === right[index]);

export const clientArtifactMatches = (
	artifact: ClientArtifact,
	metadata: ArtifactRow,
	files: ReadonlyArray<FileRow>,
) =>
	metadata.hash === artifact.hash &&
	metadata.packageId === ("packageId" in artifact ? artifact.packageId : null) &&
	metadata.clientDeclarationHash ===
		("clientDeclarationHash" in artifact ? artifact.clientDeclarationHash : null) &&
	stableStringify(metadata.imports) === stableStringify(artifact.imports) &&
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
		make: Effect.gen(function* () {
			const session = yield* DatabaseSession;
			return {
				findArtifactFile: Effect.fn("ClientArtifactsRepository.findArtifactFile")(function* (
					hash: string,
					name: string,
				) {
					const [row] = yield* session.run((db) =>
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
					const [metadata] = yield* session.run((db) =>
						db.select().from(clientArtifact).where(eq(clientArtifact.hash, hash)).limit(1),
					);
					if (!metadata) {
						return null;
					}
					const files = yield* session.run((db) =>
						db
							.select({
								name: clientArtifactFile.name,
								contentType: clientArtifactFile.contentType,
							})
							.from(clientArtifactFile)
							.where(eq(clientArtifactFile.artifactHash, hash))
							.orderBy(asc(clientArtifactFile.name)),
					);
					return { ...metadata, files };
				}),
				loadClientArtifact: Effect.fn("ClientArtifactsRepository.loadClientArtifact")(function* (
					hash: string,
				) {
					const [metadata] = yield* session.run((db) =>
						db.select().from(clientArtifact).where(eq(clientArtifact.hash, hash)).limit(1),
					);
					if (!metadata) {
						return yield* new DbError({ message: `Client artifact ${hash} is missing` });
					}
					const files = yield* session.run((db) =>
						db.select().from(clientArtifactFile).where(eq(clientArtifactFile.artifactHash, hash)),
					);
					const { packageId, clientDeclarationHash, ...versions } = metadata;
					const artifact = yield* Schema.decodeUnknownEffect(ClientArtifact)({
						...versions,
						...(packageId === null ? {} : { packageId, clientDeclarationHash }),
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
					function* (artifact: ClientArtifact) {
						const [inserted] = yield* session.run((db) =>
							db
								.insert(clientArtifact)
								.values({
									hash: artifact.hash,
									format: artifact.format,
									imports: artifact.imports,
									apiVersion: artifact.apiVersion,
									bridgeVersion: artifact.bridgeVersion,
									compilerVersion: artifact.compilerVersion,
									packageId: "packageId" in artifact ? artifact.packageId : null,
									clientDeclarationHash:
										"clientDeclarationHash" in artifact ? artifact.clientDeclarationHash : null,
								})
								.onConflictDoNothing()
								.returning({ hash: clientArtifact.hash }),
						);
						if (inserted) {
							if (artifact.files.length > 0) {
								yield* session.run((db) =>
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
						const [metadata] = yield* session.run((db) =>
							db
								.select()
								.from(clientArtifact)
								.where(eq(clientArtifact.hash, artifact.hash))
								.limit(1),
						);
						const files = yield* session.run((db) =>
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
			};
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
