import { AppStatusState } from "@/modules/ui/status-state";

export function NavigationStatus(props: { detail?: string; title: string }) {
	return <AppStatusState className="flex-1 bg-bg" title={props.title} detail={props.detail} />;
}
