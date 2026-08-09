import type { SavedViewRenderer } from "@ryot-app/contract/modules/saved-views/schemas";
import type { UserId } from "@ryot-app/contract/schema/brands";
import { Context, Effect, Layer } from "effect";

export class ClientSurfaceMaterializer extends Context.Service<ClientSurfaceMaterializer>()(
	"ClientSurfaceMaterializer",
	{
		make: Effect.succeed({
			materializeSystemBaseline: Effect.die(
				new Error("Client surface materializer is not configured"),
			).pipe(Effect.asVoid),
			materializeUser: (_userId: UserId): Effect.Effect<void> =>
				Effect.die(new Error("Client surface materializer is not configured")),
			assertUserBuilds: (_userId: UserId): Effect.Effect<void> =>
				Effect.die(new Error("Client surface materializer is not configured")),
			materializeRenderer: (_userId: UserId, _renderer: SavedViewRenderer): Effect.Effect<void> =>
				Effect.die(new Error("Client surface materializer is not configured")),
			materializePendingInstallation: (
				_userId: UserId,
				_installationId: string,
			): Effect.Effect<void> =>
				Effect.die(new Error("Client surface materializer is not configured")),
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
