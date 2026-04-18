import { WorkflowEngine, WorkflowInstance } from "@effect/workflow/WorkflowEngine";

declare const Effect: {
	provideService: (service: unknown, value: unknown) => unknown;
	serviceOption: (service: unknown) => unknown;
};
declare const value: unknown;

export type Engine = WorkflowEngine;
export type Instance = WorkflowInstance;
export const initial = WorkflowInstance.initial;
export const key = WorkflowInstance.key;
export const service = Effect.provideService(WorkflowInstance, value);
export const direct = Effect.serviceOption(WorkflowInstance);
export const shadowed = (WorkflowInstance: string) => WorkflowInstance;
