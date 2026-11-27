import { Schema } from "@ryot-app/plugin-kit/effect";

import { MediaCopyDetails } from "./media-copy";

const CopyId = Schema.NonEmptyString.check(Schema.isMaxLength(512));
const EntityId = Schema.NonEmptyString;

export const MediaCopyWriteInput = Schema.Union([
	Schema.Struct({
		entityId: EntityId,
		details: MediaCopyDetails,
		action: Schema.Literal("add"),
		copyId: Schema.NonEmptyString.check(Schema.isMaxLength(128)),
	}),
	Schema.Struct({ copyId: CopyId, details: MediaCopyDetails, action: Schema.Literal("update") }),
	Schema.Struct({ copyId: CopyId, action: Schema.Literal("remove") }),
]);

export type MediaCopyWriteInput = typeof MediaCopyWriteInput.Type;

export const MediaCopyWriteOutput = Schema.Struct({ copyId: CopyId });
