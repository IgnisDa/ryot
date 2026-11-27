import { Effect, Layer } from "effect";

import { MessageCatalogSource, MessageRegistry } from "./messages";

export const emptyMessageCatalogs: MessageCatalogSource["Service"] = {
	load: () => Effect.succeed([]),
};

export const kernelMessageRegistryLayer = MessageRegistry.layer.pipe(
	Layer.provide(Layer.succeed(MessageCatalogSource, emptyMessageCatalogs)),
);
