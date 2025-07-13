import type { MetadataLookupQuery } from "@ryot/generated/graphql/backend/graphql";

export type MetadataLookupData = MetadataLookupQuery["metadataLookup"];

export interface RawMediaData {
	url: string;
	title: string;
	progress?: number;
}

export interface ProgressDataWithMetadata {
	rawData: RawMediaData;
	metadata: MetadataLookupData;
}

export interface FormState {
	error?: string;
	status: "idle" | "submitting" | "submitted";
}

export interface ExtensionStatus {
	message: string;
	videoTitle?: string;
	state:
		| "idle"
		| "video_detected"
		| "lookup_in_progress"
		| "tracking_active"
		| "lookup_failed";
}
