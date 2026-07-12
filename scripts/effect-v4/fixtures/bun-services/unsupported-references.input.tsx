import { BunContext } from "@effect/platform-bun";

type Reference = BunContext;
type Qualified = BunContext.Layer;
type Query = typeof BunContext;
const shorthand = { BunContext };
const keyed = { BunContext: 1 };
const computed = BunContext["layer"];
const optional = BunContext?.layer;
const called = BunContext();
const direct = BunContext;
const jsx = <BunContext />;
export { BunContext };

void [shorthand, keyed, computed, optional, called, direct, jsx];
