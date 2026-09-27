import { SandboxRunError } from "@ryot-app/contract/errors";
import type { ExecutionLane } from "@ryot-app/contract/modules/automations/lifecycle";
import { Option, Result } from "effect";

import { MiB, SANDBOX_LIMITS } from "./limits";
import { SIDECAR_PROTOCOL_LIMITS } from "./sidecar-protocol";
import { SANDBOX_TRANSIENT_MEMORY, sandboxTransientPermitBytes } from "./transient-memory";

export const processBytes = 128 * MiB;
const residentBytes = 2 * processBytes;
const defaultMemoryBudgetBytes = 1536 * MiB;
export const isolateBytes =
	SANDBOX_LIMITS.isolate.heapBytes +
	SANDBOX_LIMITS.isolate.externalBytes +
	SANDBOX_LIMITS.sidecar.heapHeadroomBytes;
const outstandingHostCalls = SANDBOX_LIMITS.bridge.concurrentHostCalls + 1;
// Isolate, fixed stack and staging, run start, then per outstanding host call its inbound frame,
// Rust encoding and Rust result delivery, then the done text Rust holds before disposal.
export const runBytes =
	isolateBytes +
	15 * MiB +
	28 * MiB +
	outstandingHostCalls * (4 * MiB + 5 * MiB + SIDECAR_PROTOCOL_LIMITS.messageBytes.hostResult) +
	SIDECAR_PROTOCOL_LIMITS.messageBytes.done;
const inlinePermitBytes = sandboxTransientPermitBytes(
	"inlineBatch",
	SANDBOX_LIMITS.bridge.requestBytes,
);
export const interactiveHeadroomBytes = runBytes + processBytes;
export const sharedModeMinimumBudgetBytes =
	residentBytes + inlinePermitBytes + interactiveHeadroomBytes;

export type SandboxMemoryPlan = {
	readonly budget: number;
	readonly dynamicBytes: number;
	readonly mode: "lane" | "shared";
	readonly pools: Readonly<Record<ExecutionLane, number>>;
};

const limitError = (message: string) =>
	new SandboxRunError({ message, kind: "resource-unavailable" });

// Lane mode keeps one interactive run with a lazy process beside one background run with its own, and
// caps each lane's pool at one inline batch plus its evidence; the interactive pool is filled first.
// Shared mode has one inline-sized pool, and is the only mode of a process serving one lane.
export const sandboxMemoryPlan = (
	configuredMiB: Option.Option<number>,
	effectiveMemory: number,
	lanes: ReadonlyArray<ExecutionLane>,
): Result.Result<SandboxMemoryPlan, SandboxRunError> => {
	if (!Number.isSafeInteger(effectiveMemory) || effectiveMemory <= 0) {
		return Result.fail(limitError("Sandbox effective host memory is unavailable"));
	}
	const halfMemory = Math.floor(effectiveMemory / 2);
	const budget = Option.match(configuredMiB, {
		onSome: (mebibytes) => mebibytes * MiB,
		onNone: () => Math.min(defaultMemoryBudgetBytes, halfMemory),
	});
	if (budget > halfMemory) {
		return Result.fail(limitError("Sandbox memory budget exceeds half the effective host memory"));
	}
	const available = budget - residentBytes;
	if (lanes.length > 1 && available >= 2 * inlinePermitBytes + 2 * interactiveHeadroomBytes) {
		const poolCap = inlinePermitBytes + SANDBOX_TRANSIENT_MEMORY.inlineEvidenceBytes;
		const interactive = Math.min(
			available - 2 * interactiveHeadroomBytes - inlinePermitBytes,
			poolCap,
		);
		const background = Math.min(available - 2 * interactiveHeadroomBytes - interactive, poolCap);
		return Result.succeed({
			budget,
			mode: "lane",
			pools: { background, interactive },
			dynamicBytes: available - interactive - background,
		});
	}
	if (available >= inlinePermitBytes + interactiveHeadroomBytes) {
		return Result.succeed({
			budget,
			mode: "shared",
			dynamicBytes: available - inlinePermitBytes,
			pools: { background: inlinePermitBytes, interactive: inlinePermitBytes },
		});
	}
	return Result.fail(
		limitError(
			"Sandbox memory budget cannot fit resident core processes, transient memory and a lazy run",
		),
	);
};
