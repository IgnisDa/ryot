# Active-Installation Media Monitoring

**Parent Plan:** [Plugin System - Phase 5: Minimal User-Level Plugins](./README.md)

**Status:** todo

## What to build

Adapt the trusted media-monitoring workflow to installation state without turning it into one cron or
workflow per user. Preserve the existing package-level system-authority sweep and global provider
refresh behavior.

Extend the generic system-query boundary with the minimum installation-aware predicate needed to
prove that a user-owned relationship belongs to a user with an active installation of the querying
package. The media package uses that predicate alongside its monitoring relationship traversal. The
kernel must not acquire media schema or workflow vocabulary.

The sweep returns each eligible global provider entity once even when several active users monitor
it. Removed media installations are excluded from targets and from downstream signals, automation,
notifications, and user relationships. Existing per-user monitoring operations remain available only
through the active media installation established in Task 06.

## Acceptance criteria

- [ ] Media monitoring remains one package cron and one package-level system workflow rather than per-installation scheduled work
- [ ] The system-query capability can require an active installation of the executing trusted package for the user owning a matched row or relationship
- [ ] The installation predicate is generic and contains no media schema, relationship, provider, workflow, or operation names
- [ ] Monitoring targets include relationships owned by users with active media installations
- [ ] Monitoring targets exclude relationships owned by users with removed media installations
- [ ] A global provider entity monitored by multiple active users appears once in a sweep page and is refreshed once per sweep
- [ ] Removed users receive no monitoring-triggered automation, signal, notification, relationship, or workflow effect
- [ ] Reinstalling media makes preserved monitoring relationships eligible again without duplicating them
- [ ] Existing monitoring status, enable, disable, association, refresh, and notification assertions remain green for active users
- [ ] Two-user e2e coverage proves active/removed isolation and no duplicate package sweep
- [ ] Backend check, media-plugin tests, and focused media-monitoring e2e files pass

## User stories addressed

- User story 24
- User story 25
- User story 34
