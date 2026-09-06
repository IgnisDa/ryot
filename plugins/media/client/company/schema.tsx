import { companyRecipes } from "../../shared/company-recipes";
import type { MediaSummaryOf } from "../../shared/media-recipes";
import { creatorCreditSections } from "../creator/credit-sections";
import { defineCreatorMediaSchema } from "../media/creator-schema";
import { MEDIA_ART_HEIGHT } from "../media/hero";
import { mediaSourceLinks, type MediaSummaryFact } from "../media/summary-state";

type CompanySummary = MediaSummaryOf<typeof companyRecipes>;

export const companySummaryFacts = (company: CompanySummary): readonly MediaSummaryFact[] =>
	[
		company.foundedYear === null
			? undefined
			: { icon: "clock", label: "Founded", value: String(company.foundedYear) },
		company.headquarters === null
			? undefined
			: { icon: "building-2", label: "Headquarters", value: company.headquarters },
	].filter((fact) => fact !== undefined);

export const companySchema = defineCreatorMediaSchema({
	links: mediaSourceLinks,
	recipes: companyRecipes,
	facts: companySummaryFacts,
	heroHeight: () => MEDIA_ART_HEIGHT,
	creditSections: creatorCreditSections,
	artwork: { fit: "contain", purpose: "logo", aspect: "square" },
	nouns: { title: "Company", plural: "companies", singular: "company" },
});
