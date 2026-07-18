import { WorkflowEngine } from "effect/unstable/workflow";

declare const Effect: {
	provideService: (service: unknown, value: unknown) => unknown;
	serviceOption: (service: unknown) => unknown;
};
declare const value: unknown;

export type Engine = WorkflowEngine;
export type Instance = WorkflowEngine.WorkflowInstance;
export const initial = WorkflowEngine.WorkflowInstance.initial;
export const key = WorkflowEngine.WorkflowInstance.key;
export const service = Effect.provideService(WorkflowEngine.WorkflowInstance, value);
export const direct = Effect.serviceOption(WorkflowEngine.WorkflowInstance);
export const shadowed = (WorkflowInstance: string) => WorkflowInstance;
