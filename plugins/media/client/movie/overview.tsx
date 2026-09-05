import { PluginLink } from "@ryot-app/client-sdk/plugin";
import { fieldSyncState } from "@ryot-app/client-ui-sdk/sync";
import clsx from "clsx";

import type { MovieOverviewResult } from "../../shared/movie-recipes";
import { collectManagedAssetLocators, preferredMediaImageAsset } from "../media/image";
import { ManagedAssetImage } from "../media/managed-assets";
import {
	MediaOverviewRelations,
	MediaRail,
	type MediaOverviewRelationsRender,
} from "../media/overview";
import { mediaOverviewAssets, mediaRelationsAreEmpty } from "../media/overview-state";
import { MediaOverviewSection } from "../media/primitives";
import { mediaSyncCounts } from "../media/sync-counts";

export type MovieOverview = MovieOverviewResult;

export type MovieGroup = NonNullable<MovieOverview["group"]>;

export type MovieGroupMember = MovieGroup["movies"]["items"][number];

export const movieGroupMemberAsset = (member: MovieGroupMember) =>
	preferredMediaImageAsset(member.images, "cover");

const movieGroupMembers = (overview: MovieOverview) => overview.group?.movies.items ?? [];

export const movieOverviewManagedAssets = (overview: MovieOverview) =>
	collectManagedAssetLocators([
		...mediaOverviewAssets(overview),
		...movieGroupMembers(overview).map(movieGroupMemberAsset),
	]);

export const movieOverviewIsEmpty = (overview: MovieOverview) =>
	mediaRelationsAreEmpty(overview) && movieGroupMembers(overview).length === 0;

export function MoviePartOfSection(props: {
	readonly compact: boolean;
	readonly divided: boolean;
	readonly group: MovieGroup | null;
}) {
	const { group } = props;
	if (group === null || group.movies.items.length === 0) {
		return null;
	}
	return (
		<MediaOverviewSection
			compact={props.compact}
			divided={props.divided}
			title={`Part of ${group.name}`}
			sync={mediaSyncCounts(group.movies.items, movieGroupMemberAsset)}
			action={
				<PluginLink
					to={{ kind: "entity", entityId: group.id }}
					className="font-ui font-medium text-[13px] text-accent-text"
				>
					View collection
				</PluginLink>
			}
		>
			<MediaRail compact={props.compact}>
				{group.movies.items.map((member) => (
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
							className="aspect-2/3 w-full"
							asset={movieGroupMemberAsset(member)}
							state={fieldSyncState(movieGroupMemberAsset(member), member)}
						/>
						<p className="line-clamp-2 font-ui text-[12px] leading-4.25 text-text">{member.name}</p>
					</PluginLink>
				))}
			</MediaRail>
		</MediaOverviewSection>
	);
}

export const movieOverviewRelations: MediaOverviewRelationsRender<MovieOverview> = ({
	compact,
	divided,
	overview,
}) => (
	<MediaOverviewRelations
		compact={compact}
		divided={divided}
		overview={overview}
		onViewAllPeople={() => console.log("TODO: open all movie credits")}
		trailing={
			<MoviePartOfSection
				compact={compact}
				group={overview.group ?? null}
				divided={divided || !mediaRelationsAreEmpty(overview)}
			/>
		}
	/>
);
