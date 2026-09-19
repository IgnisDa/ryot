import type { SandboxRunError } from "@ryot-app/contract/errors";
import type { Effect } from "effect";
import { Context } from "effect";

import type { SandboxRunInput } from "./shared";

export class SandboxArtifactStaging extends Context.Service<
	SandboxArtifactStaging,
	{
		prepare: (
			input: SandboxRunInput,
		) => Effect.Effect<
			((sources: ReadonlyArray<string>) => Effect.Effect<string[], SandboxRunError>) | null,
			SandboxRunError
		>;
	}
>()("SandboxArtifactStaging") {}
