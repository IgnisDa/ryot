import { UserId } from "@ryot-app/contract/schema/brands";
import { Context, Effect, Layer, Schema } from "effect";

import { ReusableCapabilityGrantStore } from "#lib/infrastructure/reusable-capability-grants";

const ArtifactGrantPayloadFromJson = Schema.fromJsonString(
	Schema.Struct({ userId: UserId, artifactHash: Schema.String }),
);

const grantKey = (grantId: string) => `ryot:client-artifacts:grant:${grantId}`;
const reuseKey = (userId: UserId, artifactHash: string) =>
	`ryot:client-artifacts:grant-user:${userId}:${artifactHash}`;

export class ClientArtifactGrantService extends Context.Service<ClientArtifactGrantService>()(
	"ClientArtifactGrantService",
	{
		make: Effect.gen(function* () {
			const grants = yield* ReusableCapabilityGrantStore;
			return {
				resolve: Effect.fn("ClientArtifactGrantService.resolve")(function* (token: string) {
					const raw = yield* grants.resolve(token, grantKey);
					if (raw === null) {
						return null;
					}
					return yield* Schema.decodeEffect(ArtifactGrantPayloadFromJson)(raw).pipe(
						Effect.orElseSucceed(() => null),
					);
				}),
				issue: Effect.fn("ClientArtifactGrantService.issue")(function* (
					userId: UserId,
					artifactHash: string,
				) {
					const payload = yield* Schema.encodeUnknownEffect(ArtifactGrantPayloadFromJson)({
						userId,
						artifactHash,
					}).pipe(Effect.orDie);
					return yield* grants.issue({
						payload,
						grantKey,
						ttlSeconds: 900,
						reuseKey: reuseKey(userId, artifactHash),
					});
				}),
			};
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
