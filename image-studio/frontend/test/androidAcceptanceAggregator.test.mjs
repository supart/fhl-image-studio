import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));
const scriptsRoot = join(repoRoot, "scripts");
const aggregator = join(scriptsRoot, "finalize-android-emulator-acceptance.ps1");
const verifier = join(scriptsRoot, "verify-android-phone-debug-base.ps1");
const officialCertificate = "6B04A805E50CF66E37C740AD0336BBDF6445653F93802005967BABF472E8DA36";
const apkHash = "A".repeat(64);
const buildId = "aggregate-selftest";

const specs = {
  singleClick: { scenario: "Single", jobs: 1, perRun: 1, runs: 1 },
  tenSlotRoundRobin: { scenario: "Sequential", jobs: 10, perRun: 10, runs: 1 },
  pool40: { scenario: "Pool40", jobs: 40, perRun: 40, runs: 1 },
  queue60: { scenario: "Queue60", jobs: 60, perRun: 60, runs: 1 },
  homeBackground: { scenario: "Home", jobs: 10, perRun: 1, runs: 10 },
  coldStartInterrupt: { scenario: "ColdStart", jobs: 10, perRun: 1, runs: 10 },
  api36Stability: { scenario: "Sequential", jobs: 80, perRun: 10, runs: 8 },
  api28: { scenario: "Single", jobs: 1, perRun: 1, runs: 1 },
  api34Phone: { scenario: "Single", jobs: 1, perRun: 1, runs: 1 },
  api34Tablet: { scenario: "Single", jobs: 1, perRun: 1, runs: 1 },
  api36: { scenario: "Single", jobs: 1, perRun: 1, runs: 1 },
  offlineFailureAttribution: { scenario: "Offline", jobs: 1, perRun: 1, runs: 1 },
};

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex").toUpperCase();
}

function fileEntry(directory, role, path) {
  const fullPath = join(directory, path);
  return { role, path, sizeBytes: readFileSync(fullPath).byteLength, sha256: sha256(fullPath) };
}

function deviceMetadata(role) {
  if (role === "api28") return { sdkInt: 28, formFactor: "phone", widthPx: 1080, heightPx: 1920, densityDpi: 420 };
  if (role === "api34Phone") return { sdkInt: 34, formFactor: "phone", widthPx: 1080, heightPx: 1920, densityDpi: 420 };
  if (role === "api34Tablet") return { sdkInt: 34, formFactor: "tablet", widthPx: 2560, heightPx: 1600, densityDpi: 320 };
  return { sdkInt: 36, formFactor: "phone", widthPx: 1440, heightPx: 3200, densityDpi: 560 };
}

function addAudit(lines, state, type, details) {
  state.sequence += 1;
  state.timestamp += 1;
  const record = {
    version: 2,
    timestamp: state.timestamp,
    processSessionId: state.session,
    processId: state.pid,
    auditSequence: state.sequence,
    type,
    details,
  };
  state.records.push({ type, ...details });
  lines.push(`${(state.timestamp / 1000).toFixed(3)} ${state.pid} ${state.pid} I FHLImageStudioJobs: Job audit ${JSON.stringify(record)}`);
}

