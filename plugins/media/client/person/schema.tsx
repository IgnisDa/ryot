import type { MediaSummaryOf } from "../../shared/media-recipes";
import { personRecipes } from "../../shared/person-recipes";
import { creatorCreditSections } from "../creator/credit-sections";
import { defineCreatorMediaSchema } from "../media/creator-schema";
import { completedYearsBetween, formatDateOnlyLabel, formatLocalDateKey } from "../media/date";
import { MEDIA_ART_HEIGHT } from "../media/hero";
import { mediaSourceLinks, type MediaSummaryFact } from "../media/summary-state";

type PersonSummary = MediaSummaryOf<typeof personRecipes>;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** A partial provider date such as `1969` stays as written rather than reading as 1 January. */
const dateLabel = (value: string) => (ISO_DATE.test(value) ? formatDateOnlyLabel(value) : value);

const ageSuffix = (label: string, years: number | undefined) =>
	years === undefined ? undefined : ` (${label} ${years})`;

/** Biography facts; `today` is the viewer's local `YYYY-MM-DD` date for the living age. */
export const personSummaryFacts = (
	person: PersonSummary,
	today: string,
): readonly MediaSummaryFact[] => {
	const { birthDate, deathDate } = person;
	return [
		birthDate === null
			? undefined
			: {
					icon: "clock",
					label: "Born",
					value: dateLabel(birthDate),
					suffix:
						deathDate === null
							? ageSuffix("age", completedYearsBetween(birthDate, today))
							: undefined,
				},
		deathDate === null
			? undefined
			: {
					icon: "clock",
					label: "Died",
					value: dateLabel(deathDate),
					suffix:
						birthDate === null
							? undefined
							: ageSuffix("aged", completedYearsBetween(birthDate, deathDate)),
				},
		person.birthPlace === null
			? undefined
			: { icon: "globe", label: "Birthplace", value: person.birthPlace },
		person.gender === null ? undefined : { icon: "user", label: "Gender", value: person.gender },
	].filter((fact) => fact !== undefined);
};

export const personSchema = defineCreatorMediaSchema({
	recipes: personRecipes,
	links: mediaSourceLinks,
	heroHeight: () => MEDIA_ART_HEIGHT,
	creditSections: creatorCreditSections,
	artwork: { aspect: "poster", purpose: "profile" },
	nouns: { title: "Person", plural: "people", singular: "person" },
	facts: (person) => personSummaryFacts(person, formatLocalDateKey(new Date().toISOString())),
});
