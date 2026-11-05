# Idempotency

Four request kinds keep an idempotency key; every other write relies on natural keys (rule 3). A key is
kept where a retry would create a second row, or where the request runs plugin code whose effects the
kernel can't see in advance. Today nine request schemas carry a key.

## How clients retry today

- Retries are explicit. `useRyotSubmission` keeps a failed submission as `retained` after a transport or
  malformed-result failure, and **Retry** resends it with the same `submissionId`. Background submissions
  in `kernel/client/src/modules/background-submissions` retry the same two failure kinds.
- The Fitness workout editor keeps its draft, including the submission, in plugin storage, so a save can
  be resent with the same key after the app reloads.
- External webhook senders retry on their own schedule.

## Keep a key

| Request                                                     | Why a retry is unsafe without one                                                                                              |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Plugin operation invoke (`PluginInvokeBody.idempotencyKey`) | Media's user-data actions and the Fitness workout save run scripts that create events. A resent save would log a workout twice |
| Integration data webhook (`Idempotency-Key` header)         | The sender retries, and each delivery would import its payload again                                                           |
| Reminder create (`CreateReminderBody`)                      | Each create inserts a new reminder                                                                                             |
| Entity editor save (`EntityEditorSaveRequest`)              | Saving a new entity inserts one; the client already reuses the key for an unchanged retry                                      |

## Drop the key

| Request                                                             | Why a retry is already safe                                                             |
| ------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Collection reorder                                                  | Moving an item to where it already is succeeds without checking `expectedRevision`      |
| Clear entity user data                                              | A second clear finds nothing to delete                                                  |
| Merge entity user data                                              | A second merge finds the source already merged and reports success                      |
| Test notification channels                                          | A second test message is harmless                                                       |
| Entity enrichment request                                           | Replaced by the coalesced populate job in [`entity-updates.md`](entity-updates.md)      |
| Reminder edit and change (`EditReminderBody`, `ChangeReminderBody`) | When the revision check fails but the reminder already matches the request, it succeeds |

## Mechanism

- One `idempotency_key` table: user, key, request fingerprint, response, created at.
- The key row is inserted in the same transaction as the write (rule 4), so the write and the key commit
  together. A retry with the same key and fingerprint returns the stored response; a different
  fingerprint is a conflict.
- A plugin operation's key covers the operation's result. Until step 4 its script's writes still commit
  in their own transactions, so a retry that reaches the script again relies on natural keys: the script's
  execution ID and each host call's index derive the same entity and event IDs. This replaces per-item
  receipts.
- The integration data webhook keeps its key on `data_import_submission`, which already records the
  delivery with its import run.
- Until step 6, import runs record each committed item's result in `idempotency_key`, keyed by run and
  item identity, so reconciliation can project committed items.
- A replay returns the stored response and does not dispatch after-hooks again.
- Keyed requests keep `submittedAt` and the 7-day submission window from
  `kernel/backend/src/modules/mutations/submission-window.ts`, so a draft resent after its key expires is
  rejected instead of applied twice. Keys are deleted after 14 days by a job.
- A revision-checked request whose target already matches it succeeds instead of reporting a stale
  revision. That makes a resent edit or reorder safe without a key.
- Unkeyed requests drop `submittedAt` and `idempotencyKey` from their contract schemas.
