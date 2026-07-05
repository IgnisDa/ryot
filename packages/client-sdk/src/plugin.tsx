import {
	CLIENT_ARTIFACT_METADATA_ELEMENT_ID,
	CLIENT_ARTIFACT_ROOT_ELEMENT_ID,
	KERNEL_SHORTCUTS,
	PluginBridgeInit,
	PluginClientArtifactMetadata,
	type ClientPageContext,
} from "@ryot-app/client-plugin-contract";
import { useShortcut } from "@ryot-app/client-ui-sdk";
import { Result, Schema } from "effect";
import { createContext, useContext, useSyncExternalStore, type ComponentType } from "react";
import { createRoot, type Root } from "react-dom/client";

import { createPluginNavigationStore } from "./navigation/store";
import { RyotProvider } from "./react";
import { createPluginRouteResolver, PluginRouter, type PluginRouterDefinition } from "./routing";
import { createPluginRuntime } from "./runtime";

type ClientPluginDefinition = PluginRouterDefinition;

const PageContext = createContext<ClientPageContext | undefined>(undefined);

export const usePageContext = () => {
	const context = useContext(PageContext);
	if (!context) {
		throw new Error("Page context is only available in a saved-view page");
	}
	return context;
};

const decodeArtifactMetadata = Schema.decodeUnknownResult(
	Schema.fromJsonString(PluginClientArtifactMetadata),
);

const KernelShortcutForwarder = ({
	runtime,
}: {
	runtime: ReturnType<typeof createPluginRuntime>;
}) => {
	const { compact } = useSyncExternalStore(
		runtime.navigation.subscribe,
		runtime.navigation.getSnapshot,
		runtime.navigation.getSnapshot,
	);
	useShortcut(KERNEL_SHORTCUTS.commandCenter, () =>
		runtime.forwardKernelShortcut("command-center"),
	);
	useShortcut(
		KERNEL_SHORTCUTS.workspaceSwitcher,
		() => runtime.forwardKernelShortcut("workspace-switcher"),
		{ enabled: !compact },
	);
	return null;
};

const bootstrapClientApplication = (definition: ClientPluginDefinition) => {
	const navigationStore = createPluginNavigationStore(createPluginRouteResolver(definition));
	const listener = new AbortController();
	let root: Root | undefined;
	let runtime: ReturnType<typeof createPluginRuntime> | undefined;
	let sessionListener: AbortController | undefined;
	const handleFatalEvent = (event: Event) => {
		event.preventDefault();
		runtime?.fatal();
	};
	const mount = () => {
		if (!root && runtime) {
			const rootElement = document.getElementById(CLIENT_ARTIFACT_ROOT_ELEMENT_ID);
			if (!rootElement) {
				return;
			}
			try {
				root = createRoot(rootElement, {
					onUncaughtError: () => runtime?.fatal(),
				});
				root.render(
					<RyotProvider client={runtime.client}>
						<PageContext.Provider value={runtime.page}>
							<KernelShortcutForwarder runtime={runtime} />
							<PluginRouter navigation={runtime.navigation} />
						</PageContext.Provider>
					</RyotProvider>,
				);
			} catch {
				runtime.fatal();
			}
		}
	};
	const unmount = () => {
		root?.unmount();
		root = undefined;
	};
	const dispose = () => {
		listener.abort();
		sessionListener?.abort();
		sessionListener = undefined;
		const activeRuntime = runtime;
		runtime = undefined;
		activeRuntime?.dispose();
		unmount();
	};
	const metadataElement = document.getElementById(CLIENT_ARTIFACT_METADATA_ELEMENT_ID);
	const metadata = decodeArtifactMetadata(metadataElement?.textContent ?? "");
	if (Result.isFailure(metadata)) {
		return { dispose };
	}

	const artifactMetadata = metadata.success;
	window.addEventListener(
		"message",
		(event) => {
			if (runtime || event.source !== window.parent || event.ports.length !== 1) {
				return;
			}
			const decoded = Schema.decodeUnknownResult(PluginBridgeInit)(event.data);
			if (Result.isFailure(decoded) || decoded.success.artifactHash !== artifactMetadata.hash) {
				return;
			}
			const port = event.ports[0];
			if (!document.getElementById(CLIENT_ARTIFACT_ROOT_ELEMENT_ID) || !port) {
				return;
			}

			listener.abort();
			sessionListener = new AbortController();
			window.addEventListener("error", handleFatalEvent, { signal: sessionListener.signal });
			window.addEventListener("unhandledrejection", handleFatalEvent, {
				signal: sessionListener.signal,
			});
			const init = decoded.success;
			runtime = createPluginRuntime(
				port,
				init,
				artifactMetadata,
				document.documentElement,
				navigationStore,
				mount,
				() => {
					sessionListener?.abort();
					sessionListener = undefined;
					unmount();
				},
			);
		},
		{ signal: listener.signal },
	);
	return { dispose };
};

export const bootstrapClientPlugin = (definition: ClientPluginDefinition) =>
	bootstrapClientApplication(definition);

export const bootstrapClientPage = (component: ComponentType) =>
	bootstrapClientApplication({ home: { component } });

export {
	PluginLink,
	usePluginTitle,
	usePluginParams,
	usePluginSearch,
	useRyotViewport,
	usePluginLocation,
	type EntityRendererProps,
	type PluginEntityDefinition,
	type PluginHomeDefinition,
	type PluginRouteDefinition,
	type PluginRouterDefinition,
} from "./routing";
