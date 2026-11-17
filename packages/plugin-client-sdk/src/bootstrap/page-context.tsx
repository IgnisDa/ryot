import type { ClientPageContext } from "@ryot-app/plugin-client-contract";
import {
	type ContextType,
	createContext,
	type ReactNode,
	useContext,
	useSyncExternalStore,
} from "react";

const PageContext = createContext<
	| undefined
	| {
			readonly subscribe: (listener: () => void) => () => void;
			readonly getSnapshot: () => undefined | ClientPageContext;
	  }
>(undefined);

const noPageStore = {
	getSnapshot: () => undefined,
	subscribe: () => () => undefined,
} satisfies NonNullable<ContextType<typeof PageContext>>;

export const PageStoreProvider = ({
	store,
	children,
}: {
	readonly children: ReactNode;
	readonly store: NonNullable<ContextType<typeof PageContext>>;
}) => <PageContext.Provider value={store}>{children}</PageContext.Provider>;

/** The mounted page's context, or `undefined` outside a mounted page. */
export const useOptionalPageContext = () => {
	const store = useContext(PageContext) ?? noPageStore;
	return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
};

export const usePageContext = () => {
	const context = useOptionalPageContext();
	if (!context) {
		throw new Error("Page context is only available in a mounted page");
	}
	return context;
};
