import type { Multipart } from "@effect/platform";
import { FileSystem } from "@effect/platform";
import { Effect } from "effect";

import type { CurrentUserValue } from "../../lib/auth";
import type { DbError, ValidationError } from "../../lib/errors";
import { ValidationError as UploadValidationError } from "../../lib/errors";
import { UploadsRepository } from "./repository";
import type { UploadedFile } from "./schemas";

const isTextFile = (file: Multipart.PersistedFile) => file.name.toLowerCase().endsWith(".txt");

export class UploadsService extends Effect.Service<UploadsService>()("UploadsService", {
	effect: Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		const uploads = yield* UploadsRepository;

		const validateFiles = (files: ReadonlyArray<Multipart.PersistedFile>) => {
			if (files.length === 0) {
				return new UploadValidationError({ message: "Upload at least one .txt file" });
			}

			const invalidFile = files.find((file) => !isTextFile(file));
			return invalidFile
				? new UploadValidationError({
						message: `Only .txt uploads are supported, received ${invalidFile.name}`,
					})
				: null;
		};

		return {
			uploadTemporary: (
				user: CurrentUserValue,
				files: ReadonlyArray<Multipart.PersistedFile>,
			): Effect.Effect<ReadonlyArray<UploadedFile>, DbError | ValidationError> =>
				Effect.gen(function* () {
					const validationError = validateFiles(files);
					if (validationError) {
						return yield* validationError;
					}

					const fileData = yield* Effect.forEach(files, (file) =>
						Effect.gen(function* () {
							const [info, bytes] = yield* Effect.all([
								fs.stat(file.path).pipe(Effect.orDie),
								fs.readFile(file.path).pipe(Effect.orDie),
							]);

							return {
								size: Number(info.size),
								userId: user.id,
								contents: new TextDecoder().decode(bytes),
								fileName: file.name,
								contentType: file.contentType || "text/plain",
							};
						}),
					);

					return yield* uploads.createMany(fileData);
				}),
		};
	}),
}) {}
