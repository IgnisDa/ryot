import { expect, it } from "@effect/vitest";
import { Result, Schema } from "@ryot-app/plugin-kit/effect";

import { MediaUserDataInput } from "./media-user-data-operations";

const submission = { submissionId: "submission-1", submittedAt: "2026-10-27T09:00:00.000Z" };

it("does not accept genres or the media library as operation targets", () => {
	for (const entitySchemaSlug of ["genre", "media-library"]) {
		expect(
			Result.isFailure(
				Schema.decodeUnknownResult(MediaUserDataInput)({
					...submission,
					action: "remove",
					entitySchemaSlug,
					entityId: "media-1",
				}),
			),
		).toBe(true);
	}
});
