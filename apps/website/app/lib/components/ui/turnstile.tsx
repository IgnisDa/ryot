import { Turnstile } from "@marsidev/react-turnstile";
import { forwardRef } from "react";

export interface TurnstileProps {
	siteKey: string;
	onError?: () => void;
	onExpire?: () => void;
	onSuccess?: (token: string) => void;
	size?: "normal" | "compact" | "flexible";
}

const TurnstileWidget = forwardRef<HTMLDivElement, TurnstileProps>(
	(props, ref) => {
		return (
			<div ref={ref}>
				<Turnstile
					siteKey={props.siteKey}
					onError={props.onError}
					onExpire={props.onExpire}
					onSuccess={props.onSuccess}
					options={{ size: props.size || "normal" }}
				/>
			</div>
		);
	},
);

TurnstileWidget.displayName = "TurnstileWidget";

export { TurnstileWidget };
