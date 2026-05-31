import { ManagedRuntime } from "effect";

import { ClientLive } from "./boot/layers";

export const makeClientRuntime = () => ManagedRuntime.make(ClientLive);

export type ClientRuntime = ReturnType<typeof makeClientRuntime>;
