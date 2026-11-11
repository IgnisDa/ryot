import { Result, Schema } from "effect";

import { EntityId } from "../../schema/brands";
import { strictStruct } from "../../schema/utils";
import { SavedViewReference } from "../plugins/references";

export const EntitySourceReference = Schema.Union([
	strictStruct({ collectionId: EntityId, kind: Schema.Literal("collection") }),
	strictStruct({ reference: SavedViewReference, kind: Schema.Literal("saved-view") }),
]);
export type EntitySourceReference = typeof EntitySourceReference.Type;

const encodedReference = Schema.fromJsonString(EntitySourceReference);
export const encodeEntitySourceReference = (reference: EntitySourceReference): string =>
	Result.getOrThrow(Schema.encodeResult(encodedReference)(reference));
export const decodeEntitySourceReference = Schema.decodeUnknownResult(encodedReference);
