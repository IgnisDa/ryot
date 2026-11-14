# Notifications

Open **Settings → Notification channels** to add a destination or send a test.
The test first shows **Queued**, then its delivery result:

- **Accepted**: all selected providers accepted the request. This does not confirm that you read it.
- **Partial**: some channels accepted the request and others did not.
- **Failed**: the providers rejected the request, or Ryot could not prepare it.
- **Delivery unknown**: a request may have reached a provider, but Ryot cannot confirm the result.
  Ryot does not resend it automatically.
- **Not sent**: server delivery was disabled, or no selected channels were available.

A notification uses the channels enabled when it was queued. Adding a channel later does not send
an old notification to it. Disabling or deleting a channel prevents queued work from starting a send
there; it cannot recall a request already sent.

If a test request fails before the page receives a reply, retry it on the same page. The retry keeps
the same submission identity, so it does not queue a second test. After a successful test submission,
another click starts a new test.
