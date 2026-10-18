import { Schema } from "@ryot-app/plugin-kit/effect";

import { mediaSubmissionFields } from "./media-activity-operations";
import { mediaLibraryMemberEntitySchemaSlugs } from "./media-schema-slugs";

const MediaLibraryMemberEntitySchemaSlug = Schema.Literals(mediaLibraryMemberEntitySchemaSlugs);

export const MediaUserDataInput = Schema.Union([
	Schema.Struct({
		...mediaSubmissionFields,
		entityId: Schema.NonEmptyString,
		action: Schema.Literal("remove"),
		entitySchemaSlug: MediaLibraryMemberEntitySchemaSlug,
	}),
	Schema.Struct({
		...mediaSubmissionFields,
		action: Schema.Literal("merge"),
		mergeFrom: Schema.NonEmptyString,
		mergeInto: Schema.NonEmptyString,
		entitySchemaSlug: MediaLibraryMemberEntitySchemaSlug,
	}),
]);

export type MediaUserDataInput = typeof MediaUserDataInput.Type;

export type MediaUserDataAction =
	| Omit<
			Extract<MediaUserDataInput, { readonly action: "merge" }>,
			keyof typeof mediaSubmissionFields
	  >
	| Omit<
			Extract<MediaUserDataInput, { readonly action: "remove" }>,
			keyof typeof mediaSubmissionFields
	  >;

const Count = Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0)));

export const MediaUserDataOutput = Schema.Union([
	Schema.Struct({ count: Count, status: Schema.Literal("saved") }),
	Schema.Struct({ message: Schema.String, status: Schema.Literal("rejected") }),
]);

export type MediaUserDataOutput = typeof MediaUserDataOutput.Type;
