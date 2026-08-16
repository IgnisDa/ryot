import { PLUGIN_SCREEN_STACK_LIMIT } from "@ryot/contract/modules/plugins/client";
import type { PluginLogicalLocation } from "@ryot/contract/modules/plugins/client";
import type { ComponentType } from "react";

export type PluginScreen = {
	readonly key: string;
	readonly index: number;
	readonly component: ComponentType;
	readonly params: Record<string, string>;
	readonly location: PluginLogicalLocation;
};

export type StackTransition = "same" | "push" | "pop" | "replace" | "reset";

export type StackEntry = {
	readonly key: string;
	readonly index: number;
	readonly location: PluginLogicalLocation;
};

export type StackResult = {
	readonly transition: StackTransition;
	readonly stack: readonly PluginScreen[];
};

type Resolve = (location: PluginLogicalLocation) => {
	readonly component: ComponentType;
	readonly params: Record<string, string>;
};

export function reconcileStack(
	stack: readonly PluginScreen[],
	incoming: StackEntry,
	resolve: Resolve,
): StackResult {
	const screen = { ...incoming, ...resolve(incoming.location) };
	const top = stack.at(-1);
	if (top === undefined) {
		return { stack: [screen], transition: "reset" };
	}
	if (incoming.key === top.key) {
		return { stack: [...stack.slice(0, -1), screen], transition: "same" };
	}
	if (incoming.index === top.index) {
		return { stack: [...stack.slice(0, -1), screen], transition: "replace" };
	}
	if (incoming.index === top.index + 1) {
		const pushed = [...stack, screen];
		return {
			transition: "push",
			stack: pushed.length > PLUGIN_SCREEN_STACK_LIMIT ? pushed.slice(1) : pushed,
		};
	}
	const retained = stack.findIndex(
		(entry) => entry.index === incoming.index && entry.key === incoming.key,
	);
	if (retained !== -1 && incoming.index < top.index) {
		return { stack: stack.slice(0, retained + 1), transition: "pop" };
	}
	return { stack: [screen], transition: "reset" };
}
