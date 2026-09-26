#!/usr/bin/env bash
# Usage: repro.sh start <scenario> | result <scenario> | list
# Scenarios run detached on root@$SERVER_IP (provisioned by setup.sh); result prints the summary.
set -euo pipefail

: "${SERVER_IP:?set SERVER_IP}"
scenarios=(serial-chains workflow-timeouts wall-clock composed-views idle-timeout signup-deadlock full)
ssh_() { ssh "root@$SERVER_IP" "$@"; }

case "${1:-}" in
list) printf '%s\n' "${scenarios[@]}" ;;
start)
	scenario=${2:?scenario}
	[[ " ${scenarios[*]} " == *" $scenario "* ]] || { echo "unknown scenario: $scenario" >&2; exit 2; }
	ssh_ "mkdir -p /root/e2e-repro && cd /root/e2e-repro
		[ -f running.pid ] && kill -0 \$(cat running.pid) 2>/dev/null && { echo \"already running: \$(cat running.name)\" >&2; exit 1; }
		echo $scenario > running.name
		setsid nohup bash /root/ryot/docs/e2e-load-sensitivity/box/run.sh $scenario >/dev/null 2>&1 < /dev/null &
		echo \$! > running.pid
		echo 'started; log: /root/e2e-repro/$scenario.log'"
	;;
result)
	scenario=${2:?scenario}
	ssh_ "cat /root/e2e-repro/$scenario.summary 2>/dev/null; grep -q '^DONE$' /root/e2e-repro/$scenario.summary 2>/dev/null || echo '(still running)'"
	;;
*)
	sed -n 2,3p "$0" >&2
	exit 2
	;;
esac
