import { Schema } from "effect";

export const BenchmarkTerminalOutcome = Schema.Literals(["success", "typed-failure", "timeout"]);
export type BenchmarkTerminalOutcome = typeof BenchmarkTerminalOutcome.Type;

/**
 * The hermetic knobs the plan requires. `payloadBytes` must stay strictly below
 * `SANDBOX_LIMITS.execution.resultBytes` (4 MiB); the canonical matrix uses 3_900_000 for its
 * largest bucket so serialization is measured without tripping the limit.
 */
export const BenchmarkWorkloadContext = Schema.Struct({
	seed: Schema.Int,
	payloadBytes: Schema.Int,
	perCallDelayMs: Schema.Int,
	suggestionCount: Schema.Int,
	durableHostCalls: Schema.Int,
	relatedEntityCount: Schema.Int,
	terminalOutcome: BenchmarkTerminalOutcome,
});
export type BenchmarkWorkloadContext = typeof BenchmarkWorkloadContext.Type;

export const TYPED_FAILURE_MESSAGE = "benchmark-typed-failure";

/** Longer than `SANDBOX_LIMITS.execution.timeoutMs` (30s) so the execution is killed by the host. */
export const TIMEOUT_FIXTURE_SLEEP_MS = 45_000;

const PAYLOAD_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

// The sandbox compiler type-checks generated sources under `noImplicitAny`, so the embedded
// helpers are written as annotated source text; the payload generator has no host-side counterpart
// because only the sandbox ever produces a payload.
export const DETERMINISTIC_PAYLOAD_SOURCE = `function deterministicPayload(seed: number, byteLength: number): string {
  const alphabet = ${JSON.stringify(PAYLOAD_ALPHABET)};
  let state = (seed ^ 0x9e3779b9) >>> 0;
  let payload = "";
  for (let index = 0; index < byteLength; index += 1) {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = Math.imul(state ^ (state >>> 15), state | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    payload += alphabet.charAt(((mixed ^ (mixed >>> 14)) >>> 0) % 64);
  }
  return payload;
}`;

/**
 * Import scenarios reach the provider through the public import API, which only carries an external
 * ID, so the workload knobs travel inside that ID and the details script decodes them.
 */
export const encodeBenchmarkExternalId = (
	context: BenchmarkWorkloadContext & { readonly nonce: string },
) =>
	[
		"bm",
		context.seed,
		context.relatedEntityCount,
		context.suggestionCount,
		context.durableHostCalls,
		context.payloadBytes,
		context.perCallDelayMs,
		context.terminalOutcome,
		context.nonce,
	].join(".");

export function decodeBenchmarkExternalId(value: string) {
	const parts = value.split(".");
	if (parts.length !== 9 || parts[0] !== "bm") {
		return null;
	}
	const numbers = parts.slice(1, 7).map((part) => Number.parseInt(part, 10));
	if (numbers.some((part) => !Number.isSafeInteger(part) || part < 0)) {
		return null;
	}
	const outcome = parts[7];
	if (outcome !== "success" && outcome !== "typed-failure" && outcome !== "timeout") {
		return null;
	}
	return {
		seed: numbers[0] ?? 0,
		nonce: parts[8] ?? "",
		terminalOutcome: outcome,
		payloadBytes: numbers[4] ?? 0,
		perCallDelayMs: numbers[5] ?? 0,
		suggestionCount: numbers[2] ?? 0,
		durableHostCalls: numbers[3] ?? 0,
		relatedEntityCount: numbers[1] ?? 0,
	};
}

export const DECODE_EXTERNAL_ID_SOURCE = `type BenchmarkWorkload = {
  seed: number;
  nonce: string;
  payloadBytes: number;
  perCallDelayMs: number;
  suggestionCount: number;
  durableHostCalls: number;
  relatedEntityCount: number;
  terminalOutcome: "success" | "typed-failure" | "timeout";
};

function decodeBenchmarkExternalId(value: string): BenchmarkWorkload | null {
  const parts = value.split(".");
  if (parts.length !== 9 || parts[0] !== "bm") {
    return null;
  }
  const numbers = parts.slice(1, 7).map((part: string) => Number.parseInt(part, 10));
  if (numbers.some((part: number) => !Number.isSafeInteger(part) || part < 0)) {
    return null;
  }
  const outcome = parts[7];
  if (outcome !== "success" && outcome !== "typed-failure" && outcome !== "timeout") {
    return null;
  }
  return {
    seed: numbers[0] ?? 0,
    nonce: parts[8] ?? "",
    terminalOutcome: outcome,
    payloadBytes: numbers[4] ?? 0,
    perCallDelayMs: numbers[5] ?? 0,
    suggestionCount: numbers[2] ?? 0,
    durableHostCalls: numbers[3] ?? 0,
    relatedEntityCount: numbers[1] ?? 0,
  };
}`;

