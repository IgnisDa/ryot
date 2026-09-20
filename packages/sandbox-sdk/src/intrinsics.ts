import type { SandboxHostCapability } from "@ryot-app/contract/modules/sandbox/wire";

import type * as Filesystem from "./filesystem";
import type * as Youtubei from "./youtubei";

type SandboxSdkIntrinsicSources = {
	readonly "@ryot-app/sandbox-sdk/youtubei": typeof Youtubei;
	readonly "@ryot-app/sandbox-sdk/filesystem": typeof Filesystem;
};

type SandboxSdkIntrinsicMapping = {
	readonly [Module in keyof SandboxSdkIntrinsicSources]: Partial<
		Record<keyof SandboxSdkIntrinsicSources[Module], SandboxHostCapability>
	>;
};

export const SANDBOX_SDK_INTRINSICS = {
	"@ryot-app/sandbox-sdk/youtubei": {
		createYoutubeMusicClient: "httpCall",
		createYoutubeHistoryClient: "httpCall",
	},
	"@ryot-app/sandbox-sdk/filesystem": {
		writeScratchChunks: "scratch",
		readArtifact: "artifact-read",
		readArtifactRange: "artifact-read",
		readNamedArtifact: "artifact-read",
	},
} as const satisfies SandboxSdkIntrinsicMapping;
