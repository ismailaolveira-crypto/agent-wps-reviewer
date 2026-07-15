# Acceptance Audit

This product is accepted by evidence, not by intent. The background audit checks the parts that can be verified without interrupting the user:

```bash
npm run acceptance:audit
```

The audit currently proves:

- The automated test suite passes.
- CLI and MCP agent entry points can submit suggestions to the local bridge.
- The shared agent JSON Schema and example payloads match the bridge validation rules.
- The internal installer can write WPS add-in config and verify the resulting local bridge URL in a temporary jsaddons directory.
- The optional macOS LaunchAgent plist or Windows user-level Task Scheduler definition can be written to and removed without loading/starting WPS.
- WPS ribbon, add-in bootstrap, task pane, app, adapter, and style resources are served at the expected paths.
- Installed WPS config, release template config, and bootstrap JavaScript use consistent local URLs.
- The exact `127.0.0.1:17531` URL installed into WPS can serve the add-in resources during a short background readiness check.
- Real WPS task pane events, if present, can satisfy the foreground gates only when they come from `adapterMode: "wps"`, include task pane opened, suggestion located, and comment created, and carry the current `productVersion` and `buildFingerprint` stamped by the bridge.
- The release package can be built.
- WPS add-in config files exist in the user jsaddons directory.
- WPS is installed and readable from the background.
- `acceptance:audit` reports `backgroundReady`, `platformForegroundAccepted`, `noviceInstallAccepted`, and `releasePromotable` separately; none of these fields is inferred from a browser mock.

The audit deliberately does not claim final completion. These checks still require a foreground WPS validation window:

- The `Agent 审阅` ribbon appears in WPS after an allowed restart.
- The side task pane opens inside WPS.
- A submitted suggestion appears in the task pane.
- Approving a suggestion creates a real WPS comment in the real document while leaving the body text unchanged.

Use this command for the final readiness check during an allowed WPS test window:

```bash
npm run acceptance:prepare
```

This refreshes `output/acceptance-kit/`, starts the local bridge, verifies the WPS add-in resources, and submits the sample suggestion to the `default` session.

Check the current readiness state at any time:

```bash
npm run acceptance:status
```

When the task pane runs inside real WPS, it records these foreground events back to the local bridge:

- `taskpane.opened`
- `suggestion.commented`
- `suggestion.located`

Browser mock mode does not count for final WPS acceptance. After the foreground check, run:

```bash
npm run acceptance:wait
npm run acceptance:validate-manual
npm run acceptance:audit
```

`acceptance:wait` only polls local evidence files. It does not start, restart, focus, or control WPS.

Acceptance events are build-bound. Events recorded by an older bridge, events without a build identity, and events whose fingerprint does not match the current runtime remain in `data/review-store.json` for audit history but are ignored for the current foreground gate. This prevents a previous WPS run from being presented as proof for a changed product.

On Windows, real evidence must additionally include:

- `platform: "win32"`
- Windows `osVersion` and `osArch`
- WPS `wpsArch` (x86/x64/ARM64 or the value reported by the installed WPS build)
- the bridge `runtimeInstanceId`

The Windows installer reports `publishReady`, `wpsTrustPending`, and `wpsTrusted` separately. A written `publish.xml` is not evidence that WPS has completed its official trust installation.

After the manual WPS check, stop the local bridge if it should not keep running:

```bash
npm run bridge:stop
```

If automatic WPS events are not available, record the evidence manually:

```bash
npm run acceptance:record -- \
  --wps-version "12.1.25895" \
  --document output/acceptance-kit/wps-reviewer-acceptance.docx \
  --taskpane-evidence "Agent 审阅 tab and 审阅收件箱 side pane were visible in WPS." \
  --mutation-evidence "The sample suggestion was located, a WPS comment was created, and the document body remained unchanged."
```

For Windows, also pass `--platform win32 --os-version <Windows-build> --os-arch <OS-arch> --wps-arch <WPS-arch> --runtime-instance-id <bridge-id>`.

This writes `output/manual-acceptance.json`. `npm run acceptance:audit` will only mark the manual gates as passed after either automatic WPS events or this manual evidence validates.

Manual evidence records the current product version and build fingerprint automatically. Evidence copied from a different release must be re-recorded in the current release's WPS acceptance window.
