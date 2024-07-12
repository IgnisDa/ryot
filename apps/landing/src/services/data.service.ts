import type { Feature, LandingPageData } from "@/config/landing.interface";
import landingData from "@/data/landing.json";
import featuresData from "@/data/features.json";

export const getLandingData = async (): Promise<LandingPageData> => {
	const data: LandingPageData = landingData;
	return data;
};

export const getFeaturesData = async (): Promise<Feature[]> => {
	const data: Feature[] = featuresData;
	return data;
};
