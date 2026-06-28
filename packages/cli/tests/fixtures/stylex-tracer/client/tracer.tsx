import * as stylex from "@stylexjs/stylex";

import { fixtureTokens } from "./tokens.stylex";
import tracerMark from "./tracer-mark.svg";

const styles = stylex.create({
	root: { color: fixtureTokens.foreground } satisfies stylex.CSSProperties,
});

export default function Tracer() {
	return <img {...stylex.props(styles.root)} src={tracerMark} alt="StyleX tracer" />;
}
