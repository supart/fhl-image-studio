# Codex Browser E2E Configuration Diagnosis

Date: 2026-07-27

## Scope

- Diagnose why every visible FHL configuration test in the Codex in-app
  browser reports failure.
- Do not modify production behavior, click connectivity-test actions, run
  generation, call paid upstream APIs, or inspect complete credentials.

## Evidence

- Browser URL: `http://127.0.0.1:9230/`.
- Candidate PID 20016 command line includes
  `--e2e-only --e2e-port 9230`.
- Candidate EXE SHA-256:
  `AE7DA252C5C35E89826D14C9E0E2FBE2CC6A06EFAE4ABD71EC3133188E0ACB17`.
- The configuration dialog displays the exact text-test response
  `404` / `capability is disabled in E2E mode`.
- `registerE2EDisabledRoutes` in `image-studio/e2e_server.go` intentionally
  maps the local-config and FHL/APIMart provider proxy prefixes to that fixed
  404 response.
- `image-studio/e2e_server_test.go` asserts that these routes remain disabled.
- The browser console contained no frontend exception for this interaction.

## Conclusion

The visible failures are expected in the E2E-only browser harness. They do not
prove that any saved API key is invalid and do not indicate a frontend crash.
Real connection validity can only be evaluated from a normally launched
desktop process where the native credential store and provider proxy routes are
enabled.

## Safety

- No test or save-and-test action was clicked.
- No generation job or paid upstream request was made.
- No complete API key, session token, request body or response payload was
  read or recorded.
- The existing normal desktop process was not stopped or modified.

## Follow-up Launch

- After the diagnosis was reported, the user explicitly requested a
  configuration-capable launch for plugin closeout.
- The obsolete normal candidate PID 63580 and E2E-only candidate PID 20016
  were closed.
- The latest closeout candidate with the same recorded AE7DA252...ACB17 hash
  was launched normally as PID 70612, with no E2E arguments.
- Its visible `FHL Studio` window is responsive and owns the loopback Bridge
  listener on port 47631. Public health reports `profileReady=false` until the
  user finishes configuration.
- No connectivity test or paid upstream request was initiated by Codex.
