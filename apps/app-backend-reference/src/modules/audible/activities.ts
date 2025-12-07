import { Activity } from "@effect/workflow";
import { Effect, Schema } from "effect";

import { AudibleRunError } from "../../lib/errors";
import { UploadsRepository } from "../uploads/repository";

const parseQueries = (content: string) =>
	content
		.split(/\r?\n/u)
		.map((line) => line.trim())
		.filter(Boolean);

export const ReadUploadedQueries = (input: {
	readonly uploadId: string;
	readonly userId: string;
}) =>
	Activity.make({
		name: "ReadUploadedQueries",
		success: Schema.Array(Schema.String),
		error: AudibleRunError,
		execute: Effect.gen(function* () {
			const uploads = yield* UploadsRepository;
			const upload = yield* uploads
				.getOwnedById(input.userId, input.uploadId)
				.pipe(
					Effect.mapError(
						(error) => new AudibleRunError({ message: `Could not load upload: ${error.message}` }),
					),
				);

			const queries = parseQueries(upload.contents);
			if (queries.length === 0) {
				return yield* new AudibleRunError({
					message: "Uploaded query file must contain at least one non-empty line",
				});
			}

			return queries;
		}),
	}).pipe(Activity.retry({ times: 2 }));