function buildRun({ directory, role, runIndex, head, verifierHash, global }) {
  const spec = specs[role];
  const status = role === "coldStartInterrupt" ? "interrupted" : role === "offlineFailureAttribution" ? "failed" : "succeeded";
  const results = [];
  const attempts = [];
  const auditLines = [];
  const audit = { pid: 4100 + global.run, session: `android-process-${randomUUID()}`, sequence: 0, timestamp: 1_800_000_000_000 + global.run * 10_000, records: [] };
  addAudit(auditLines, audit, "process_started", { registryVersion: 3 });
  for (let index = 0; index < spec.perRun; index += 1) {
    global.task += 1;
    const slot = spec.perRun % 10 === 0 ? (index % 10) + 1 : ((global.task - 1) % 10) + 1;
    const ids = {
      groupId: `group-${global.task}`,
      jobId: `job-${global.task}`,
      clientSubmissionId: `submission-${global.task}`,
      requestRunId: `request-${global.task}`,
    };
    const core = {
      ...ids,
      apiMode: "images",
      apiLabel: `FHL${slot}`,
      fhlImagesPoolSlot: slot,
      queueSequence: global.task,
      reservationActive: true,
      reservationKind: "fhl_images_pool",
      reservationSlot: slot,
      status: "running",
      errorMessageChars: 0,
    };
    addAudit(auditLines, audit, "submit", { ...core, jobId: "", queueSequence: 0, reservationActive: false, reservationKind: "", reservationSlot: 0, status: "" });
    addAudit(auditLines, audit, "slot_claimed", core);
    addAudit(auditLines, audit, "upstream_submit_attempt", core);
    addAudit(auditLines, audit, status === "failed" ? "slot_error" : "slot_terminal", { ...core, status });
    addAudit(auditLines, audit, "slot_reservation_released", { ...core, reservationActive: false, status });
    results.push({
      sequence: index + 1,
      expectedSlot: slot,
      expectedLabel: `FHL${slot}`,
      ...ids,
      status,
      groupCount: 1,
      taskCount: 1,
      postCount: 1,
      historyLabel: `FHL${slot}`,
    });
    attempts.push({ timestamp: audit.timestamp, ...ids, apiMode: "images", apiLabel: `FHL${slot}`, fhlImagesPoolSlot: slot });
  }
  if (role === "coldStartInterrupt") {
    audit.pid += 1000;
    audit.session = `android-process-${randomUUID()}`;
    audit.sequence = 0;
    addAudit(auditLines, audit, "process_started", { registryVersion: 3 });
  }
  mkdirSync(directory, { recursive: true });
  const artifacts = {
    screenshot: "",
    redactedLogcat: "",
    nativeSchedulerAudit: "",
    hostQueueSamples: "",
    schedulerMetrics: "",
    loadCheckpoint: "",
    releaseLogcat: "release-logcat-audit-redacted.txt",
    evidenceManifest: "evidence-manifest.json",
    deviceRuntimeMetrics: "device-runtime-metrics.json",
    crashAnrLogcat: "crash-anr-logcat-redacted.txt",
  };
  const scheduler = role === "pool40" || role === "queue60" ? {
    expectedTasks: spec.perRun,
    expectedPerSlot: role === "pool40" ? 4 : 6,
    totalPeak: 40,
    perSlotPeak: Array.from({ length: 10 }, (_, index) => ({ slot: index + 1, peak: 4 })),
    sampledQueuePeak: role === "queue60" ? 20 : 0,
    capacityCheckpointQueued: role === "queue60" ? 20 : 0,
    fifoQueueSequence: true,
    hostCheckpointPassed: true,
    auditEvents: auditLines.length,
    submits: spec.perRun,
    claims: spec.perRun,
    releases: spec.perRun,
    upstreamPosts: spec.perRun,
    terminals: spec.perRun,
    uniqueSubmissionIds: spec.perRun,
  } : null;
  if (scheduler) {
    Object.assign(artifacts, {
      nativeSchedulerAudit: "native-scheduler-audit.json",
      hostQueueSamples: "host-queue-samples.json",
      schedulerMetrics: "scheduler-metrics.json",
      loadCheckpoint: "load-checkpoint.json",
    });
    const expectedQueued = role === "queue60" ? 20 : 0;
    const expectedPerSlot = role === "queue60" ? 6 : 4;
    const capacitySample = {
      phase: "capacity-checkpoint",
      running: 40,
      queued: expectedQueued,
      succeeded: 0,
      failed: 0,
      cancelled: 0,
      interrupted: 0,
      activeReservations: 40,
      perSlot: Array.from({ length: 10 }, (_, index) => ({
        slot: index + 1,
        running: 4,
        queued: expectedPerSlot - 4,
        activeReservations: 4,
        terminal: 0,
      })),
    };
    writeJson(join(directory, artifacts.nativeSchedulerAudit), audit.records.filter((event) => event.type !== "process_started"));
    writeJson(join(directory, artifacts.hostQueueSamples), [capacitySample]);
    writeJson(join(directory, artifacts.schedulerMetrics), scheduler);
    writeJson(join(directory, artifacts.loadCheckpoint), { status: "completed", scheduler });
  }
  writeFileSync(join(directory, artifacts.releaseLogcat), `${auditLines.join("\n")}\n`, "utf8");
  const runtimeMetrics = {
    schemaVersion: 1,
    before: { totalPssKiB: 200_000 + global.run * 10, frozenFrames: 0, thermalStatus: 1 },
    after: { totalPssKiB: 200_010 + global.run * 10, frozenFrames: 0, thermalStatus: 1 },
    pssDeltaKiB: 10,
    frozenFrameDelta: 0,
    crashOrAnrCount: 0,
    noCrashOrAnr: true,
  };
  writeJson(join(directory, artifacts.deviceRuntimeMetrics), runtimeMetrics);
  writeFileSync(join(directory, artifacts.crashAnrLogcat), "", "utf8");
  writeJson(join(directory, "upstream-submit-attempts.json"), attempts);
  const binding = {
    apkSha256: apkHash,
    installedApkSha256: apkHash,
    candidateGitCommit: head,
    productGitCommit: head,
    verifierGitCommit: head,
    verifierScriptSha256: verifierHash,
    apkServiceIdentity: `android-V2.0.3-${head}-${buildId}`,
    apkBuildId: buildId,
    package: "top.fangtangyuan.fhlstudio.android",
    apkCertificateSha256: officialCertificate,
    apkDebuggable: false,
    apkSignatureV2: true,
  };
  const report = {
    schemaVersion: 2,
    scenario: spec.scenario,
    acceptanceRole: role,
    evidenceSource: "ReleaseLogcat",
    status: "passed",
    startedAt: new Date(1_800_000_000_000 + global.run * 60_000).toISOString(),
    finishedAt: new Date(1_800_000_030_000 + global.run * 60_000).toISOString(),
    ...binding,
    apkFile: "candidate.apk",
    device: `emulator-${5554 + global.run * 2}`,
    deviceMetadata: deviceMetadata(role),
    metrics: {
      clicks: spec.perRun,
      groups: spec.perRun,
      tasks: spec.perRun,
      upstreamPosts: spec.perRun,
      observationPostDelta: role === "coldStartInterrupt" || role === "offlineFailureAttribution" ? 0 : null,
    },
    results,
    scheduler,
    runtimeMetrics,
    stabilityFinalRun: role === "api36Stability" && runIndex === spec.runs - 1,
    stabilityCooldownSeconds: role === "api36Stability" && runIndex === spec.runs - 1 ? 300 : 0,
    artifacts,
  };
  writeJson(join(directory, "acceptance-report.json"), report);
  const entries = [
    fileEntry(directory, "report", "acceptance-report.json"),
    fileEntry(directory, "upstreamSubmitAttempts", "upstream-submit-attempts.json"),
    fileEntry(directory, "releaseLogcat", artifacts.releaseLogcat),
    fileEntry(directory, "deviceRuntimeMetrics", artifacts.deviceRuntimeMetrics),
    fileEntry(directory, "crashAnrLogcat", artifacts.crashAnrLogcat),
  ];
  for (const artifactRole of ["nativeSchedulerAudit", "hostQueueSamples", "schedulerMetrics", "loadCheckpoint"]) {
    if (artifacts[artifactRole]) entries.push(fileEntry(directory, artifactRole, artifacts[artifactRole]));
  }
  writeJson(join(directory, "evidence-manifest.json"), {
    schemaVersion: 1,
    generator: "verify-android-phone-debug-base.ps1",
    terminalStatus: "passed",
    scenario: spec.scenario,
    acceptanceRole: role,
    evidenceSource: "ReleaseLogcat",
    binding,
    files: entries,
  });
}

