import { it, it as effectIt } from "@effect/vitest";
import { it as e2eIt } from "~/support/effect-test";

it.scoped("direct scope", () => undefined);
it.scopedLive("direct live scope", () => undefined);
effectIt.scoped("aliased scope", () => undefined);
effectIt.scopedLive("aliased live scope", () => undefined);
e2eIt.scoped("wrapper scope", () => undefined);
e2eIt.scopedLive("wrapper live scope", () => undefined);

const shadowed = (it: { scoped: (name: string, body: () => void) => void }) =>
	it.scoped("shadowed direct binding", () => undefined);

const shadowedAlias = (
	effectIt: { scopedLive: (name: string, body: () => void) => void },
) => effectIt.scopedLive("shadowed alias binding", () => undefined);

void shadowed;
void shadowedAlias;
