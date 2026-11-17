import type { Formatters } from "@ryot-app/plugin-client-sdk/react";

import type { MediaSummaryOf } from "../../shared/media-recipes";
import { personRecipes } from "../../shared/person-recipes";
import { creatorCreditSections } from "../creator/credit-sections";
import { defineCreatorMediaSchema } from "../media/creator-schema";
import { completedYearsBetween, formatDateOnlyLabel, formatLocalDateKey } from "../media/date";
import { mediaSourceLinks, type MediaSummaryFact } from "../media/summary-state";
import type { MediaCopy } from "../messages";

type PersonSummary = MediaSummaryOf<typeof personRecipes>;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** A partial provider date such as `1969` stays as written rather than reading as 1 January. */
const dateLabel = (formatters: Formatters, value: string) =>
	ISO_DATE.test(value) ? formatDateOnlyLabel(formatters, value) : value;

/** Biography facts; `today` is the viewer's local `YYYY-MM-DD` date for the living age. */
export const personSummaryFacts = (
	{ text, formatters }: MediaCopy,
	person: PersonSummary,
	today: string,
): readonly MediaSummaryFact[] => {
	const { birthDate, deathDate } = person;
	const livingAge = birthDate === null ? undefined : completedYearsBetween(birthDate, today);
	const deathAge =
		birthDate === null || deathDate === null
			? undefined
			: completedYearsBetween(birthDate, deathDate);
	return [
		birthDate === null
			? undefined
			: {
					icon: "clock",
					label: text("person.born"),
					value: dateLabel(formatters, birthDate),
					suffix:
						deathDate === null && livingAge !== undefined
							? text("person.age", { years: livingAge })
							: undefined,
				},
		deathDate === null
			? undefined
			: {
					icon: "clock",
					label: text("person.died"),
					value: dateLabel(formatters, deathDate),
					suffix: deathAge === undefined ? undefined : text("person.aged", { years: deathAge }),
				},
		person.birthPlace === null
			? undefined
			: { icon: "globe", value: person.birthPlace, label: text("person.birthplace") },
		person.gender === null
			? undefined
			: { icon: "user", value: person.gender, label: text("property.gender") },
	].filter((fact) => fact !== undefined);
};

export const personSchema = defineCreatorMediaSchema({
	kind: "person",
	recipes: personRecipes,
	links: mediaSourceLinks,
	creditSections: creatorCreditSections,
	artwork: { aspect: "poster", purpose: "profile" },
	facts: (person, copy) =>
		personSummaryFacts(copy, person, formatLocalDateKey(new Date().toISOString())),
});
