import type { DbError } from "@ryot-app/contract/errors";
import type { JsonValue } from "@ryot-app/contract/schema/json";
import { Context, Effect, Layer } from "effect";

export class ClientArtifactGrantAuthority extends Context.Service<
	ClientArtifactGrantAuthority,
	{ readonly validate: (scope: JsonValue) => Effect.Effect<boolean, DbError> }
>()("@ryot-app/kernel-backend/modules/pages/bundles/grant-authority/ClientArtifactGrantAuthority") {
	static readonly denied = Layer.succeed(this, { validate: () => Effect.succeed(false) });
}
