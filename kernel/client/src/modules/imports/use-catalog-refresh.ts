import { useEffect, useEffectEvent, useRef } from "react";

import { usePluginCatalog } from "#/modules/plugins/catalog/provider";

export function useIngestionCatalogRefresh(refetch: () => void) {
	const { invalidationRevision } = usePluginCatalog();
	const previous = useRef(invalidationRevision);
	const refresh = useEffectEvent(refetch);
	useEffect(() => {
		if (previous.current !== invalidationRevision) {
			previous.current = invalidationRevision;
			refresh();
		}
	}, [invalidationRevision]);
}
