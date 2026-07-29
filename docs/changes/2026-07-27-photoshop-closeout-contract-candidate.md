# Photoshop Closeout Contract Candidate

Date: 2026-07-27

## Scope

The automated closeout audit found that an authenticated Photoshop job could
still omit `aspect`, `resolution`, `canvasWidth`, and `canvasHeight` through a
legacy compatibility path. Production Bridge source now requires the complete
standard-output contract for every Photoshop job. No unrelated desktop,
Android, installer, or upstream configuration work was included.

## Verification

- Focused Photoshop Bridge tests: passed.
- Full desktop `go test ./...` and `go vet ./...`: passed.
- Full CLI `go test ./...` and `go vet ./...`: passed.
- Frontend typecheck: passed.
- Frontend Node tests: `563/563` passed.
- Frontend UI tests: `12/12` passed.
- Lint: zero errors; 63 existing warnings remain.

## Isolated Candidate

- Root: `发布验证/ps-plugin-closeout-contract-20260727`.
- Formal EXE: 20,761,088 bytes, SHA-256
  `AE7DA252C5C35E89826D14C9E0E2FBE2CC6A06EFAE4ABD71EC3133188E0ACB17`.
- Portable ZIP: 12,129,531 bytes, SHA-256
  `BDB9F1EF079684FD8EED48EE025ACC5BABDFEE9D38AA856913818D735048B5FF`.
- The ZIP contains 24 entries / 16 files. Its formal EXE hash exactly matches
  the disk EXE. The package contains two expected executables: the desktop EXE
  and CLI runtime.
- Release safety and compliance both report `Issues: 0`, `OK`. Package and ZIP
  contain no Debug, Setup, installer, NSIS or `.nsi` entry.
- Native Windows FileVersion/ProductVersion fields remain empty, the same known
  packaging gap as the earlier candidates; application metadata and build
  ldflags remain V2.0.3.

## Runtime Boundary

- The candidate was not launched or promoted. PID 63580 remains the unchanged
  loopback Bridge on `127.0.0.1:47631`.
- The formal V2.0.3 release attachment, V2.0.2.1 archive and all previous
  isolated candidates remain unchanged.
- Photoshop PID 33288 remains open with an unsaved disposable document. No
  save, close, Generate action or provider request was performed in this build.
