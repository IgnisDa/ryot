import { Layer } from "effect";
import { SecureRandom } from "effect/crypto";

import { FileDownloads } from "./file";

export const DownloadsLive = FileDownloads.layer.pipe(Layer.provide(SecureRandom.layerWebCrypto));
