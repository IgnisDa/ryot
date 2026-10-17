import type { MediaCreatorCredit } from "../../shared/creator-recipes";
import type { MediaArtworkAspect } from "./entity-presentation";
import { MediaEntityRailSection } from "./entity-rail";
import { collectManagedAssetLocators } from "./image";
import { mediaCharacterLabel, mediaRolesLabel } from "./overview-state";
import { MediaLinkButton } from "./primitives";
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
	readonly noun: string;
	readonly compact: boolean;
	readonly divided: boolean;
	readonly overview: MediaCreditRailsOverview<Slug>;
	readonly sections: readonly MediaCreditSection<Slug>[];
}) {
	const firstFilled = props.sections.findIndex(
		(section) => props.overview[section.slug].items.length > 0,
	);
	return props.sections.map((section, index) => {
		const credits = props.overview[section.slug];
		return (
			<MediaEntityRailSection
				key={section.slug}
				lines={creditLines}
				title={section.title}
				items={credits.items}
				compact={props.compact}
				aspect={() => section.aspect}
				divided={props.divided || index > firstFilled}
				action={
					credits.pageInfo.hasMore ? (
						<MediaLinkButton
							label="View all"
							onClick={() =>
								console.log(`TODO: open all ${section.slug} credits for this ${props.noun}`)
							}
						/>
					) : null
				}
			/>
		);
	});
}
