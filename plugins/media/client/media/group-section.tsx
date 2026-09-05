import { PluginLink } from "@ryot-app/client-sdk/plugin";
import type { SelectedQuery } from "@ryot-app/client-sdk/ryotql";
import { fieldSyncState } from "@ryot-app/client-ui-sdk/sync";
import clsx from "clsx";

import type { MediaOverviewRows, mediaGroupQuery } from "../../shared/media-recipes";
import { mediaArtworkClass, type MediaArtworkAspect } from "./entity-presentation";
import { collectManagedAssetLocators, preferredMediaImageAsset } from "./image";
import { ManagedAssetImage } from "./managed-assets";
import { MediaRail } from "./overview";
import {
	mediaOverviewAssets,
	mediaRelationsAreEmpty,
	type MediaUnlinkedCreator,
} from "./overview-state";
import { MediaOverviewSection } from "./primitives";
import { mediaSyncCounts } from "./sync-counts";

type SelectedQuerySuccess<Query> = Query extends SelectedQuery<infer Success> ? Success : never;

export type MediaGroup = NonNullable<SelectedQuerySuccess<ReturnType<typeof mediaGroupQuery>>>;

type MediaGroupMember = MediaGroup["members"]["items"][number];

export type MediaGroupOverview = MediaOverviewRows & { readonly group?: MediaGroup | undefined };

export const mediaGroupMemberAsset = (member: MediaGroupMember) =>
	preferredMediaImageAsset(member.images, "cover");

const mediaGroupMembers = (overview: MediaGroupOverview) => overview.group?.members.items ?? [];

export const mediaGroupOverviewManagedAssets = (overview: MediaGroupOverview) =>
	collectManagedAssetLocators([
		...mediaOverviewAssets(overview),
		...mediaGroupMembers(overview).map(mediaGroupMemberAsset),
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
	if (group === null || group.members.items.length === 0) {
		return null;
	}
	return (
		<MediaOverviewSection
			title={props.title}
			compact={props.compact}
			divided={props.divided}
			sync={mediaSyncCounts(group.members.items, mediaGroupMemberAsset)}
			action={
				<PluginLink
					to={{ kind: "entity", entityId: group.id }}
					className="font-ui font-medium text-[13px] text-accent-text"
				>
					{props.actionLabel}
				</PluginLink>
			}
		>
			<MediaRail compact={props.compact}>
				{group.members.items.map((member) => (
					<PluginLink
						key={member.id}
						aria-label={`Open ${member.name}`}
						to={{ kind: "entity", entityId: member.id }}
						className={clsx(
							"flex flex-col gap-2 rounded-lg focus-visible:outline-2 focus-visible:outline-accent",
							props.compact ? "w-28" : "w-32",
						)}
					>
						<ManagedAssetImage
							monogram={member.name}
							asset={mediaGroupMemberAsset(member)}
							state={fieldSyncState(mediaGroupMemberAsset(member), member)}
							className={mediaArtworkClass({
								layout: "grid",
								aspect: props.aspect,
								compact: props.compact,
							})}
						/>
						<p className="line-clamp-2 font-ui text-[12px] leading-4.25 text-text">{member.name}</p>
					</PluginLink>
				))}
			</MediaRail>
		</MediaOverviewSection>
	);
}
