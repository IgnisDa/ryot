import type { SandboxHostCapability } from "@ryot-app/contract/modules/sandbox/wire";

import type * as Filesystem from "./filesystem";
import type * as Youtubei from "./youtubei";

type SandboxSdkIntrinsicSources = {
	readonly "@ryot-app/plugin-backend-sdk/youtubei": typeof Youtubei;
	readonly "@ryot-app/plugin-backend-sdk/filesystem": typeof Filesystem;
};

type SandboxSdkIntrinsicMapping = {
	readonly [Module in keyof SandboxSdkIntrinsicSources]: Partial<
		Record<keyof SandboxSdkIntrinsicSources[Module], SandboxHostCapability>
	>;
};

export const SANDBOX_SDK_INTRINSICS = {
	"@ryot-app/plugin-backend-sdk/youtubei": {
		createYoutubeMusicClient: "httpCall",
		createYoutubeHistoryClient: "httpCall",
	},
	"@ryot-app/plugin-backend-sdk/filesystem": {
		writeScratchChunks: "scratch",
		readArtifact: "artifact-read",
		readArtifactRange: "artifact-read",
		readNamedArtifact: "artifact-read",
	},
} as const satisfies SandboxSdkIntrinsicMapping;
