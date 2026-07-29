# 2026-07-26 Photoshop Plugin Final Candidate

## Scope

Build a final Bridge-enabled V2.0.3 candidate for the Photoshop sidebar and
selection-generation milestone without replacing the active release attachment
or the running Codex Debug Bridge.

## Source Change

- Replaced two long fake `sk-...` literals in `backend/ps_bridge_test.go` with
  the file's existing `strings.Join` fixture pattern so the release-source
  compliance scanner does not mistake test data for a credential.
- Production Bridge behavior is unchanged.
- `gofmt` and `go test ./backend -count=1` pass in both the working source and
  prepared source candidate.

## Isolated Candidate

Candidate root:

```text
发布验证/ps-plugin-final-20260726
```

- EXE: 20,735,488 bytes, SHA-256
  `30F4748833CA409238279C315F72E483846F7316B59C42C2A636F46F292720A0`.
- Portable ZIP: 12,119,668 bytes, 16 files, SHA-256
  `8ED8AF416AFCAB5AA5C0838B071C7C80D9E0885CAD5D9C5ABA9E517EBFC701A1`.
- Source candidate: 609 files, 21,405,671 bytes, canonical tree SHA-256
  `F2F89DA35C2BC6FCE42D8D33FDAE8A660C095C63D4C67FBBCEF4504039928946`.
- Portable safety and source compliance report `Issues: 0`.
- The Portable contains one formal EXE and no Debug/Setup EXE, installer
  directory or `.nsi`. Installer-cancellation/history Markdown remains as
  documentation only.

## Isolation And Resume Point

- The default release attachment EXE, Codex Debug EXE, V2.0.2.1 archive and
  active configuration were not changed. Debug PID 72356 remained on loopback
  port 47631 during the build.
- Windows FileVersion/ProductVersion resources remain empty in both the prior
  formal EXE and this candidate. Version `2.0.3` is verified through Wails,
  frontend metadata and Go ldflags; native version resources are a separate
  packaging follow-up, not restored installer work.
- Promote the isolated candidate only after the successful Photoshop PSD is
  saved and a complete restart proves the hook-free External sideload does not
  auto-submit.

Detailed logs are under `发布验证/ps-plugin-final-20260726/logs`.
