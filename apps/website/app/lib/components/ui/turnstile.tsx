import { Turnstile, type WidgetSize } from "@marsidev/react-turnstile";
import { forwardRef } from "react";

export interface TurnstileProps {
	siteKey: string;
	size?: WidgetSize;
	onError?: () => void;
	onExpire?: () => void;
	onSuccess?: (token: string) => void;
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
					options={{ theme: "light", size: props.size || "normal" }}
				/>
			</div>
		);
	},
);

TurnstileWidget.displayName = "TurnstileWidget";

export { TurnstileWidget };
