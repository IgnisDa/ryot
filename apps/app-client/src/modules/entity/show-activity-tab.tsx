import { ShowActivity } from "./show-activity";
import { useShowActivity } from "./use-show-query";

export function ShowActivityTab(props: { readonly entityId: string }) {
	const { state, refresh } = useShowActivity(props.entityId);
	return <ShowActivity state={state} refresh={refresh} />;
}
