import { Effect, Layer, Option } from "effect";

import { makeAppConfigLayer } from "#lib/test-utils/effect";

import { SandboxHostCallGate } from "./host-call-gate";
import { SandboxSidecarAdmission } from "./sidecar-admission";

const admissionConfig = (memoryBudgetMiB: number, workerConcurrency = 2) =>
	makeAppConfigLayer({
		sandbox: { workerConcurrency, memoryBudgetMiB: Option.some(memoryBudgetMiB) },
	});

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
