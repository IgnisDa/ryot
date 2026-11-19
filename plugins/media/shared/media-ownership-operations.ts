import { Schema } from "@ryot-app/plugin-kit/effect";

const OwnedOn = Schema.NullOr(
	Schema.String.pipe(Schema.check(Schema.isPattern(/^\d{4}-\d{2}-\d{2}$/))),
);

const EntityIds = Schema.Array(Schema.String).pipe(
	Schema.check(Schema.isMinLength(1)),
	Schema.check(Schema.isMaxLength(50)),
);

const MediaOwnershipFoundResult = Schema.Struct({
	ownedOn: OwnedOn,
	owned: Schema.Boolean,
	entityId: Schema.String,
	status: Schema.Literal("found"),
});

const MediaOwnershipNotFoundResult = Schema.Struct({
	entityId: Schema.String,
	status: Schema.Literal("notFound"),
});

export const MediaOwnershipSetInput = Schema.Union([
	Schema.Struct({ ownedOn: OwnedOn, entityIds: EntityIds, owned: Schema.Literal(true) }),
	Schema.Struct({ entityIds: EntityIds, owned: Schema.Literal(false) }),
]);

export type MediaOwnershipSetInput = Schema.Schema.Type<typeof MediaOwnershipSetInput>;

export const MediaOwnershipOutput = Schema.Struct({
	results: Schema.Array(Schema.Union([MediaOwnershipFoundResult, MediaOwnershipNotFoundResult])),
});

export type MediaOwnershipOutput = Schema.Schema.Type<typeof MediaOwnershipOutput>;
