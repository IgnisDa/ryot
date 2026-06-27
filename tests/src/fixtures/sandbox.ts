import { requirePresent } from "../test-support/assertions";
import type { Client } from "./auth";
import type { ContractPayload, ContractSuccess } from "./contract-client";
import { type PollOptions, pollUntil } from "./polling";

type CreateSandboxScriptBody = ContractPayload<"sandbox", "createScript">;
type LegacyCreateSandboxScriptBody = {
	code: string;
	name?: string;
	slug?: string;
	metadata?: {
		allowedHostFunctions?: readonly string[];
		requiredAppConfigKeys?: readonly string[];
	};
};

type EnqueueSandboxBody = ContractPayload<"sandbox", "enqueue">;
type SandboxResult = Exclude<ContractSuccess<"sandbox", "getResult">, { status: "pending" }> | null;

const legacySandboxSource = (body: LegacyCreateSandboxScriptBody) => {
	const slug = body.slug ?? body.name;
	if (!slug) {
		throw new Error("Legacy sandbox fixture requires a slug or name");
	}
	const name = body.name ?? slug;
	const capabilities = body.metadata?.allowedHostFunctions ?? [];
	const requiredAppConfigKeys = body.metadata?.requiredAppConfigKeys ?? [];
	const driverNames = [...body.code.matchAll(/driver\(\s*["']([^"']+)["']/g)]
		.map((match) => match[1])
		.filter((driverName): driverName is string => driverName !== undefined);
	const uniqueDriverNames = [...new Set(driverNames)];
	if (uniqueDriverNames.length === 0) {
		throw new Error("Legacy sandbox fixture must register at least one driver");
	}
	const driverDeclarations = uniqueDriverNames
		.map(
			(driverName, index) => `const legacyDriver${index} = defineDriver(manifest, {
  input: z.unknown(),
  output: z.unknown(),
  run: (input, host, execution) =>
    runLegacyDriver(${JSON.stringify(driverName)}, input, host, execution),
});`,
		)
		.join("\n\n");
	const driverEntries = uniqueDriverNames
		.map((driverName, index) => `    ${JSON.stringify(driverName)}: legacyDriver${index},`)
		.join("\n");

	return `
import {
  defineDriver,
  defineManifest,
  defineScript,
  z,
  type ExecutionMetadata,
} from "@ryot/sandbox-sdk";

export const manifest = defineManifest({
  kind: "script",
  name: ${JSON.stringify(name)},
  slug: ${JSON.stringify(slug)},
  capabilities: ${JSON.stringify(capabilities)},
  requiredAppConfigKeys: ${JSON.stringify(requiredAppConfigKeys)},
});

type LegacyRun = (context: unknown, execution: ExecutionMetadata) => Promise<unknown>;

const runLegacyDriver = async (
  driverName: string,
  input: unknown,
  host: unknown,
  execution: ExecutionMetadata,
) => {
  const drivers: Record<string, LegacyRun> = {};
  const driver = (name: string, run: LegacyRun) => {
    drivers[name] = run;
  };
  const hostRecord = host as Record<string, (...args: unknown[]) => Promise<unknown>>;
  const hostNames = Object.keys(hostRecord);
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as new (
    ...parameters: string[]
  ) => (...args: unknown[]) => Promise<void>;
  const register = new AsyncFunction("driver", ...hostNames, ${JSON.stringify(body.code)});
  await register(driver, ...hostNames.map((hostName) => hostRecord[hostName]));
  const run = drivers[driverName];
  if (!run) throw new Error('Driver "' + driverName + '" is not defined in this script');
  return await run(input, execution);
};

${driverDeclarations}

export default defineScript({
  manifest,
  drivers: {
${driverEntries}
  },
});
`;
};

export function literalSandboxSource(input: {
	name: string;
	slug: string;
	value: boolean | number | string;
}) {
	return `
import { defineDriver, defineManifest, defineScript, z } from "@ryot/sandbox-sdk";

export const manifest = defineManifest({
  kind: "script",
  name: ${JSON.stringify(input.name)},
  slug: ${JSON.stringify(input.slug)},
  capabilities: [],
  requiredAppConfigKeys: [],
});

const main = defineDriver(manifest, {
  input: z.object({}),
  output: z.literal(${JSON.stringify(input.value)}),
  run: async () => ${JSON.stringify(input.value)} as const,
});

export default defineScript({ manifest, drivers: { main } });
`;
}

export async function createSandboxScript(
	client: Client,
	body: CreateSandboxScriptBody | LegacyCreateSandboxScriptBody,
) {
	const payload = "source" in body ? body : { source: legacySandboxSource(body) };
	const script = await client.run((c) => c.sandbox.createScript({ payload }));
	requirePresent(script.id, "Failed to create sandbox script");
	return script;
}

export async function enqueueSandboxScript(client: Client, body: EnqueueSandboxBody) {
	const result = await client.run((c) => c.sandbox.enqueue({ payload: body }));

	return {
		jobId: requirePresent(result.jobId, "Failed to enqueue sandbox script"),
	};
}

export async function pollSandboxResult(client: Client, jobId: string, options: PollOptions = {}) {
	return pollUntil(
		`sandbox job '${jobId}'`,
		async (): Promise<SandboxResult> => {
			const result = await client.run((c) => c.sandbox.getResult({ path: { jobId } }));

			return result.status !== "pending" ? result : null;
		},
		{ timeoutMs: 120_000, ...options },
	);
}
