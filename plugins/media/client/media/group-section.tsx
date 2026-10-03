import { PluginLink } from "@ryot-app/client-sdk/plugin";
import type { SelectedQuery } from "@ryot-app/client-sdk/ryotql";

import type { MediaOverviewRows, mediaGroupQuery } from "../../shared/media-recipes";
import type { MediaArtworkAspect } from "./entity-presentation";
import { MediaEntityRailSection } from "./entity-rail";
import { collectManagedAssetLocators } from "./image";
import {
	mediaOverviewAssets,
	mediaRelationsAreEmpty,
	type MediaUnlinkedCreator,
} from "./overview-state";
import { mediaPosterAsset } from "./summary-state";

type SelectedQuerySuccess<Query> = Query extends SelectedQuery<infer Success> ? Success : never;

export type MediaGroup = NonNullable<SelectedQuerySuccess<ReturnType<typeof mediaGroupQuery>>>;

export type MediaGroupOverview = MediaOverviewRows & { readonly group?: MediaGroup | undefined };

const mediaGroupMembers = (overview: MediaGroupOverview) => overview.group?.members.items ?? [];

export const mediaGroupOverviewManagedAssets = (overview: MediaGroupOverview) =>
	collectManagedAssetLocators([
		...mediaOverviewAssets(overview),
		...mediaGroupMembers(overview).map((member) => mediaPosterAsset(member)),
	]);

export const mediaGroupOverviewIsEmpty = (
	overview: MediaGroupOverview,
	unlinked: readonly MediaUnlinkedCreator[] = [],
) => mediaRelationsAreEmpty(overview, unlinked) && mediaGroupMembers(overview).length === 0;

export function MediaPartOfSection(props: {
	readonly title: string;
	readonly compact: boolean;
	readonly divided: boolean;
	readonly actionLabel: string;
	readonly group: MediaGroup | null;
	readonly aspect: MediaArtworkAspect;
}) {
	const { group } = props;
	if (group === null) {
		return null;
	}
	return (
		<MediaEntityRailSection
			title={props.title}
			compact={props.compact}
			divided={props.divided}
			aspect={() => props.aspect}
			items={group.members.items}
			action={
				<PluginLink
					to={{ kind: "entity", entityId: group.id }}
					className="font-ui font-medium text-[13px] text-accent-text"
				>
					{props.actionLabel}
				</PluginLink>
			}
		/>
	);
}
