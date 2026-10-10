import { SandboxRunError } from "@ryot-app/contract/errors";
import type { ExecutionLane } from "@ryot-app/contract/modules/automations/lifecycle";
import { Option, Result } from "effect";

import { MiB, SANDBOX_LIMITS } from "./limits";
import { SIDECAR_PROTOCOL_LIMITS } from "./sidecar-protocol";
import { SANDBOX_TRANSIENT_MEMORY, sandboxTransientPermitBytes } from "./transient-memory";

export const processBytes = SANDBOX_LIMITS.sidecar.rssOverheadBytes;
const residentBytes = 2 * processBytes;
const defaultMemoryBudgetBytes = 1536 * MiB;
export const isolateBytes =
	SANDBOX_LIMITS.isolate.heapBytes +
	SANDBOX_LIMITS.isolate.externalBytes +
	SANDBOX_LIMITS.sidecar.heapHeadroomBytes;
const fixedStackAndStagingBytes = 15 * MiB;
const runStartBytes = 28 * MiB;
const inboundFrameBytes = 4 * MiB;
const rustEncodingBytes = 5 * MiB;
// Isolate, fixed stack and staging, run start, then per outstanding host call its inbound frame,
// Rust encoding and Rust result delivery, then the done text Rust holds before disposal.
export const runBytes =
	isolateBytes +
	fixedStackAndStagingBytes +
	runStartBytes +
	SANDBOX_LIMITS.bridge.outstandingHostCalls *
		(inboundFrameBytes + rustEncodingBytes + SIDECAR_PROTOCOL_LIMITS.messageBytes.hostResult) +
	SIDECAR_PROTOCOL_LIMITS.messageBytes.done;
const inlinePermitBytes = sandboxTransientPermitBytes(
	"inlineBatch",
	SANDBOX_LIMITS.bridge.requestBytes,
);
export const interactiveHeadroomBytes = runBytes + processBytes;

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
// Shared mode has one inline-sized pool for budgets too small for lane mode.
export const sandboxMemoryPlan = (
	configuredMiB: Option.Option<number>,
	effectiveMemory: number,
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
	if (available >= 2 * inlinePermitBytes + 2 * interactiveHeadroomBytes) {
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
