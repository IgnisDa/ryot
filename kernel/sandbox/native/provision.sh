#!/usr/bin/env bash
set -euo pipefail

if [[ "$(uname -s)" != Linux ]]; then
	printf '%s\n' 'launcher setup failure: Linux is required' >&2
	exit 1
fi
if [[ "$(id -u)" != 0 ]]; then
	printf '%s\n' 'launcher setup failure: run the explicit setup step as root' >&2
	exit 1
fi
if [[ "$#" != 3 ]]; then
	printf '%s\n' 'usage: provision.sh <launcher> <sidecar> <snapshots-directory>' >&2
	exit 64
fi

launcher=$1
sidecar=$2
snapshots=$3
for file in "$launcher" "$sidecar"; do
	if [[ ! -f "$file" || ! -x "$file" ]]; then
		printf 'launcher setup failure: executable is missing: %s\n' "$file" >&2
		exit 1
	fi
done
for tier in core data full; do
	if [[ ! -f "$snapshots/$tier.snap" ]]; then
		printf 'launcher setup failure: snapshot is missing: %s/%s.snap\n' "$snapshots" "$tier" >&2
		exit 1
	fi
done

ensure_group() {
	local gid=$1 name=$2 existing
	if existing=$(getent group "$gid"); then
		if [[ "${existing%%:*}" != "$name" ]]; then
			printf 'launcher setup failure: GID %s is already assigned to %s\n' "$gid" "${existing%%:*}" >&2
			exit 1
		fi
	else
		groupadd --gid "$gid" "$name"
	fi
}

ensure_user() {
	local uid=$1 gid=$2 name=$3 existing entry_name entry_uid entry_gid entry_home entry_shell
	if existing=$(getent passwd "$uid"); then
		IFS=: read -r entry_name _ entry_uid entry_gid _ entry_home entry_shell <<<"$existing"
		if [[ "$entry_name" != "$name" || "$entry_gid" != "$gid" ]]; then
			printf 'launcher setup failure: UID %s has unexpected account or primary group\n' "$uid" >&2
			exit 1
		fi
		if [[ "$uid" == 1002 && ( "$entry_home" != /nonexistent || "$entry_shell" != /usr/sbin/nologin ) ]]; then
			printf '%s\n' 'launcher setup failure: sidecar account must have no home or login shell' >&2
			exit 1
		fi
	else
		useradd --uid "$uid" --gid "$gid" --no-create-home --home-dir /nonexistent --shell /usr/sbin/nologin "$name"
	fi
}

ensure_group 1001 ryot-backend
ensure_user 1001 1001 ryot-backend
ensure_group 1002 ryot-sandboxd
ensure_user 1002 1002 ryot-sandboxd

install -d -o root -g root -m 0755 \
	/home/ryot \
	/home/ryot/sandboxd \
	/home/ryot/sandboxd/snapshots \
	/usr/local/libexec
install -d -o root -g root -m 0700 /run/ryot-sandboxd
install -o root -g root -m 0600 /dev/null /run/ryot-sandboxd/.lock
install -o root -g root -m 0555 "$sidecar" /home/ryot/sandboxd/ryot-sandboxd
for tier in core data full; do
	install -o root -g root -m 0444 "$snapshots/$tier.snap" \
		"/home/ryot/sandboxd/snapshots/$tier.snap"
done
install -o root -g root -m 0755 "$launcher" /usr/local/libexec/ryot-sandbox-launcher
# uutils coreutils install drops special mode bits, so set and verify setuid separately.
chmod 04755 /usr/local/libexec/ryot-sandbox-launcher
if [[ "$(stat -c %a /usr/local/libexec/ryot-sandbox-launcher)" != 4755 ]]; then
	printf '%s\n' 'launcher setup failure: the installed launcher is not setuid root' >&2
	exit 1
fi

printf '%s\n' 'launcher setup complete: UID/GID 1001/1002 and trusted fixed paths installed'
