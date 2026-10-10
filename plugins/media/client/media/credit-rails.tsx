import type { RyotQuery } from "@ryot-app/plugin-client-sdk/react";

import type { MediaCreatorCredit } from "../../shared/creator-recipes";
import { MediaCreditsButton } from "./credits";
import type { MediaCursorPage } from "./cursor-page-state";
import type { MediaArtworkAspect } from "./entity-presentation";
import { MediaEntityRailSection } from "./entity-rail";
import { collectManagedAssetLocators } from "./image";
import { mediaCharacterLabel, mediaRolesLabel } from "./overview-state";
import { mediaPosterAsset } from "./summary-state";

export type MediaCreditSection<Slug extends string> = {
	readonly slug: Slug;
	readonly title: string;
	readonly aspect: MediaArtworkAspect;
};

export type MediaCreditRailsOverview<Slug extends string> = {
	readonly [Key in Slug]: {
		readonly items: readonly MediaCreatorCredit[];
		readonly pageInfo: { readonly hasMore: boolean };
	};
};

export const mediaCreditItems = <Slug extends string>(overview: MediaCreditRailsOverview<Slug>) =>
	Object.values<MediaCreditRailsOverview<Slug>[Slug]>(overview).flatMap(({ items }) => items);

export const mediaCreditRailsAreEmpty = <Slug extends string>(
	overview: MediaCreditRailsOverview<Slug>,
) => mediaCreditItems(overview).length === 0;

export const mediaCreditRailsManagedAssets = <Slug extends string>(
	overview: MediaCreditRailsOverview<Slug>,
) => collectManagedAssetLocators(mediaCreditItems(overview).map((item) => mediaPosterAsset(item)));

const creditLines = (credit: MediaCreatorCredit) => [
	mediaRolesLabel(credit.roles),
	mediaCharacterLabel(credit.character ?? null),
];

export function MediaCreditRails<Slug extends string>(props: {
	readonly entityId: string;
	readonly safeAreaTop: number;
	readonly creditsQuery: RyotQuery<
		{ readonly entityId: string; readonly target: Slug; readonly after: string | null },
		MediaCursorPage<MediaCreatorCredit>
	>;
	readonly compact: boolean;
	readonly overview: MediaCreditRailsOverview<Slug>;
	readonly sections: readonly MediaCreditSection<Slug>[];
}) {
	return props.sections.map((section) => {
		const credits = props.overview[section.slug];
		return (
			<MediaEntityRailSection
				key={section.slug}
				lines={creditLines}
				title={section.title}
				items={credits.items}
				compact={props.compact}
				aspect={() => section.aspect}
				action={
					credits.pageInfo.hasMore ? (
						<MediaCreditsButton<{ readonly target: Slug }>
							purpose="cover"
							label="View all"
							title={section.title}
							compact={props.compact}
							aspect={section.aspect}
							query={props.creditsQuery}
							safeAreaTop={props.safeAreaTop}
							input={{ target: section.slug, entityId: props.entityId }}
						/>
					) : null
				}
			/>
		);
	});
}
