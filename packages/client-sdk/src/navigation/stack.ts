import type { PluginLogicalLocation } from "@ryot-app/client-plugin-contract";
import type { ReactElement } from "react";

export const PLUGIN_SCREEN_STACK_LIMIT = 5;

export type PluginScreen = {
	readonly key: string;
	readonly index: number;
	readonly historyKey: string;
	readonly element: ReactElement;
	readonly params: Record<string, string>;
	readonly location: PluginLogicalLocation;
};

export type StackTransition = "same" | "push" | "pop" | "replace" | "reset";

export type ScreenRole = "hidden" | "active" | "beneath" | "leaving";

export type PresentedScreen = {
	readonly role: ScreenRole;
	readonly screen: PluginScreen;
};

export type Presentation =
	| { readonly kind: "idle" }
	| { readonly kind: "dragging" }
	| {
			readonly from: number;
			readonly kind: "popping";
			readonly leaving: PluginScreen;
			readonly incoming: string | undefined;
	  };

export type StackEntry = {
	readonly key: string;
	readonly index: number;
	readonly screenKey: string;
	readonly location: PluginLogicalLocation;
};

export type StackResult = {
	readonly transition: StackTransition;
	readonly stack: readonly PluginScreen[];
};

export type ResolvePluginScreen = (location: PluginLogicalLocation) => {
	readonly element: ReactElement;
	readonly params: Record<string, string>;
};

export function reconcileStack(
	stack: readonly PluginScreen[],
	incoming: StackEntry,
	resolve: ResolvePluginScreen,
): StackResult {
	const { key: historyKey, screenKey: key, ...entry } = incoming;
	const screen = {
		...entry,
		key,
		historyKey,
		...resolve(incoming.location),
	};
	const top = stack.at(-1);
	if (top === undefined) {
		return { stack: [screen], transition: "reset" };
	}
	if (incoming.key === top.historyKey) {
		return { stack: [...stack.slice(0, -1), screen], transition: "same" };
	}
	if (incoming.index === top.index) {
		return {
			stack: [...stack.slice(0, -1), screen],
			transition: incoming.screenKey === top.key ? "same" : "replace",
		};
	}
	if (incoming.index === top.index + 1) {
		const pushed = [...stack, screen];
		return {
			transition: "push",
			stack: pushed.length > PLUGIN_SCREEN_STACK_LIMIT ? pushed.slice(1) : pushed,
		};
	}
	const retained = stack.findIndex(
		(en) => en.index === incoming.index && en.historyKey === incoming.key,
	);
	if (retained !== -1 && incoming.index < top.index) {
		return { stack: stack.slice(0, retained + 1), transition: "pop" };
	}
	return { stack: [screen], transition: "reset" };
}

export function presentScreens(
	screens: readonly PluginScreen[],
	presentation: Presentation,
): readonly PresentedScreen[] {
	const active = screens.length - 1;
	const beneath = presentation.kind === "dragging" ? active - 1 : -1;
	const presented = screens.map((screen, position): PresentedScreen => {
		if (position === active) {
			return { screen, role: "active" };
		}
		return { screen, role: position === beneath ? "beneath" : "hidden" };
	});
	return presentation.kind === "popping"
		? [...presented, { role: "leaving", screen: presentation.leaving }]
		: presented;
}
