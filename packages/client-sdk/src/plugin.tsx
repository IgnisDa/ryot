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

import {
	EntityPresentationRegistryProvider,
	type EntityPresentationRegistration,
} from "./entity-results";
import type { ResolvePluginScreen } from "./navigation/stack";
import { createPluginNavigationStore } from "./navigation/store";
import { RyotProvider } from "./react";
import {
	createClientPageRouteResolver,
	createPluginRouteResolver,
	PluginRouter,
	type PluginRouterDefinition,
} from "./routing";
import { createPluginRuntime } from "./runtime";
import { createBootstrapRyotRuntime, type RyotPluginRuntime } from "./schedule";

type ClientPluginDefinition = PluginRouterDefinition;

const PageContext = createContext<ClientPageContext | undefined>(undefined);

export const usePageContext = () => {
	const context = useContext(PageContext);
	if (!context) {
		throw new Error("Page context is only available in a mounted page");
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

const bootstrapClientApplication = (
	createResolver: (page: ClientPageContext | undefined) => ResolvePluginScreen,
	registrations: readonly EntityPresentationRegistration[],
) => {
	let root: Root | undefined;
	const listener = new AbortController();
	let sdkRuntime: RyotPluginRuntime | undefined;
	let sessionListener: AbortController | undefined;
	let runtime: ReturnType<typeof createPluginRuntime> | undefined;
	const handleFatalEvent = (event: Event) => {
		event.preventDefault();
		runtime?.fatal();
	};
	const mount = () => {
		if (!root && runtime && sdkRuntime) {
			const rootElement = document.getElementById(CLIENT_ARTIFACT_ROOT_ELEMENT_ID);
			if (!rootElement) {
				return;
			}
			try {
				root = createRoot(rootElement, {
					onUncaughtError: () => runtime?.fatal(),
				});
				root.render(
					<RyotProvider runtime={sdkRuntime}>
						<EntityPresentationRegistryProvider registrations={registrations}>
							<PageContext.Provider value={runtime.page}>
								<KernelShortcutForwarder runtime={runtime} />
								<PluginRouter />
							</PageContext.Provider>
						</EntityPresentationRegistryProvider>
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
		const activeSdkRuntime = sdkRuntime;
		runtime = undefined;
		sdkRuntime = undefined;
		activeRuntime?.dispose();
		unmount();
		void activeSdkRuntime?.dispose();
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
			const navigationStore = createPluginNavigationStore(createResolver(init.page));
			const pluginRuntime = createPluginRuntime(
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
			sdkRuntime = createBootstrapRyotRuntime(pluginRuntime.client, pluginRuntime.navigation);
			runtime = pluginRuntime;
		},
		{ signal: listener.signal },
	);
	return { dispose };
};

type ClientApplicationOptions = {
	readonly entityPresentations?: readonly EntityPresentationRegistration[];
};

export const bootstrapClientPlugin = (
	definition: ClientPluginDefinition,
	options: ClientApplicationOptions = {},
) =>
	bootstrapClientApplication(
		() => createPluginRouteResolver(definition),
		options.entityPresentations ?? [],
	);

export const bootstrapClientPage = (
	component: ComponentType,
	options: ClientApplicationOptions = {},
) =>
	bootstrapClientApplication(
		(page) =>
			page === undefined
				? createPluginRouteResolver({ home: { component } })
				: createClientPageRouteResolver(component, page),
		options.entityPresentations ?? [],
	);

export {
	EntityResults,
	defineEntityPresentation,
	type EntityReference,
	type EntityResultsLayout,
	type EntityPresentationLoader,
	type EntityPresentationDefinition,
	type EntityPresentationComponentProps,
} from "./entity-results";

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
