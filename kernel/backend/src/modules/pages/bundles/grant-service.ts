import { UserId } from "@ryot-app/contract/schema/brands";
import { JsonValue } from "@ryot-app/contract/schema/json";
import { stableStringify } from "@ryot-app/ts-utils/json";
import { Context, Effect, Layer, Schema } from "effect";

import { ReusableCapabilityGrantStore } from "#modules/pages/bundles/reusable-capability-grants";

import { ClientArtifactGrantAuthority } from "./grant-authority";

const ArtifactGrantPayloadFromJson = Schema.fromJsonString(
	Schema.Struct({
		userId: UserId,
		artifactHash: Schema.String,
		scope: Schema.optionalKey(JsonValue),
	}),
);

const grantKey = (grantId: string) => `ryot:client-artifacts:grant:${grantId}`;
const reuseKey = (userId: UserId, artifactHash: string) =>
	`ryot:client-artifacts:grant-user:${userId}:${artifactHash}`;

export class ClientArtifactGrantService extends Context.Service<ClientArtifactGrantService>()(
	"@ryot-app/kernel-backend/modules/pages/bundles/grant-service/ClientArtifactGrantService",
	{
		make: Effect.gen(function* () {
			const grants = yield* ReusableCapabilityGrantStore;
			const authority = yield* ClientArtifactGrantAuthority;
			return {
				resolve: Effect.fn("ClientArtifactGrantService.resolve")(function* (token: string) {
					const raw = yield* grants.resolve(token, grantKey);
					if (raw === null) {
						return null;
					}
					const payload = yield* Schema.decodeEffect(ArtifactGrantPayloadFromJson)(raw).pipe(
						Effect.orElseSucceed(() => null),
					);
					return payload?.scope !== undefined && !(yield* authority.validate(payload.scope))
						? null
						: payload;
				}),
				issue: Effect.fn("ClientArtifactGrantService.issue")(function* (
					userId: UserId,
					artifactHash: string,
					scope?: JsonValue,
				) {
					const payload = yield* Schema.encodeUnknownEffect(ArtifactGrantPayloadFromJson)({
						...(scope === undefined ? {} : { scope }),
						userId,
						artifactHash,
					}).pipe(Effect.orDie);
					return yield* grants.issue({
						payload,
						grantKey,
						ttlSeconds: 900,
						reuseKey: `${reuseKey(userId, artifactHash)}:${scope === undefined ? "owner" : stableStringify(scope)}`,
					});
				}),
			};
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
