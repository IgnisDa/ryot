import type { SandboxRunError } from "@ryot-app/contract/errors";
import { Context, type Effect } from "effect";

import type { BoundHostFunction, SandboxRunInput } from "./invocation";

export class SandboxHostFunctions extends Context.Service<
	SandboxHostFunctions,
	{
		readonly bind: (
			input: SandboxRunInput,
		) => Effect.Effect<Readonly<Record<string, BoundHostFunction>>, SandboxRunError>;
	}
>()("SandboxHostFunctions") {}
