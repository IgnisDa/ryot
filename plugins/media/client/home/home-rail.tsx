import { ManagedAssetProvider, type RyotQueryResult } from "@ryot-app/client-sdk/react";
import type { ReactNode } from "react";

import type { MediaArtworkAspect, MediaPresentationSubject } from "../media/entity-presentation";
import { MediaEntityTile, MediaRailFrame } from "../media/entity-rail";
import { collectManagedAssetLocators, type MediaImageAsset } from "../media/image";
import { mediaPosterAsset } from "../media/summary-state";
import { mediaSyncCounts } from "../media/sync-counts";

export type HomeTile = {
	readonly key: string;
	readonly overlay?: ReactNode;
	readonly aspect: MediaArtworkAspect;
	readonly item: MediaPresentationSubject;
	readonly art?: MediaImageAsset | undefined;
	readonly lines?: readonly (string | undefined)[] | undefined;
};

export function HomeTileBadge(props: { readonly label: string }) {
	return (
		<span className="absolute top-1.5 left-1.5 rounded-pill bg-surface/90 px-2 py-0.5 font-ui font-semibold text-[11px] text-text">
			{props.label}
		</span>
	);
}

const tileArt = (tile: HomeTile) => tile.art ?? mediaPosterAsset(tile.item);

/**
 * One home rail over its section query: a placeholder while the first load is pending, a retry
 * when it failed with nothing to show, and nothing at all when it loaded no tiles.
 */
export function HomeRail<Data>(props: {
	readonly title: string;
	readonly compact: boolean;
	readonly result: RyotQueryResult<Data>;
	readonly tiles: (data: Data) => readonly HomeTile[];
}) {
	const { result } = props;
	if (result.data === undefined) {
		return (
			<MediaRailFrame
				title={props.title}
				compact={props.compact}
				status={
					result.status === "error" ? { kind: "error", retry: result.refetch } : { kind: "pending" }
				}
			/>
		);
	}
	const tiles = props.tiles(result.data);
	if (tiles.length === 0) {
		return null;
	}
	return (
		<ManagedAssetProvider assets={collectManagedAssetLocators(tiles.map(tileArt))}>
			<MediaRailFrame
				title={props.title}
				compact={props.compact}
				status={{ kind: "ready" }}
				sync={mediaSyncCounts(
					tiles.map((tile) => ({ ...tile.item, art: tileArt(tile) })),
					(item) => item.art,
				)}
			>
				{tiles.map((tile) => (
					<MediaEntityTile
						key={tile.key}
						art={tile.art}
						item={tile.item}
						lines={tile.lines}
						aspect={tile.aspect}
						overlay={tile.overlay}
						compact={props.compact}
					/>
				))}
			</MediaRailFrame>
		</ManagedAssetProvider>
	);
}
