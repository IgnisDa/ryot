import { Layer } from "effect";

import { AuthenticatedApi } from "../api/authenticated";
import { PublicApi } from "../api/public";
import { AuthClient } from "../modules/auth/client";
import { AuthService } from "../modules/auth/service";
import { ServerService } from "../modules/server/service";
import { ClientStorage } from "../persistence/storage";

const InfrastructureLive = Layer.mergeAll(
	ClientStorage.layer,
	PublicApi.layer,
	AuthenticatedApi.layer,
);

const AuthClientLive = AuthClient.layer.pipe(Layer.provideMerge(InfrastructureLive));

export const ClientLive = Layer.mergeAll(ServerService.layer, AuthService.layer).pipe(
	Layer.provideMerge(AuthClientLive),
);
