import type { PluginBridgeProviderSearchScreen } from "@ryot-app/client-plugin-contract";
import type { PreparedClientPage } from "@ryot-app/contract/modules/client-pages/schemas";
import {
	createContext,
	useCallback,
	useContext,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
	type ReactNode,
} from "react";

export type ClientPageDocument = {
	readonly title: string;
	readonly inert?: boolean;
	readonly prepared: PreparedClientPage;
	readonly onProviderSearch?: (request: PluginBridgeProviderSearchScreen) => void;
};

type ClientPageDocumentState = {
	readonly document: ClientPageDocument | null;
	readonly clear: () => void;
	readonly publish: (document: ClientPageDocument) => void;
};

const ClientPageDocumentContext = createContext<ClientPageDocumentState | undefined>(undefined);

const useDocumentState = () => {
	const state = useContext(ClientPageDocumentContext);
	if (state === undefined) {
		throw new Error("Client page documents require ClientPageDocumentProvider");
	}
	return state;
};

export function ClientPageDocumentProvider(props: { readonly children: ReactNode }) {
	const [document, setDocument] = useState<ClientPageDocument | null>(null);
	const clear = useCallback(() => setDocument(null), []);
	const state = useMemo<ClientPageDocumentState>(
		() => ({ clear, document, publish: setDocument }),
		[clear, document],
	);
	return <ClientPageDocumentContext value={state}>{props.children}</ClientPageDocumentContext>;
}

export function useClientPageDocument(document: ClientPageDocument) {
	const { publish } = useDocumentState();
	const latest = useRef(document);
	latest.current = document;
	const published = useMemo<ClientPageDocument>(
		() => ({
			title: document.title,
			inert: document.inert,
			prepared: document.prepared,
			onProviderSearch: (request) => latest.current.onProviderSearch?.(request),
		}),
		[document.inert, document.prepared, document.title],
	);
	useLayoutEffect(() => publish(published), [publish, published]);
}

export function useClearClientPageDocument() {
	const { clear } = useDocumentState();
	useLayoutEffect(() => clear(), [clear]);
}

export const usePublishedClientPageDocument = () => useDocumentState().document;

export const useHasPublishedClientPageDocument = () => useDocumentState().document !== null;
