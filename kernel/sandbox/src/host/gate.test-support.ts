import { Effect, Layer, Option } from "effect";

import { SandboxSidecarAdmission } from "./admission";
import type { SandboxFileAccess } from "./file-access";
import { SandboxHostCallGate } from "./host-call-gate";
import { makeSandboxHostConfigLayer } from "./host.test-support";

const admissionConfig = (memoryBudgetMiB: number, workerConcurrency = 2) =>
	makeSandboxHostConfigLayer({ workerConcurrency, memoryBudgetMiB: Option.some(memoryBudgetMiB) });

export const idleBytes = (admission: SandboxSidecarAdmission["Service"]) =>
	admission.plan.budget - admission.plan.dynamicBytes;

export const sandboxAdmissionLayer = (memoryBudgetMiB: number) =>
	Layer.effect(SandboxSidecarAdmission, SandboxSidecarAdmission.make).pipe(
		Layer.provide(admissionConfig(memoryBudgetMiB)),
	);

export const makeSandboxAdmission = (memoryBudgetMiB: number, workerConcurrency?: number) =>
	Layer.build(admissionConfig(memoryBudgetMiB, workerConcurrency)).pipe(
		Effect.flatMap((context) => SandboxSidecarAdmission.make.pipe(Effect.provideContext(context))),
	);

export const sandboxGateLayer = (memoryBudgetMiB = 1904) =>
	SandboxHostCallGate.layer.pipe(
		Layer.provideMerge(
			SandboxSidecarAdmission.layer.pipe(Layer.provide(admissionConfig(memoryBudgetMiB))),
		),
	);

export const makeFiles = (
	artifactReadRange: SandboxFileAccess["artifactReadRange"] = (args) =>
		Effect.succeed({ size: 0, data: "", offset: args.offset }),
	scratchWrite: SandboxFileAccess["scratchWrite"] = () => Effect.succeed(null),
): SandboxFileAccess => ({
	scratchWrite,
	artifactReadRange,
	harvest: () => Effect.succeed(null),
	filesystem: { scratch: false, artifact: false, namedArtifacts: [] },
});
