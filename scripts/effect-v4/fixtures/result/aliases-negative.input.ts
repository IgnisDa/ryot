import { Effect as Fx, Either as Outcome } from "@ryot/sandbox-sdk/effect";

const owned = Outcome.left("failed");

const run = Fx.gen(function* () {
	const result = yield* Fx.either(Fx.succeed(1));
	return Outcome.isRight(result) ? result.right : result.left;
});

const shadowed = (Outcome: { left: (value: string) => string }, Fx: { either: string }) => [
	Outcome.left("ordinary"),
	Fx.either,
];
const queryAst = { left: "column", right: "value" };
const savedView = { left: "filter", right: "expression" };
const childProcessCommand = { left: "command", right: "args" };
const ordinary = { left: 1, right: 2 };

void [
	owned,
	run,
	shadowed,
	queryAst.left,
	queryAst.right,
	savedView.left,
	savedView.right,
	childProcessCommand.left,
	childProcessCommand.right,
	ordinary.left,
	ordinary.right,
];
