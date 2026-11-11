import { Schema } from "effect";

import { strictStruct } from "../../schema/utils";

export const PageDraftBuildIdentity = strictStruct({
	pageId: Schema.NonEmptyString,
	artifactHash: Schema.NonEmptyString,
	definitionHash: Schema.NonEmptyString,
	draftRevision: Schema.Int.check(Schema.isGreaterThan(0)),
});
export type PageDraftBuildIdentity = typeof PageDraftBuildIdentity.Type;

export const PageOperationAuthority = strictStruct({
	pageId: Schema.NonEmptyString,
	definitionHash: Schema.NonEmptyString,
	revision: Schema.Int.check(Schema.isGreaterThan(0)),
	authorityRevision: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
});
export type PageOperationAuthority = typeof PageOperationAuthority.Type;
