import type { Capability } from "@ryot-app/contract/schema/capability";
import type { JsonValue } from "@ryot-app/contract/schema/json";
import type { Effect } from "effect";

import type { AgentRunSuspended } from "#modules/scripts/agent/service";

import { capabilityDeclarations } from "./declarations";

export type WriteRequest = {
	readonly index: number;
	readonly input: JsonValue;
	readonly capability: Capability;
};
export type WriteGate = {
	readonly authorize: (
		request: WriteRequest,
	) => Effect.Effect<
		{ readonly approved: true } | { readonly reason: string; readonly approved: false },
		AgentRunSuspended
	>;
	readonly settle: (
		request: WriteRequest,
		outcome:
			| { readonly message: string; readonly state: "failure" }
			| { readonly state: "success"; readonly value: JsonValue },
	) => Effect.Effect<void>;
};

export const referencedCapabilities = (code: string, capabilities: readonly Capability[]) =>
	capabilities.filter((capability) =>
		["'", '"', "`"].some((quote) => code.includes(`${quote}${capability.id}${quote}`)),
	);

export const executeSource = (code: string, capabilities: readonly Capability[]) =>
	`const run = async (ryot: Ryot): Promise<unknown> => {${code}
};
interface Ryot {
  call<Id extends keyof Capabilities>(id: Id, input: Capabilities[Id]["input"]): Promise<Capabilities[Id]["output"]>;
}
export const manifest = defineManifest({ kind: "script", name: "Agent execution", slug: "agent.execute" });
export default defineScript({
  manifest,
  input: Schema.Struct({}),
  output: Schema.Unknown,
  run: (_input, host) => {
    function call<Id extends keyof Capabilities>(id: Id, input: Capabilities[Id]["input"]): Promise<Capabilities[Id]["output"]>;
    function call(id: string, input: Json): Promise<unknown> {
      return Effect.runPromise(
        host.invokeCapability({ id, input }).pipe(Effect.mapError((error) => new Error(error.message))),
      );
    }
    return Effect.tryPromise({
      try: async () => (await run({ call })) ?? null,
      catch: (error) => (error instanceof Error ? error.message : String(error)),
    });
  },
});
${capabilityDeclarations(capabilities)}
import { defineManifest, defineScript } from "@ryot-app/plugin-backend-sdk/agent";
import { Effect, Schema } from "@ryot-app/plugin-backend-sdk/effect";
`;
