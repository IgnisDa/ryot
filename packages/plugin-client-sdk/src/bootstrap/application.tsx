import {
	CLIENT_BRIDGE_BOOTSTRAP,
	CLIENT_BRIDGE_NONCE_ELEMENT_ID,
	CLIENT_COMPOSITION_METADATA_ELEMENT_ID,
	CLIENT_PAGE_ROOT_ELEMENT_ID,
	ClientCompositionMetadata,
	type ClientPageContext,
	KERNEL_SHORTCUTS,
	type PluginBridgeBootstrapProof,
	PluginBridgeInit,
} from "@ryot-app/plugin-client-contract";
import { useShortcut } from "@ryot-app/plugin-ui-sdk";
import { Result, Schema } from "effect";
import { type ComponentType, useSyncExternalStore } from "react";
import { createRoot, type Root } from "react-dom/client";

import {
	type AnalyticsSectionRegistration,
	AnalyticsSectionsProvider,
} from "../analytics/sections";
import { createPluginRuntime } from "../bridge/session";
import type { RyotClient } from "../client/client";
import { PluginI18nProvider } from "../i18n/provider";
import {
	createClientPageRouteResolver,
	createPluginRouteResolver,
	PluginRouter,
	type PluginRouterDefinition,
} from "../navigation/routing";
import type { ResolvePluginScreen } from "../navigation/stack";
import { createPluginNavigationStore } from "../navigation/store";
import type { PluginRouterNavigation } from "../navigation/store";
import {
	type EntityPresentationRegistration,
	EntityPresentationRegistryProvider,
} from "../presentations/entity-results";
import { RyotProvider } from "../queries/provider";
import { makeRyotPluginRuntime, type RyotPluginRuntime } from "../runtime/runtime";
import { PageStoreProvider } from "./page-context";

type ClientPluginDefinition = PluginRouterDefinition;

const decodeCompositionMetadata = Schema.decodeUnknownResult(
	Schema.fromJsonString(ClientCompositionMetadata),
);
const decodeNonce = Schema.decodeUnknownResult(Schema.fromJsonString(Schema.String));
const decodeInit = Schema.decodeUnknownResult(PluginBridgeInit);

const offerParentPort = (port: MessagePort) => {
	window.parent.postMessage(CLIENT_BRIDGE_BOOTSTRAP, "*", [port]);
};

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
	useShortcut(KERNEL_SHORTCUTS.assistant, () => runtime.forwardKernelShortcut("assistant"));
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
	createResolver: (page: undefined | ClientPageContext) => ResolvePluginScreen,
	registrations: readonly EntityPresentationRegistration[],
	analyticsSections: readonly AnalyticsSectionRegistration[],
	createRuntime: (client: RyotClient, navigation: PluginRouterNavigation) => RyotPluginRuntime,
	offerPort: (port: MessagePort) => void,
) => {
	let root: Root | undefined;
	const listener = new AbortController();
	let bootstrapPort: undefined | MessagePort;
	let sdkRuntime: undefined | RyotPluginRuntime;
	let sessionListener: undefined | AbortController;
	let runtime: undefined | ReturnType<typeof createPluginRuntime>;
	let currentPage: undefined | ClientPageContext;
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
			<PluginI18nProvider store={runtime.locale}>
				<RyotProvider key={documentKey} runtime={sdkRuntime}>
					<AnalyticsSectionsProvider registrations={analyticsSections}>
						<EntityPresentationRegistryProvider registrations={registrations}>
							<PageStoreProvider store={pageStore}>
								<KernelShortcutForwarder runtime={runtime} />
								<PluginRouter />
							</PageStoreProvider>
						</EntityPresentationRegistryProvider>
					</AnalyticsSectionsProvider>
				</RyotProvider>
			</PluginI18nProvider>,
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
		bootstrapPort?.close();
		bootstrapPort = undefined;
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
	const metadata = decodeCompositionMetadata(metadataElement?.textContent ?? "");
	const nonce = decodeNonce(
		document.getElementById(CLIENT_BRIDGE_NONCE_ELEMENT_ID)?.textContent ?? "",
	);
	if (
		Result.isFailure(metadata) ||
		Result.isFailure(nonce) ||
		!document.getElementById(CLIENT_PAGE_ROOT_ELEMENT_ID)
	) {
		return { dispose };
	}

	const compositionMetadata = metadata.success;
	const { port1: port, port2: parentPort } = new MessageChannel();
	bootstrapPort = port;
	port.addEventListener(
		"message",
		({ data }: MessageEvent<unknown>) => {
			const decoded = decodeInit(data);
			if (
				Result.isFailure(decoded) ||
				decoded.success.compositionHash !== compositionMetadata.hash
			) {
				dispose();
				return;
			}

			listener.abort();
			bootstrapPort = undefined;
			sessionListener = new window.AbortController();
			window.addEventListener("pagehide", dispose, { signal: sessionListener.signal });
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
					const activeSdkRuntime = sdkRuntime;
					sdkRuntime = undefined;
					void activeSdkRuntime?.dispose();
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
			try {
				sdkRuntime = createRuntime(pluginRuntime.client, pluginRuntime.navigation);
			} catch {
				pluginRuntime.fatal();
				return;
			}
			runtime = pluginRuntime;
		},
		{ signal: listener.signal },
	);
	port.addEventListener("messageerror", dispose, { signal: listener.signal });
	port.start();
	try {
		offerPort(parentPort);
		port.postMessage({
			nonce: nonce.success,
			composition: compositionMetadata,
		} satisfies PluginBridgeBootstrapProof);
	} catch {
		parentPort.close();
		dispose();
	}
	return { dispose };
};

type ClientPluginOptions = {
	readonly entityPresentations?: readonly EntityPresentationRegistration[];
};
type ClientPageOptions = ClientPluginOptions & {
	readonly analyticsSections?: readonly AnalyticsSectionRegistration[];
};

export const createClientBootstrap = (
	createRuntime: (client: RyotClient, navigation: PluginRouterNavigation) => RyotPluginRuntime,
) => ({
	bootstrapClientPlugin: (
		definition: ClientPluginDefinition,
		options: ClientPluginOptions,
		offerPort: (port: MessagePort) => void,
	) =>
		bootstrapClientApplication(
			() => createPluginRouteResolver(definition),
			options.entityPresentations ?? [],
			[],
			createRuntime,
			offerPort,
		),

	bootstrapClientPage: (
		component: ComponentType,
		options: ClientPageOptions,
		offerPort: (port: MessagePort) => void,
	) =>
		bootstrapClientApplication(
			(page) =>
				page === undefined
					? createPluginRouteResolver({ home: { component } })
					: createClientPageRouteResolver(component, page),
			options.entityPresentations ?? [],
			options.analyticsSections ?? [],
			createRuntime,
			offerPort,
		),
});

const browser = createClientBootstrap(makeRyotPluginRuntime);

export const bootstrapClientPlugin = (
	definition: ClientPluginDefinition,
	options: ClientPluginOptions = {},
) => browser.bootstrapClientPlugin(definition, options, offerParentPort);

export const bootstrapClientPage = (component: ComponentType, options: ClientPageOptions = {}) =>
	browser.bootstrapClientPage(component, options, offerParentPort);
