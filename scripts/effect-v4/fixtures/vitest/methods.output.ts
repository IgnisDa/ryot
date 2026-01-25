import { it, it as effectIt } from "@effect/vitest";
import { it as e2eIt } from "~/support/effect-test";

it.effect("direct scope", () => undefined);
it.live("direct live scope", () => undefined);
effectIt.effect("aliased scope", () => undefined);
effectIt.live("aliased live scope", () => undefined);
e2eIt.effect("wrapper scope", () => undefined);
e2eIt.live("wrapper live scope", () => undefined);

const shadowed = (it: { scoped: (name: string, body: () => void) => void }) =>
	it.scoped("shadowed direct binding", () => undefined);

const shadowedAlias = (
	effectIt: { scopedLive: (name: string, body: () => void) => void },
) => effectIt.scopedLive("shadowed alias binding", () => undefined);

void shadowed;
void shadowedAlias;