const DURABLE_HOST_CALL_LOOP = `
    for (let call = 0; call < workload.durableHostCalls; call += 1) {
      if (workload.perCallDelayMs > 0) {
        yield* Effect.sleep(Duration.millis(workload.perCallDelayMs));
      }
      const preferences = yield* host.getUserPreferences();
      yield* host.setCachedValue(
        "sandbox-resource-baseline." + workload.seed + "." + call,
        { call, allowNsfw: preferences.allowNsfw },
        60,
      );
    }`;

const TERMINAL_OUTCOME_BRANCHES = `
    if (workload.terminalOutcome === "timeout") {
      yield* Effect.sleep(Duration.millis(${TIMEOUT_FIXTURE_SLEEP_MS}));
    }
    if (workload.terminalOutcome === "typed-failure") {
      return yield* Effect.fail({
        _tag: "BenchmarkTypedFailure",
        message: ${JSON.stringify(TYPED_FAILURE_MESSAGE)},
      });
    }`;

export const benchmarkScriptSource = (input: { readonly slug: string; readonly name: string }) => `
import { defineManifest, defineScript } from "@ryot-app/sandbox-sdk/driver";
import { Duration, Effect, Schema } from "@ryot-app/sandbox-sdk/effect";

export const manifest = defineManifest({
  kind: "script",
  requiredPluginConfigKeys: [],
  requiredSystemConfigKeys: [],
  name: ${JSON.stringify(input.name)},
  slug: ${JSON.stringify(input.slug)},
  capabilities: ["getUserPreferences", "setCachedValue"],
});

${DETERMINISTIC_PAYLOAD_SOURCE}

export default defineScript({
  manifest,
  output: Schema.Struct({ payload: Schema.String, payloadBytes: Schema.Number }),
  input: Schema.Struct({
    seed: Schema.Number,
    payloadBytes: Schema.Number,
    perCallDelayMs: Schema.Number,
    durableHostCalls: Schema.Number,
    relatedEntityCount: Schema.Number,
    suggestionCount: Schema.Number,
    terminalOutcome: Schema.String,
  }),
  run: (workload, host) => Effect.gen(function* () {${DURABLE_HOST_CALL_LOOP}
${TERMINAL_OUTCOME_BRANCHES}
    const payload = deterministicPayload(workload.seed, workload.payloadBytes);
    return { payload, payloadBytes: payload.length };
  }),
});
`;

/** A rate-limited origin that each details run calls before its durable host-call loop. */
export type BenchmarkRateLimitedCalls = { readonly url: string; readonly calls: number };

export const benchmarkBookDetailsSource = (input: {
	readonly slug: string;
	readonly name: string;
	readonly bookProviderSlug: string;
	readonly personProviderSlug: string;
	readonly suggestionRelationshipSlug: string;
	readonly relatedEntityRelationshipSlug: string;
	readonly rateLimited?: BenchmarkRateLimitedCalls;
}) => `
import { defineManifest } from "@ryot-app/sandbox-sdk/driver";
import { Duration, Effect } from "@ryot-app/sandbox-sdk/effect";
import { defineProvider } from "@ryot-app/sandbox-sdk/provider";

export const manifest = defineManifest({
  kind: "provider",
  requiredPluginConfigKeys: [],
  requiredSystemConfigKeys: [],
  name: ${JSON.stringify(input.name)},
  slug: ${JSON.stringify(input.slug)},
  capabilities: ${JSON.stringify([
		"getUserPreferences",
		"setCachedValue",
		...(input.rateLimited ? ["httpCall"] : []),
	])},
});

${DETERMINISTIC_PAYLOAD_SOURCE}

${DECODE_EXTERNAL_ID_SOURCE}

export default defineProvider({
  manifest,
  operation: "details",
  run: (details, host) => Effect.gen(function* () {
    const workload = decodeBenchmarkExternalId(details.externalId);
    if (workload === null) {
      return yield* Effect.fail({
        _tag: "BenchmarkExternalIdInvalid",
        message: "benchmark external id could not be decoded",
      });
    }${
			input.rateLimited
				? `
    for (let call = 0; call < ${input.rateLimited.calls}; call += 1) {
      yield* host.httpCall("GET", ${JSON.stringify(input.rateLimited.url)});
    }`
				: ""
		}${DURABLE_HOST_CALL_LOOP}
${TERMINAL_OUTCOME_BRANCHES}
    const related = Array.from({ length: workload.relatedEntityCount }, (_unused: unknown, index: number) => ({
      providerSlug: ${JSON.stringify(input.personProviderSlug)},
      name: "Benchmark person " + workload.nonce + "-" + index,
      externalId: "bmp." + workload.nonce + "." + index,
      relationshipProperties: { order: index, roles: ["Benchmark"] },
    }));
    const suggestions = Array.from({ length: workload.suggestionCount }, (_unused: unknown, index: number) => ({
      providerSlug: ${JSON.stringify(input.bookProviderSlug)},
      name: "Benchmark suggestion " + workload.nonce + "-" + index,
      externalId: [
        "bm", workload.seed, 0, 0, 0, 0, 0, "success", workload.nonce + "-s" + index,
      ].join("."),
    }));
    const groups: Array<{
      relationshipSchemaSlug: string;
      direction: "incoming" | "outgoing";
      synchronization: "authoritative" | "additive";
      entities: ReadonlyArray<{
        name: string;
        externalId: string;
        providerSlug: string;
        relationshipProperties?: { order: number; roles: string[] };
      }>;
    }> = [];
    if (related.length > 0) {
      groups.push({
        entities: related,
        direction: "incoming",
        synchronization: "additive",
        relationshipSchemaSlug: ${JSON.stringify(input.relatedEntityRelationshipSlug)},
      });
    }
    if (suggestions.length > 0) {
      groups.push({
        entities: suggestions,
        direction: "outgoing",
        synchronization: "authoritative",
        relationshipSchemaSlug: ${JSON.stringify(input.suggestionRelationshipSlug)},
      });
    }
    return {
      relatedEntityGroups: groups,
      name: "Benchmark book " + workload.nonce,
      properties: {
        payloadBytes: workload.payloadBytes,
        payload: deterministicPayload(workload.seed, workload.payloadBytes),
      },
    };
  }),
});
`;

