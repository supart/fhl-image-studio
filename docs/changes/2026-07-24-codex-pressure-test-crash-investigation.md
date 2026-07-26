# Codex Pressure-Test Crash Investigation

## Scope

- Investigation date: 2026-07-24.
- The reported failure was the Codex desktop app exiting/hanging during the
  397-image FHL image-to-image pressure run.
- The project remained stopped throughout this investigation. No task was
  submitted, cancelled, retried, or modified, and no credential was read.

## Runtime State After Recovery

- No listener remained on ports 5173 or 5174.
- No `gptcodex-image.exe` worker remained.
- `.tmp-codex-browser-vite.pid` still contains PID 32464, but that process no
  longer exists. The PID file is stale.
- The current Codex package is `26.715.10079.0` and reports package status
  `Ok`; the pressure run used `26.715.9757.0`.

## Windows Timeline

- `00:47:04`: WMI stopped a `WMIPRVSE.EXE` provider after its private page
  count reached 568,762,368 bytes, above the 536,870,912-byte warning limit.
- `00:50:31`: Windows Error Reporting recorded `ChatGPT.exe` as
  `AppHangTransient`. This is the first direct Codex failure evidence.
- `00:52:33`: Windows destroyed the old Codex AppX container.
- `00:52:40` through `00:55:15`: the old `26.715.9757.0` package was launched
  and its container destroyed four more times, each after roughly 21-26
  seconds.
- `00:54:19`: `taskkill.exe` itself crashed with exception `0xc0000005`.
- `00:55:16`: WMI stopped another `WMIPRVSE.EXE` provider after it reached 297
  threads, above the 256-thread warning limit.
- `00:56:37`: Windows started installing/registering Codex
  `26.715.10079.0`.
- `00:57:11`: AppX explicitly recorded that `26.715.9757.0` was updating to
  `26.715.10079.0`.
- `00:57:39`: the new Codex package launched successfully.

There is no current-incident Codex APPCRASH WER archive. The newest archived
Codex APPCRASH is from 2026-07-16. Windows therefore observed this incident as
a hang followed by AppX container exits, not as a conventional unhandled
Codex exception.

## Pressure-Run Outcome

- `output/log/browser-jobs.v1.json` was last written at
  `2026-07-24 00:54:05.233 +08:00` and is 151,236 bytes.
- The retained registry contains 50 terminal tasks, indices 50-99: 25
  succeeded and 25 failed. It contains no running or queued backend job.
- The run reached index 99, so the frontend submitted the first 100 of the 397
  selected tasks. The remaining 297 were never submitted after the browser
  session stopped.
- The run produced 42 saved images, totaling about 121 MB.
- Ninety-nine distinct raw-response prefixes can be reconstructed:
  42 saved successes, 33 content-safety responses, 19 rate-limit responses,
  four empty responses, and one truncated large JSON response. One of the 100
  indexed tasks cannot be uniquely reconstructed from the retained response
  filenames.
- The latest successful image was written at `00:53:15.879`; the last terminal
  response and registry update occurred at `00:54:05.233`.
- No worker is still running, so the pressure run did not continue in the
  background after Codex recovered.

## Assessment

The update did not cause the first hang: the `ChatGPT.exe` hang was recorded
more than six minutes before the new package installation began. The most
likely failure chain is:

1. The 40-worker pressure run, large in-app task/result UI, and concurrent 2K
   image responses created substantial CPU, memory, disk, and renderer load.
2. Frequent process monitoring through WMI independently exhausted WMI memory
   and thread quotas. This is confirmed and made the machine less stable, but
   available evidence cannot prove it alone killed Codex.
3. The old Codex renderer/app hung and entered repeated short-lived restart
   attempts. The later Store/AppX update replaced that build and restored the
   app.

There is no Windows system-wide out-of-memory event and no renderer memory
snapshot, so an exact single root cause is not proven.

## Safe Resume Point

- Keep the project stopped until the user explicitly authorizes the next
  action.
- Do not repeat WMI/CIM polling for process monitoring. Read the job registry
  and use native `Get-Process -Name gptcodex-image` at a low sample rate.
- Before another paid run, move queue ownership/recovery to durable backend
  state, add lightweight metrics written by the proxy, and reduce live browser
  memory by virtualizing cards and releasing full-resolution blobs after disk
  save.
- Start with a bounded 40-100 task run outside the Codex in-app browser before
  attempting 397 tasks again.
