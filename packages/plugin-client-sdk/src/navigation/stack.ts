import type { PluginLogicalLocation } from "@ryot-app/plugin-client-contract";
import type { ViewEntry } from "@ryot-app/plugin-ui-sdk";
import type { ReactElement } from "react";

export const PLUGIN_SCREEN_STACK_LIMIT = 5;

export type ScreenRole = "hidden" | "active" | "beneath" | "leaving";

export type StackTransition = "pop" | "same" | "push" | "reset" | "replace";

export type PresentedScreen = { readonly role: ScreenRole; readonly screen: PluginScreen };

export type StackResult = {
	readonly transition: StackTransition;
	readonly stack: readonly PluginScreen[];
};

export type StackEntry = {
	readonly key: string;
	readonly index: number;
	readonly location: PluginLogicalLocation;
};

export type ResolvePluginScreen = (location: PluginLogicalLocation) => {
	readonly element: ReactElement;
	readonly params: Record<string, string>;
};

export type Presentation =
	| { readonly kind: "idle" }
	| { readonly kind: "dragging" }
	| {
			readonly kind: "popping";
			readonly leaving: PluginScreen;
			readonly incoming: string | undefined;
	  };

export type PluginScreen = {
	readonly key: string;
	readonly index: number;
	readonly identity: string;
	readonly element: ReactElement;
	readonly params: Record<string, string>;
	readonly location: PluginLogicalLocation;
};

const screenIdentities = new Map<ReactElement["type"], string>();

/** The screen definition a location renders: locations rendered by one component are one screen. */
const screenIdentity = ({ type }: ReactElement) => {
	const known = screenIdentities.get(type);
	if (known !== undefined) {
		return known;
	}
	const identity = `screen-${String(screenIdentities.size)}`;
	screenIdentities.set(type, identity);
	return identity;
};

/** A screen is one history entry showing one content identity; either changing is a new view. */
export const screenView = (screen: PluginScreen): ViewEntry => ({
	key: screen.key,
	identity: `${screen.key}\n${screen.identity}`,
});

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

export function reconcileStack(
	stack: readonly PluginScreen[],
	incoming: StackEntry,
	resolve: ResolvePluginScreen,
): StackResult {
	const resolved = resolve(incoming.location);
	const screen = { ...incoming, ...resolved, identity: screenIdentity(resolved.element) };
	const top = stack.at(-1);
	if (top === undefined) {
		return { stack: [screen], transition: "reset" };
	}
	if (incoming.key === top.key || incoming.index === top.index) {
		return {
			stack: [...stack.slice(0, -1), screen],
			transition: incoming.key === top.key && screen.identity === top.identity ? "same" : "replace",
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
		(entry) => entry.index === incoming.index && entry.key === incoming.key,
	);
	if (retained !== -1 && incoming.index < top.index) {
		return { transition: "pop", stack: stack.slice(0, retained + 1) };
	}
	return { stack: [screen], transition: "reset" };
}
