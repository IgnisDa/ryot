import type { AssetLocator } from "@ryot/contract/modules/uploads/schemas";
import { createContext, type ReactNode, useContext, useMemo } from "react";

import { resolveAssetUrl } from "./managed-assets";

const ManagedAssetUrlsContext = createContext<ReadonlyMap<string, string>>(new Map());

export function ManagedAssetUrls(props: {
	readonly urls: ReadonlyMap<string, string>;
	readonly children: ReactNode;
}) {
	const parentUrls = useContext(ManagedAssetUrlsContext);
	const urls = useMemo(() => new Map([...parentUrls, ...props.urls]), [parentUrls, props.urls]);
	return (
		<ManagedAssetUrlsContext.Provider value={urls}>
			{props.children}
		</ManagedAssetUrlsContext.Provider>
	);
}

export function useManagedAssetUrl(asset: AssetLocator | undefined) {
	const urls = useContext(ManagedAssetUrlsContext);
	return asset === undefined ? undefined : resolveAssetUrl(asset, urls);
}
