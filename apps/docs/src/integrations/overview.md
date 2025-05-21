# Integrations

Integrations can be used to continuously update your media progress or inform external
services about changes. They can be of following types:

- _Sink_: An external client publishes progress updates to the Ryot server.
- _Yank_: Progress data is downloaded from an externally running server at a periodic
  interval.
- _Push_: Ryot sends data to an external service when an event occurs.

If an integration fails more than 5 times in a row, it will be automatically paused. This
behavior can be disabled from the integration's settings.
