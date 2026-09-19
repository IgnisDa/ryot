import { Layer } from "effect";

import { ReusableCapabilityGrantStoreLive } from "#lib/infrastructure/reusable-capability-grants";

import { ClientArtifactGrantService } from "./grant-service";
import { ImageClientArtifacts } from "./image-artifacts";
import { ClientArtifactsRepository } from "./repository";
import { ClientArtifactStore } from "./store";

export const ClientArtifactGrantServiceLive = ClientArtifactGrantService.layer.pipe(
	Layer.provide(ReusableCapabilityGrantStoreLive),
);
export const ClientArtifactStoreLive = ClientArtifactStore.layer.pipe(
	Layer.provide(Layer.merge(ClientArtifactsRepository.layer, ImageClientArtifacts.layer)),
);
