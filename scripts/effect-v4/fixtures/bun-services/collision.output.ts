import { BunServices as BunContext } from "@effect/platform-bun";

const BunServices = { layer: "local" };

export const layers = [BunContext.layer, BunServices.layer];