export const benchmarkPersonDetailsSource = (input: {
	readonly slug: string;
	readonly name: string;
}) => `
import { defineManifest } from "@ryot-app/sandbox-sdk/driver";
import { Effect } from "@ryot-app/sandbox-sdk/effect";
import { defineProvider } from "@ryot-app/sandbox-sdk/provider";

export const manifest = defineManifest({
  kind: "provider",
  capabilities: [],
  requiredPluginConfigKeys: [],
  requiredSystemConfigKeys: [],
  name: ${JSON.stringify(input.name)},
  slug: ${JSON.stringify(input.slug)},
});

export default defineProvider({
  manifest,
  operation: "details",
  run: (details) => Effect.succeed({
    properties: {},
    name: "Benchmark person " + details.externalId,
  }),
});
`;

export const benchmarkBookSearchSource = (input: {
	readonly slug: string;
	readonly name: string;
}) => `
import { defineManifest } from "@ryot-app/sandbox-sdk/driver";
import { Effect } from "@ryot-app/sandbox-sdk/effect";
import { defineProvider } from "@ryot-app/sandbox-sdk/provider";

export const manifest = defineManifest({
  kind: "provider",
  capabilities: [],
  requiredPluginConfigKeys: [],
  requiredSystemConfigKeys: [],
  name: ${JSON.stringify(input.name)},
  slug: ${JSON.stringify(input.slug)},
});

export default defineProvider({
  manifest,
  operation: "search",
  run: (search) => Effect.succeed({
    items: [{ title: "Benchmark " + search.query, externalId: "bm.1.0.0.0.1024.0.success.search" }],
  }),
});
`;

/**
 * Holds `allocateMiB` of touched off-heap memory for `holdMs`. Array buffers sit outside V8's
 * old-space limit, so only a process or container memory limit bounds this script.
 */
export const benchmarkMemorySource = (input: { readonly slug: string; readonly name: string }) => `
import { defineManifest, defineScript } from "@ryot-app/sandbox-sdk/driver";
import { Duration, Effect, Schema } from "@ryot-app/sandbox-sdk/effect";

export const manifest = defineManifest({
  kind: "script",
  capabilities: [],
  requiredPluginConfigKeys: [],
  requiredSystemConfigKeys: [],
  name: ${JSON.stringify(input.name)},
  slug: ${JSON.stringify(input.slug)},
});

export default defineScript({
  manifest,
  output: Schema.Struct({ allocatedMiB: Schema.Number }),
  input: Schema.Struct({ allocateMiB: Schema.Number, holdMs: Schema.Number }),
  run: (workload) => Effect.gen(function* () {
    const blocks: Uint8Array[] = [];
    for (let index = 0; index < workload.allocateMiB; index += 1) {
      blocks.push(new Uint8Array(1024 * 1024).fill((index % 250) + 1));
    }
    yield* Effect.sleep(Duration.millis(workload.holdMs));
    return { allocatedMiB: blocks.length };
  }),
});
`;
