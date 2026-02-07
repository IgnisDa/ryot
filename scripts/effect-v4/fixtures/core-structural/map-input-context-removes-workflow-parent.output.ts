import { Context, Effect } from "effect";
import { WorkflowEngine } from "effect/unstable/workflow";
import {
	Context as SandboxContext,
	Effect as SandboxEffect,
} from "@ryot/sandbox-sdk/effect";

const omitWorkflowParent = <R>(context: Context.Context<R>) => {
	const services = new Map(context.mapUnsafe);
	services.delete(WorkflowEngine.WorkflowInstance.key);
	return Context.makeUnsafe<R>(services);
};

const readContextMap = <R>(context: SandboxContext.Context<R>) => {
	const local: SandboxContext.Context<R> = context;
	return local.mapUnsafe;
};

// Preserve surrounding comments and generic declarations.
export const withoutWorkflowParent = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
	Effect.contextWith(
        (context: Context.Context<R>) => Effect.setContext(effect, omitWorkflowParent(context))
    );

export const withoutMemberContext = <A, E, R>(state: {
	readonly effect: SandboxEffect.Effect<A, E, R>;
}) =>
	SandboxEffect.contextWith(// Preserve callback comments and its typed parameter.
    (context: Context.Context<R>) => SandboxEffect.setContext(state.effect, omitWorkflowParent(context)));

void readContextMap;
