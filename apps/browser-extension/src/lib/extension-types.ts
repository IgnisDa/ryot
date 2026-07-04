import type { MetadataLookupResult } from "@ryot/media-fitness/operations/schemas";

export interface RawMediaData {
	title: string;
	progress: number;
}

export interface ProgressDataWithMetadata {
	rawData: RawMediaData;
	metadata: MetadataLookupResult;
}

export interface FormState {
	error?: string;
	status: "idle" | "submitting" | "submitted";
}

export enum ExtensionStatus {
	Idle = "idle",
	VideoDetected = "video_detected",
	LookupInProgress = "lookup_in_progress",
	TrackingActive = "tracking_active",
	LookupFailed = "lookup_failed",
}
