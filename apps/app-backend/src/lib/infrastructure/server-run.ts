import { generateId } from "better-auth";
import { Effect } from "effect";

export class ServerRun extends Effect.Service<ServerRun>()("ServerRun", {
	sync: () => ({ id: generateId() }),
}) {}
