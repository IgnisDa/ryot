import type { SandboxRunError } from "@ryot-app/contract/errors";
import type { Effect } from "effect";
import { Context, Schema } from "effect";

import type { ScriptExecutionPrincipal } from "../protocol/principal";

export const SandboxTrust = Schema.Literals(["system", "user"]);

export class SandboxExecutionAuthority extends Context.Service<
	SandboxExecutionAuthority,
	{
		readonly resolve: (
			principal: ScriptExecutionPrincipal,
		) => Effect.Effect<typeof SandboxTrust.Type, SandboxRunError>;
	}
>()("SandboxExecutionAuthority") {}
