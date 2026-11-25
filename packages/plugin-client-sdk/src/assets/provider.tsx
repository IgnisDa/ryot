import type { AssetLocator, ManagedAssetLocator } from "@ryot-app/contract/modules/assets/schemas";
import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useEffect,
	useEffectEvent,
	useMemo,
	useState,
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

const ManagedAssetContext = createContext<{
	readonly keys: ReadonlySet<string>;
	readonly urls: ReadonlyMap<string, string>;
}>({ keys: new Set(), urls: new Map() });

export function useManagedAssetUrl(asset: undefined | ManagedAssetLocator) {
	const { urls } = useContext(ManagedAssetContext);
	return asset === undefined ? undefined : urls.get(managedAssetKey(asset));
}

export function useAssetUrl(asset: undefined | AssetLocator) {
	const managedUrl = useManagedAssetUrl(asset?.type === "remote" ? undefined : asset);
	return asset?.type === "remote" ? asset.url : managedUrl;
}

export function ManagedAssetProvider(props: {
	readonly children: ReactNode;
	readonly assets: readonly ManagedAssetLocator[];
}) {
	const { keys: parentKeys, urls: parentUrls } = useContext(ManagedAssetContext);
	const stableAssets = useStableManagedAssetLocators(props.assets);
	const keys = useMemo(
		() => new Set([...parentKeys, ...stableAssets.map(managedAssetKey)]),
		[parentKeys, stableAssets],
	);
	const batches = useMemo(
		() =>
			managedAssetBatches(stableAssets.filter((asset) => !parentKeys.has(managedAssetKey(asset)))),
		[parentKeys, stableAssets],
	);
	const [resolvedBatches, setResolvedBatches] = useState<
		ReadonlyMap<string, ReadonlyMap<string, string>>
	>(new Map());

	const onResolved = useCallback((batchKey: string, urls: ReadonlyMap<string, string>) => {
		setResolvedBatches((previous) => new Map(previous).set(batchKey, urls));
	}, []);

	const value = useMemo(() => {
		const merged = new Map(parentUrls);
		for (const batch of batches) {
			for (const [key, url] of resolvedBatches.get(batch.key) ?? []) {
				merged.set(key, url);
			}
		}
		return { keys, urls: merged };
	}, [keys, parentUrls, batches, resolvedBatches]);

	return (
		<ManagedAssetContext.Provider value={value}>
			{batches.map((batch) => (
				<ManagedAssetBatchResolver key={batch.key} batchKey={batch.key} onResolved={onResolved} />
			))}
			{props.children}
		</ManagedAssetContext.Provider>
	);
}

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
