import type { ManagedAssetLocator, ManagedAssetResolution } from "@ryot-app/client-sdk";
import { createRyotQuery, useRyotQuery, useRyotSchedule } from "@ryot-app/client-sdk/react";
import { EntityArtWell, type FieldSyncState } from "@ryot-app/client-ui-sdk/sync";
import {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useEffectEvent,
	useMemo,
	useRef,
	useState,
	type ReactNode,
} from "react";

import type { ShowImageAsset } from "./media-image";

export const imageAssetKey = (asset: ShowImageAsset) =>
	asset.type === "remote" ? `remote:${asset.url}` : managedAssetKey(asset);

export const MANAGED_ASSET_RESOLUTION_MAX_ASSETS = 64;

const ASSET_REFRESH_LEAD_MS = 60_000;

const managedAssetKey = (locator: ManagedAssetLocator) => `${locator.type}:${locator.key}`;

const sortedLocators = (locators: readonly ManagedAssetLocator[]) =>
	[...locators].sort((left, right) => managedAssetKey(left).localeCompare(managedAssetKey(right)));

export const canonicalAssetBatchKey = (locators: readonly ManagedAssetLocator[]) =>
	JSON.stringify(sortedLocators(locators));

export type ManagedAssetBatch = {
	readonly key: string;
	readonly locators: readonly ManagedAssetLocator[];
};

export const managedAssetBatches = (
	locators: readonly ManagedAssetLocator[],
): readonly ManagedAssetBatch[] => {
	const deduped = sortedLocators([
		...new Map(locators.map((locator) => [managedAssetKey(locator), locator])).values(),
	]);
	const batches: ManagedAssetBatch[] = [];
	for (let index = 0; index < deduped.length; index += MANAGED_ASSET_RESOLUTION_MAX_ASSETS) {
		const slice = deduped.slice(index, index + MANAGED_ASSET_RESOLUTION_MAX_ASSETS);
		batches.push({ key: canonicalAssetBatchKey(slice), locators: slice });
	}
	return batches;
};

const useStableLocators = (locators: readonly ManagedAssetLocator[]) => {
	const key = canonicalAssetBatchKey(locators);
	const ref = useRef<
		{ readonly key: string; readonly locators: readonly ManagedAssetLocator[] } | undefined
	>(undefined);
	if (ref.current?.key !== key) {
		ref.current = { key, locators };
	}
	return ref.current.locators;
};

const managedAssetBatchQuery = createRyotQuery<string, readonly ManagedAssetResolution[]>(
	({ client, input, signal }) => {
		// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- client.assets.resolve validates the batch against its schema.
		const locators = JSON.parse(input) as readonly ManagedAssetLocator[];
		return client.assets.resolve(locators, { signal });
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
	const stableAssets = useStableLocators(props.assets);
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
				<ManagedAssetBatchResolver batchKey={batch.key} key={batch.key} onResolved={onResolved} />
			))}
			{props.children}
		</ManagedAssetUrlsContext.Provider>
	);
}

export function useManagedAssetUrl(asset: ShowImageAsset | undefined) {
	const urls = useContext(ManagedAssetUrlsContext);
	if (asset === undefined) {
		return undefined;
	}
	return asset.type === "remote" ? asset.url : urls.get(managedAssetKey(asset));
}

type AssetShape = "rounded" | "circle";

export function ManagedAssetImage(props: {
	readonly monogram: string;
	readonly className: string;
	readonly state: FieldSyncState;
	readonly shape?: AssetShape | undefined;
	readonly asset: ShowImageAsset | undefined;
}) {
	const url = useManagedAssetUrl(props.asset);
	return (
		<EntityArtWell
			url={url}
			state={props.state}
			monogram={props.monogram}
			className={props.className}
			shape={props.shape ?? "rounded"}
		/>
	);
}
