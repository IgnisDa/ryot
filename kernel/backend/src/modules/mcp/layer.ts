import { Layer } from "effect";

import { AuthServiceLive } from "#modules/accounts/auth/layer";
import { LifecycleWriteGuard } from "#modules/accounts/auth/lifecycle-write-guard";
import { AgentToolsServiceLive } from "#modules/agent-tools/layer";

import { McpService } from "./service";

export const McpServiceLive = McpService.layer.pipe(
	Layer.provide(Layer.mergeAll(AuthServiceLive, AgentToolsServiceLive, LifecycleWriteGuard.layer)),
);
