import { getPgClient } from "../setup";
import { assertCompleted, requirePresent } from "../test-support/assertions";
import type { Client } from "./auth";
import type { ContractPayload, ContractSuccess } from "./contract-client";
import { type PollOptions, pollUntil } from "./polling";

type CreateSandboxScriptBody = ContractPayload<"sandbox", "createScript">;
type EnqueueSandboxBody = ContractPayload<"sandbox", "enqueue">;
type SandboxResult = Exclude<ContractSuccess<"sandbox", "getResult">, { status: "pending" }>;
type CompletedSandboxResult = Extract<SandboxResult, { status: "completed" }>;
type SandboxExecutionError = NonNullable<CompletedSandboxResult["error"]>;

type StoredScriptRepresentation = {
	slug: string;
	name: string;
	source: string;
	metadata: unknown;
	compiledCode: string;
	compiledFormat: number;
};

const representationValues = (row: StoredScriptRepresentation) => [
	row.slug,
	row.name,
	row.source,
	row.compiledCode,
	row.compiledFormat,
	JSON.stringify(row.metadata),
];

export async function createSandboxScript(client: Client, body: CreateSandboxScriptBody) {
	const script = await client.run((c) => c.sandbox.createScript({ payload: body }));
	requirePresent(script.id, "Failed to create sandbox script");
	return script;
}

export async function createAndPromoteSandboxScript(client: Client, source: string) {
	const script = await createSandboxScript(client, { source });
	const pg = getPgClient();
	try {
		const stored = await pg.query<StoredScriptRepresentation>(
			`select slug, name, source, metadata, compiled_code as "compiledCode",
			        compiled_format as "compiledFormat"
			 from sandbox_script where id = $1`,
			[script.id],
		);
		const before = requirePresent(stored.rows[0], "Compiled sandbox script was not persisted");
		const promoted = await pg.query<StoredScriptRepresentation>(
			`update sandbox_script set is_builtin = true, user_id = null where id = $1
			 returning slug, name, source, metadata, compiled_code as "compiledCode",
			           compiled_format as "compiledFormat"`,
			[script.id],
		);
		const after = requirePresent(promoted.rows[0], "Failed to promote compiled sandbox script");
		if (
			JSON.stringify(representationValues(after)) !== JSON.stringify(representationValues(before))
		) {
			throw new Error("Sandbox script promotion changed its compiled representation");
		}

		return script;
	} catch (error) {
		await pg
			.query(`delete from sandbox_script where id = $1`, [script.id])
			.catch((cleanupError) => {
				console.error("[sandbox] failed promotion cleanup", cleanupError);
			});
		throw error;
	}
}

export async function replaceSandboxScriptCompiledRepresentation(
	client: Client,
	targetScriptId: string,
	source: string,
) {
	const replacement = await createSandboxScript(client, { source });
	const pg = getPgClient();
	let temporaryRemoved = false;
	try {
		const stored = await pg.query<StoredScriptRepresentation>(
			`select slug, name, source, metadata, compiled_code as "compiledCode",
			        compiled_format as "compiledFormat"
			 from sandbox_script where id = $1`,
			[replacement.id],
		);
		const before = requirePresent(stored.rows[0], "Replacement sandbox script was not persisted");
		const updated = await pg.query<StoredScriptRepresentation>(
			`update sandbox_script as target
			 set slug = replacement.slug,
			     name = replacement.name,
			     code = replacement.source,
			     source = replacement.source,
			     metadata = replacement.metadata,
			     compiled_code = replacement.compiled_code,
			     compiled_format = replacement.compiled_format
			 from sandbox_script as replacement
			 where target.id = $1 and replacement.id = $2
			 returning target.slug, target.name, target.source, target.metadata,
			           target.compiled_code as "compiledCode",
			           target.compiled_format as "compiledFormat"`,
			[targetScriptId, replacement.id],
		);
		const after = requirePresent(
			updated.rows[0],
			"Failed to replace sandbox script representation",
		);
		if (
			JSON.stringify(representationValues(after)) !== JSON.stringify(representationValues(before))
		) {
			throw new Error("Sandbox script replacement changed its compiled representation");
		}
	} finally {
		const deleted = await pg
			.query(`delete from sandbox_script where id = $1`, [replacement.id])
			.catch((error) => {
				console.error("[sandbox] temporary replacement cleanup failed", error);
				return null;
			});
		temporaryRemoved = deleted?.rowCount === 1;
	}
	if (!temporaryRemoved) {
		throw new Error("Failed to remove temporary replacement sandbox script");
	}
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
		async (): Promise<SandboxResult | null> => {
			const result = await client.run((c) => c.sandbox.getResult({ path: { jobId } }));

			return result.status !== "pending" ? result : null;
		},
		{ timeoutMs: 120_000, ...options },
	);
}

export function formatSandboxExecutionError(error: SandboxExecutionError) {
	const location = error.line ? ` at ${error.line}${error.column ? `:${error.column}` : ""}` : "";
	return `[${error.phase}] ${error.message}${location}${error.stack ? `\n${error.stack}` : ""}`;
}

export function requireCompletedSandboxValue(result: SandboxResult, label = "sandbox job") {
	assertCompleted(result, label);
	if (result.error) {
		throw new Error(`${label} execution failed: ${formatSandboxExecutionError(result.error)}`);
	}
	return result.value;
}
