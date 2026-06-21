import { PLUGIN_SCREEN_STACK_LIMIT } from "@ryot-app/contract/modules/plugins/client";
import type {
	PluginHeaderContent,
	PluginLogicalLocation,
} from "@ryot-app/contract/modules/plugins/client";
import type { ComponentType } from "react";

export type PluginScreen = {
	readonly key: string;
	readonly index: number;
	readonly component: ComponentType;
	readonly params: Record<string, string>;
	readonly location: PluginLogicalLocation;
	readonly header: PluginHeaderContent | null;
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
	readonly location: PluginLogicalLocation;
};

export type StackResult = {
	readonly transition: StackTransition;
	readonly stack: readonly PluginScreen[];
};

export type ResolvePluginScreen = (location: PluginLogicalLocation) => {
	readonly component: ComponentType;
	readonly params: Record<string, string>;
	readonly header: PluginHeaderContent | null;
};

export function reconcileStack(
	stack: readonly PluginScreen[],
	incoming: StackEntry,
	resolve: ResolvePluginScreen,
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
