import type { SandboxRunError } from "@ryot-app/contract/errors";
import type { Effect } from "effect";
import { Context } from "effect";

import type { SandboxRunInput } from "./invocation";

export class ExecutionFileStaging extends Context.Service<
	ExecutionFileStaging,
	{
		prepare: (
			input: SandboxRunInput,
		) => Effect.Effect<
			((outputs: ReadonlyArray<Uint8Array>) => Effect.Effect<string[], SandboxRunError>) | null,
			SandboxRunError
		>;
	}
>()("ExecutionFileStaging") {}
