# Notifications

`NotificationsService` owns channel commands and routes test and automation messages through
`NotificationAdmissions`. Both sandbox entry paths supply the trusted run, host-call identity and
recipient account generation. Channel tests retain a submission key and return the admitted
notification ID; an HTTP success acknowledges queueing, not provider delivery.

## Admission and locking

`NotificationsRepository` is the channel writer. `NotificationDeliveryRepository` is the sole runtime
writer for notifications and channel attempts. Admission commits before dispatch. The frequent cron
recovers pending admissions in keyset pages of 50, with at most ten pages per invocation. Each row's
failure is isolated from later work.
Recovery moves each checked row behind unchecked work for 60 seconds before dispatch, so failed
dispatches cannot permanently occupy the front of the bounded scan.

Transactions lock the account generation first, then any source-policy fence, then the notification
source advisory lock or notification row, then the channel row and delivery row. Workflow registration takes the account
lock before its receipt write. No transaction spans rendering, external I/O or workflow dispatch.
Account retirement takes the conflicting exclusive account lock; deleting the account cascades both
ledger tables. Workflow ownership is registered with mutation admission and the retirement catalogue.

The source key and input digest are immutable and independent of automation-history foreign keys.
Concurrent admission returns the same notification. Different content under the same key is rejected.
Admission selects enabled channels once. A new channel cannot join retained work; deletion or
disablement before a send claim skips that channel without removing its safe historical description.
An admission supports at most 200 channels. Capacity failure rolls back admission, rather than
persisting a permanent Not sent outcome.

## Send claims and recovery

The delivery activity prepares a transport before claiming. A short transaction rechecks account and
channel authority and changes Queued to Sending with a new attempt ID. Only the execution that just
acquired that claim can run the prepared transport. Replaying the activity cannot reuse a retained
claim. Result persistence retries database writes only, never the provider request.

An external attempt has a 15-second execution timeout; HTTP and SMTP socket operations also use
10-second timeouts. A retained Sending claim older than 60 seconds becomes Unknown during recovery,
not a fresh attempt. Observing a younger concurrent claim does not settle it. Late results can update
only the original still-Sending attempt and cannot reopen settled work.

Accepted means provider acknowledgement, not recipient receipt or reading. Explicit rejection is
Failed. A timeout, interrupted process, lost response or unrecognized success response is Unknown.
Server disablement and unavailable channels are Skipped; no selected channels yields Not sent.
The compact outcome preserves partial success, while channel rows retain individual results.
Telegram messages are plain text, without Markdown interpretation.

Detailed diagnostic text expires 30 days after channel settlement. Source keys, digests and claims
remain retained; workflow journal expiry alone does not make a source safe to replay.

## Reads

`notification` and `notificationDelivery` are owner-only kernel-audience RyotQL tables. Plugins and
admin queries cannot read them. Recipes in `@ryot-app/ryotql-recipes/notification-delivery` expose
queue/settlement state and safe channel summaries, not credentials, source keys, account tokens,
transport diagnostics or workflow payloads.
