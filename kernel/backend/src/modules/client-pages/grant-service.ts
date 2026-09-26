import { ClientDocumentGrantNotFound } from "@ryot-app/contract/modules/client-pages/schemas";
import { UserId } from "@ryot-app/contract/schema/brands";
import { Context, Effect, Layer, Schema } from "effect";

import { ReusableCapabilityGrantStore } from "#lib/infrastructure/reusable-capability-grants";

const payloadSchema = Schema.fromJsonString(
	Schema.Struct({ userId: UserId, compositionHash: Schema.String }),
);
const grantKey = (id: string) => `ryot:client-pages:document:${id}`;
const reuseKey = (userId: UserId, hash: string) =>
	`ryot:client-pages:document-user:${userId}:${hash}`;
const notFound = () =>
	new ClientDocumentGrantNotFound({ reason: { code: "document-grant-not-found" } });

export class ClientDocumentGrantService extends Context.Service<ClientDocumentGrantService>()(
	"ClientDocumentGrantService",
	{
		make: Effect.gen(function* () {
			const grants = yield* ReusableCapabilityGrantStore;
			return {
				resolve: Effect.fn("ClientDocumentGrant.resolve")(function* (token: string) {
					const raw = yield* grants.resolve(token, grantKey);
					if (!raw) {
						return yield* notFound();
					}
					return yield* Schema.decodeEffect(payloadSchema)(raw).pipe(Effect.mapError(notFound));
				}),
				issue: Effect.fn("ClientDocumentGrant.issue")(function* (
					userId: UserId,
					compositionHash: string,
				) {
					const payload = yield* Schema.encodeUnknownEffect(payloadSchema)({
						userId,
						compositionHash,
					}).pipe(Effect.orDie);
					const { token, grantId, expiresAt } = yield* grants.issue({
						payload,
						grantKey,
						ttlSeconds: 900,
						reuseKey: reuseKey(userId, compositionHash),
					});
					return { grantId, expiresAt, src: `/api/client-pages/documents/${token}` };
				}),
			};
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
