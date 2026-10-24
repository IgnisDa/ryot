export enum ExtensionStatus {
	Idle = "idle",
	LookupFailed = "lookup_failed",
	VideoDetected = "video_detected",
	TrackingActive = "tracking_active",
	LookupInProgress = "lookup_in_progress",
}

export interface FormState {
	error?: string;
	status: "idle" | "submitted" | "submitting";
}
