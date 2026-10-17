import type { SandboxRunError } from "@ryot-app/contract/errors";
import type { Effect } from "effect";
import { Context, Schema } from "effect";

import type { SandboxPrincipal } from "./principal";

export const SandboxTrust = Schema.Literals(["system", "user"]);

export class SandboxExecutionAuthority extends Context.Service<
	SandboxExecutionAuthority,
	{
		readonly resolve: (
			principal: SandboxPrincipal,
		) => Effect.Effect<typeof SandboxTrust.Type, SandboxRunError>;
	}
>()("SandboxExecutionAuthority") {}
