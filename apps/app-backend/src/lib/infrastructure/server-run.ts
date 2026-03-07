import { generateId } from "better-auth";
import { Context, Effect, Layer } from "effect";

export class ServerRun extends Context.Service<ServerRun>()("ServerRun", {
	make: Effect.sync(() => ({ id: generateId() })),
}) {
	static readonly layer = Layer.effect(this, this.make);
}
