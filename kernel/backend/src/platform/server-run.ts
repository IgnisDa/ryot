import { generateId } from "better-auth";
import { Context, Effect, Layer } from "effect";

export class ServerRun extends Context.Service<ServerRun>()(
	"@ryot-app/kernel-backend/platform/server-run/ServerRun",
	{ make: Effect.sync(() => ({ id: generateId() })) },
) {
	static readonly layer = Layer.effect(this, this.make);
}
