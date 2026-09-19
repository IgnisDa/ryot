import {
	CLIENT_COMPOSITION_METADATA_ELEMENT_ID,
	CLIENT_PAGE_ROOT_ELEMENT_ID,
	CLIENT_BRIDGE_BOOTSTRAP_READY,
	KERNEL_SHORTCUTS,
	PluginBridgeInit,
	PluginClientArtifactMetadata,
	type ClientPageContext,
} from "@ryot-app/client-plugin-contract";
import { useShortcut } from "@ryot-app/client-ui-sdk";
import { Result, Schema } from "effect";
import {
	createContext,
	useContext,
	useSyncExternalStore,
	type ComponentType,
	type ContextType,
	type ReactNode,
} from "react";
import { createRoot, type Root } from "react-dom/client";

import {
	EntityPresentationRegistryProvider,
	type EntityPresentationRegistration,
} from "./entity-results";
import type { ResolvePluginScreen } from "./navigation/stack";
import { createPluginNavigationStore } from "./navigation/store";
import { RyotProvider, usePageRefresh } from "./react";
import {
	createClientPageRouteResolver,
	createPluginRouteResolver,
	PluginRouter,
	type PluginRouterDefinition,
} from "./routing";
import { createPluginRuntime } from "./runtime";
import { createBootstrapRyotRuntime, type RyotPluginRuntime } from "./schedule";

export { loadStylesheet } from "./stylesheets";

type ClientPluginDefinition = PluginRouterDefinition;

const PageContext = createContext<
	| {
			readonly getSnapshot: () => ClientPageContext | undefined;
			readonly subscribe: (listener: () => void) => () => void;
	  }
	| undefined
>(undefined);

const PageStoreProvider = ({
	store,
	children,
}: {
	readonly store: NonNullable<ContextType<typeof PageContext>>;
	readonly children: ReactNode;
}) => <PageContext.Provider value={store}>{children}</PageContext.Provider>;

export const usePageContext = () => {
	const store = useContext(PageContext);
	if (!store) {
		throw new Error("Page context is only available in a mounted page");
	}
	const context = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
	if (!context) {
		throw new Error("Page context is only available in a mounted page");
	}
	return context;
};

export { usePageRefresh };

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
	let currentPage: ClientPageContext | undefined;
	let documentKey = "";
	const pageListeners = new Set<() => void>();
	const pageStore = {
		getSnapshot: () => currentPage,
		subscribe: (notify: () => void) => {
			pageListeners.add(notify);
			return () => {
				pageListeners.delete(notify);
			};
		},
	};
	const renderPage = () => {
		if (!root || !runtime || !sdkRuntime) {
			return;
		}
		root.render(
			<RyotProvider runtime={sdkRuntime}>
				<EntityPresentationRegistryProvider registrations={registrations}>
					<PageStoreProvider store={pageStore}>
						<KernelShortcutForwarder runtime={runtime} />
						<PluginRouter key={documentKey} />
					</PageStoreProvider>
				</EntityPresentationRegistryProvider>
			</RyotProvider>,
		);
	};
	const handleFatalEvent = (event: Event) => {
		event.preventDefault();
		runtime?.fatal();
	};
	const mount = () => {
		if (!root && runtime && sdkRuntime) {
			const rootElement = document.getElementById(CLIENT_PAGE_ROOT_ELEMENT_ID);
			if (!rootElement) {
				return;
			}
			try {
				root = createRoot(rootElement, { onUncaughtError: () => runtime?.fatal() });
				renderPage();
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
	const metadataElement = document.getElementById(CLIENT_COMPOSITION_METADATA_ELEMENT_ID);
	const metadata = decodeArtifactMetadata(metadataElement?.textContent ?? "");
	if (Result.isFailure(metadata)) {
		return { dispose };
	}

	const compositionMetadata = metadata.success;
	window.addEventListener(
		"message",
		(event) => {
			if (runtime || event.source !== window.parent || event.ports.length !== 1) {
				return;
			}
			const decoded = Schema.decodeUnknownResult(PluginBridgeInit)(event.data);
			if (
				Result.isFailure(decoded) ||
				decoded.success.compositionHash !== compositionMetadata.hash
			) {
				return;
			}
			const port = event.ports[0];
			if (!document.getElementById(CLIENT_PAGE_ROOT_ELEMENT_ID) || !port) {
				return;
			}

			listener.abort();
			sessionListener = new AbortController();
			window.addEventListener("error", handleFatalEvent, { signal: sessionListener.signal });
			window.addEventListener("unhandledrejection", handleFatalEvent, {
				signal: sessionListener.signal,
			});
			const init = decoded.success;
			currentPage = init.page;
			documentKey = init.documentKey;
			const navigationStore = createPluginNavigationStore(createResolver(init.page));
			const pluginRuntime = createPluginRuntime(
				port,
				init,
				compositionMetadata,
				document.documentElement,
				navigationStore,
				mount,
				() => {
					sessionListener?.abort();
					sessionListener = undefined;
					unmount();
				},
				(nextKey, page) => {
					currentPage = page;
					documentKey = nextKey;
					navigationStore.replaceDocument(createResolver(page));
					for (const notify of pageListeners) {
						notify();
					}
					renderPage();
				},
			);
			sdkRuntime = createBootstrapRyotRuntime(pluginRuntime.client, pluginRuntime.navigation);
			runtime = pluginRuntime;
		},
		{ signal: listener.signal },
	);
	window.parent.postMessage({ type: CLIENT_BRIDGE_BOOTSTRAP_READY }, "*");
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
	usePageShortcut,
	usePluginParams,
	usePluginSearch,
	useRyotViewport,
	usePluginChrome,
	usePluginLocation,
	usePluginScreenSurface,
	type EntityRendererProps,
	type PluginEntityDefinition,
	type PluginHomeDefinition,
	type PluginRouteDefinition,
	type PluginRouterDefinition,
} from "./routing";