test("Android acceptance aggregator recomputes 216 raw tasks and rejects a tampered run", { skip: process.platform !== "win32", timeout: 60_000 }, () => {
  const root = mkdtempSync(join(tmpdir(), "android-acceptance-aggregate-"));
  try {
    const evidenceRoot = join(root, "evidence");
    const output = join(root, "finalized");
    const runManifestPath = join(root, "run-manifest.json");
    mkdirSync(evidenceRoot, { recursive: true });
    const head = execFileSync("git", ["-C", repoRoot, "rev-parse", "HEAD"], { encoding: "utf8" }).trim().toLowerCase();
    const verifierHash = sha256(verifier);
    const runs = [];
    const global = { task: 0, run: 0 };
    for (const [role, spec] of Object.entries(specs)) {
      for (let index = 0; index < spec.runs; index += 1) {
        global.run += 1;
        const relativeDirectory = `runs/${role}-${String(index + 1).padStart(2, "0")}`;
        buildRun({ directory: join(evidenceRoot, relativeDirectory), role, runIndex: index, head, verifierHash, global });
        runs.push({ relativeDirectory, acceptanceRole: role });
      }
    }
    assert.equal(global.task, 216);
    writeJson(runManifestPath, { schemaVersion: 1, runs });
    const common = [
      "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", aggregator,
      "-EvidenceRoot", evidenceRoot,
      "-ExpectedApkSha256", apkHash,
      "-ExpectedGitCommit", head,
      "-ExpectedBuildId", buildId,
    ];
    const created = execFileSync("powershell.exe", [...common, "-Mode", "Create", "-RunManifest", runManifestPath, "-OutputDirectory", output], { encoding: "utf8" });
    assert.match(created, /aggregate created and verified/);
    const aggregateReport = join(output, "android-emulator-acceptance.json");
    const aggregate = JSON.parse(readFileSync(aggregateReport, "utf8"));
    assert.equal(aggregate.totalJobs, 216);
    assert.equal(aggregate.inputs.length, 37);
    const tamperedPath = join(evidenceRoot, runs[0].relativeDirectory, "upstream-submit-attempts.json");
    writeFileSync(tamperedPath, `${readFileSync(tamperedPath, "utf8")} `, "utf8");
    assert.throws(() => execFileSync("powershell.exe", [...common, "-Mode", "Verify", "-AggregateReport", aggregateReport], { encoding: "utf8", stdio: "pipe" }));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
