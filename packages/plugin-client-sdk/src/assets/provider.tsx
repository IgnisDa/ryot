import type { AssetLocator, ManagedAssetLocator } from "@ryot-app/contract/modules/assets/schemas";
import {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useEffectEvent,
	useMemo,
	useState,
	type ReactNode,
} from "react";

import type { ManagedAssetResolution } from "../client/adapter";
import { createRyotQuery } from "../queries/definitions";
import { useRyotQuery } from "../queries/hooks";
import { useRyotSchedule } from "../queries/provider";
import { canonicalAssetBatchKey, managedAssetBatches, managedAssetKey } from "./keys";

const ASSET_REFRESH_LEAD_MS = 60_000;

const useStableManagedAssetLocators = (locators: readonly ManagedAssetLocator[]) => {
	const key = canonicalAssetBatchKey(locators);
	const [stable, setStable] = useState({ key, locators });
	if (stable.key !== key) {
		setStable({ key, locators });
		return locators;
	}
	return stable.locators;
};

const managedAssetBatchQuery = createRyotQuery<string, readonly ManagedAssetResolution[]>(
	({ input, client }) => {
		// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- The key is created only from schema-validated locator values.
		const locators = JSON.parse(input) as readonly ManagedAssetLocator[];
		return client.assets.resolve(locators);
	},
	{ cancelOnUnmount: true },
);

const ManagedAssetUrlsContext = createContext<ReadonlyMap<string, string>>(new Map());

function ManagedAssetBatchResolver(props: {
	readonly batchKey: string;
	readonly onResolved: (batchKey: string, urls: ReadonlyMap<string, string>) => void;
}) {
	const schedule = useRyotSchedule();
	const result = useRyotQuery(managedAssetBatchQuery, props.batchKey);
	const refresh = useEffectEvent(() => result.refetch());
	const publish = useEffectEvent((urls: ReadonlyMap<string, string>) =>
		props.onResolved(props.batchKey, urls),
	);
	const resolutions = result.data;

	useEffect(() => {
		publish(
			new Map(
				(resolutions ?? []).map((resolution) => [
					managedAssetKey(resolution.asset),
					resolution.url,
				]),
			),
		);
	}, [resolutions]);

	useEffect(() => {
		if (resolutions === undefined || resolutions.length === 0) {
			return undefined;
		}
		const earliestExpiry = Math.min(
			...resolutions.map((resolution) => Date.parse(resolution.expiresAt)),
		);
		return schedule.after(
			Math.max(ASSET_REFRESH_LEAD_MS, earliestExpiry - ASSET_REFRESH_LEAD_MS - schedule.now()),
			refresh,
		);
	}, [resolutions, schedule]);

	return null;
}

export function ManagedAssetProvider(props: {
	readonly assets: readonly ManagedAssetLocator[];
	readonly children: ReactNode;
}) {
	const parentUrls = useContext(ManagedAssetUrlsContext);
	const stableAssets = useStableManagedAssetLocators(props.assets);
	const batches = useMemo(() => managedAssetBatches(stableAssets), [stableAssets]);
	const [resolvedBatches, setResolvedBatches] = useState<
		ReadonlyMap<string, ReadonlyMap<string, string>>
	>(new Map());

	const onResolved = useCallback((batchKey: string, urls: ReadonlyMap<string, string>) => {
		setResolvedBatches((previous) => new Map(previous).set(batchKey, urls));
	}, []);

	const urls = useMemo(() => {
		const merged = new Map(parentUrls);
		for (const batch of batches) {
			for (const [key, url] of resolvedBatches.get(batch.key) ?? []) {
				merged.set(key, url);
			}
		}
		return merged;
	}, [parentUrls, batches, resolvedBatches]);

	return (
		<ManagedAssetUrlsContext.Provider value={urls}>
			{batches.map((batch) => (
				<ManagedAssetBatchResolver key={batch.key} batchKey={batch.key} onResolved={onResolved} />
			))}
			{props.children}
		</ManagedAssetUrlsContext.Provider>
	);
}

export function useManagedAssetUrl(asset: ManagedAssetLocator | undefined) {
	const urls = useContext(ManagedAssetUrlsContext);
	return asset === undefined ? undefined : urls.get(managedAssetKey(asset));
}

export function useAssetUrl(asset: AssetLocator | undefined) {
	const managedUrl = useManagedAssetUrl(asset?.type === "remote" ? undefined : asset);
	return asset?.type === "remote" ? asset.url : managedUrl;
}
