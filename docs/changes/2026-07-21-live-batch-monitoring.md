# Live Batch Monitoring

Time: 2026-07-21 09:43-09:52 +08:00

## Scope

The user had a real batch image-to-image run in progress in the dev browser at
`http://127.0.0.1:5173/`. Codex monitored visible DOM state only and did not
read, copy, or write API keys.

## Observations

- Batch size shown by the UI: 397/397 selected source images.
- Shared concurrency shown by the UI: "当前 4 并发".
- The result grid maintained 4 active running tasks during the observed window.
  No snapshot exceeded the shared concurrency cap.
- The queue continued to backfill after task completion/failure.
- API slot assignment followed the intended FHL pool order:
  - Initial observed running slots used FHL-1..FHL-4.
  - Later running slots advanced through FHL-5..FHL-10.
  - The sequence then wrapped back to FHL-1/FHL-2.
- Final observed snapshot at 09:52:47:
  - 397 total tiles.
  - 4 running.
  - 0 submitted.
  - 357 queued.
  - 36 failed.
  - 0 completed result tiles.
- Top visible error stayed:
  `上游返回 429:user requests-per-minute limit exceeded`.

## Conclusion

The scheduler behavior looked correct for the configured shared concurrency cap:
it queued excess work, kept active work at 4, and rotated through the FHL API
pool in slot order. The live run itself was unhealthy because upstream RPM
limits were producing 429 failures.

No cancel, retry, config change, or key inspection was performed by Codex.
