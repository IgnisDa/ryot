import { companyRecipes } from "../../shared/company-recipes";
import type { MediaSummaryOf } from "../../shared/media-recipes";
import { creatorCreditSections } from "../creator/credit-sections";
import { defineCreatorMediaSchema } from "../media/creator-schema";
import { mediaSourceLinks, type MediaSummaryFact } from "../media/summary-state";
import type { MediaCopy } from "../messages";

type CompanySummary = MediaSummaryOf<typeof companyRecipes>;

export const companySummaryFacts = (
	company: CompanySummary,
	{ text }: MediaCopy,
): readonly MediaSummaryFact[] =>
	[
		company.foundedYear === null
			? undefined
			: { icon: "clock", label: text("company.founded"), value: String(company.foundedYear) },
		company.headquarters === null
			? undefined
			: { icon: "building-2", value: company.headquarters, label: text("property.headquarters") },
	].filter((fact) => fact !== undefined);

export const companySchema = defineCreatorMediaSchema({
	kind: "company",
	links: mediaSourceLinks,
	recipes: companyRecipes,
	facts: companySummaryFacts,
	creditSections: creatorCreditSections,
	artwork: { fit: "contain", purpose: "logo", aspect: "square" },
});
