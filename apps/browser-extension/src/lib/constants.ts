export const MESSAGE_TYPES = {
	GET_STATUS: "GET_STATUS",
	METADATA_LOOKUP: "METADATA_LOOKUP",
	SEND_PROGRESS_DATA: "SEND_PROGRESS_DATA",
} as const;

export const STORAGE_KEYS = {
	DEBUG_MODE: "local:debug-mode",
	INTEGRATION_URL: "local:integration-url",
	EXTENSION_STATUS: "local:extension-status",
} as const;

export const MIN_VIDEO_DURATION_SECONDS = 600;
