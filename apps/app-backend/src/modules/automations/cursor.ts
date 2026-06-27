import { type BadRequest, badRequest } from "@ryot/contract/errors";
import { Effect, Schema } from "effect";

const CursorKind = Schema.Literal("signal", "run");

export type CursorKind = typeof CursorKind.Type;

const CursorPayload = Schema.parseJson(
	Schema.Struct({
		k: CursorKind,
		t: Schema.Number,
		id: Schema.String,
		v: Schema.Literal(1),
	}),
);

const encodePayload = Schema.encodeSync(CursorPayload);
const decodePayload = Schema.decodeUnknown(CursorPayload);

export const encodeCursor = (kind: CursorKind, cursor: { t: Date; id: string }): string =>
	Buffer.from(encodePayload({ v: 1, k: kind, t: cursor.t.getTime(), id: cursor.id })).toString(
		"base64url",
	);

export const decodeCursor = (
	kind: CursorKind,
	raw: string,
): Effect.Effect<{ t: Date; id: string }, BadRequest> =>
	decodePayload(Buffer.from(raw, "base64url").toString("utf8")).pipe(
		Effect.filterOrFail((payload) => payload.k === kind),
		Effect.map((payload) => ({ t: new Date(payload.t), id: payload.id })),
		Effect.mapError(() => badRequest("Invalid cursor")),
	);
