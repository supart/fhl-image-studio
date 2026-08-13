import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const studioStore = readFileSync(new URL("../src/state/studioStore.ts", import.meta.url), "utf8");
const runtimeHost = readFileSync(new URL("../src/platform/runtime/host.ts", import.meta.url), "utf8");
const androidParametersCSS = readFileSync(new URL("../src/styles/_android-parameters.css", import.meta.url), "utf8");
const androidJobManager = readFileSync(
  new URL("../../../android-shell/app/src/main/java/top/gptcodex/imagestudio/android/AndroidJobManager.kt", import.meta.url),
  "utf8",
);
const androidJobNotifications = readFileSync(
  new URL("../../../android-shell/app/src/main/java/top/gptcodex/imagestudio/android/AndroidJobNotifications.kt", import.meta.url),
  "utf8",
);
const mainActivity = readFileSync(
  new URL("../../../android-shell/app/src/main/java/top/gptcodex/imagestudio/android/MainActivity.kt", import.meta.url),
  "utf8",
);
const frontendMain = readFileSync(new URL("../src/main.tsx", import.meta.url), "utf8");
const androidImageStudioBridge = readFileSync(
  new URL("../../../android-shell/app/src/main/java/top/gptcodex/imagestudio/android/AndroidImageStudioBridge.kt", import.meta.url),
  "utf8",
);
const androidJobClient = readFileSync(
  new URL("../src/platform/runtime/androidJobClient.ts", import.meta.url),
  "utf8",
);
const phoneDebugVerifierUrl = new URL("../../../scripts/verify-android-phone-debug-base.ps1", import.meta.url);
const phoneDebugVerifierPath = fileURLToPath(phoneDebugVerifierUrl);
const phoneDebugVerifier = readFileSync(phoneDebugVerifierUrl, "utf8");
const bulkGridVerifier = readFileSync(
  new URL("../../../scripts/verify-android-bulk-ui-and-grid.mjs", import.meta.url),
  "utf8",
);
const reproducibleVerifier = readFileSync(
  new URL("../../../scripts/verify-android-reproducible-v2.0.3.ps1", import.meta.url),
  "utf8",
);
const releaseVerifier = readFileSync(
  new URL("../../../scripts/verify-android-v2.0.3.ps1", import.meta.url),
  "utf8",
);
const acceptanceAggregator = readFileSync(
  new URL("../../../scripts/finalize-android-emulator-acceptance.ps1", import.meta.url),
  "utf8",
);
const phoneDebugSecurityCollector = readFileSync(
  new URL("../../../scripts/collect-android-phone-debug-security-scan.ps1", import.meta.url),
  "utf8",
);
const releaseSafetyVerifier = readFileSync(
  new URL("../../../scripts/check-android-release-safety.ps1", import.meta.url),
  "utf8",
);
const androidBuildGradle = readFileSync(
  new URL("../../../android-shell/app/build.gradle.kts", import.meta.url),
  "utf8",
);
const androidReleaseWorkflow = readFileSync(
  new URL("../../../.github/workflows/android-release.yml", import.meta.url),
  "utf8",
);

test("Android public Release cannot fall back to the Debug signing identity", () => {
  assert.match(androidBuildGradle, /signingConfig = signingConfigs\.getByName\("release"\)/);
  assert.match(androidBuildGradle, /customKeystorePath\.orNull\?\.let \{ storeFile = file\(it\) \}/);
  assert.match(androidBuildGradle, /Release signing requires IMAGE_STUDIO_KEYSTORE_PATH/);
  assert.match(androidBuildGradle, /tasks\.register\("validateReleaseSigningEnvironment"\)/);
  assert.match(androidBuildGradle, /"assembleRelease"/);
  assert.match(androidBuildGradle, /dependsOn\(validateReleaseSigningEnvironment\)/);
  assert.doesNotMatch(androidBuildGradle, /orElse\(fallbackDebugKeystore\)/);
  assert.doesNotMatch(androidBuildGradle, /signingConfig = if \(customKeystorePath\.isPresent\)/);
});

test("Android public Release excludes nondeterministic encrypted dependency metadata", () => {
  assert.match(androidBuildGradle, /dependenciesInfo\s*\{/);
  assert.match(androidBuildGradle, /includeInApk = false/);
  assert.match(androidBuildGradle, /includeInBundle = false/);
});

test("Android GitHub workflow only creates manually reviewed artifacts", () => {
  assert.match(androidReleaseWorkflow, /workflow_dispatch:/);
  assert.match(androidReleaseWorkflow, /permissions:\s*\n\s*contents: read/);
  assert.match(androidReleaseWorkflow, /IMAGE_STUDIO_GIT_COMMIT: \$\{\{ github\.sha \}\}/);
  assert.match(androidReleaseWorkflow, /IMAGE_STUDIO_BUILD_ID: android-v2\.0\.3-release/);
  assert.match(androidReleaseWorkflow, /Upload review artifacts/);
  assert.doesNotMatch(androidReleaseWorkflow, /\bpush:/);
  assert.doesNotMatch(androidReleaseWorkflow, /action-gh-release|Publish GitHub Release|contents: write/);
});

test("Android phone verifier reconnects only for transient CDP reload failures", () => {
  assert.match(phoneDebugVerifier, /function Invoke-CdpExpressionOnce/);
  assert.match(phoneDebugVerifier, /for \(\$attempt = 1; \$attempt -le 3; \$attempt \+= 1\)/);
  assert.match(phoneDebugVerifier, /Execution context was destroyed\|CDP target closed the connection/);
  assert.match(phoneDebugVerifier, /\$message -notmatch \$transientPattern/);
});

test("Android explicit paid UI clicks cannot be replayed after an unknown CDP outcome", () => {
  const start = phoneDebugVerifier.indexOf("function Click-GenerateOnce");
  const end = phoneDebugVerifier.indexOf("function Invoke-LoadClickBlock", start);
  assert.ok(start >= 0 && end > start, "paid click helper should exist");
  const click = phoneDebugVerifier.slice(start, end);
  assert.match(click, /Invoke-CdpExpressionOnce -Expression \$expression/);
  assert.doesNotMatch(click, /Invoke-CdpExpression -Expression/);
  assert.match(click, /unknown outcome and must not be replayed/);
});

test("Android MatrixSingle paid click supports phone and tablet without replay", () => {
  const start = phoneDebugVerifier.indexOf("function Click-MatrixGenerateOnce");
  const end = phoneDebugVerifier.indexOf("function Click-GenerateOnce", start);
  assert.ok(start >= 0 && end > start, "MatrixSingle paid click helper should exist");
  const click = phoneDebugVerifier.slice(start, end);
  assert.ok(click.includes('.android-phone-compose,.android-pad-compose'));
  assert.ok(click.includes('textarea.android-phone-prompt-input,textarea.android-pad-prompt-textarea'));
  assert.match(click, /Invoke-CdpExpressionOnce -Expression \$expression/);
  assert.doesNotMatch(click, /Invoke-CdpExpression -Expression/);
  assert.match(click, /unknown outcome and must not be replayed/);
  assert.ok(click.includes('targetPlatform==="android"&&composeKind!=="phone"'));
  assert.ok(click.includes('targetPlatform==="android-pad"&&composeKind!=="tablet"'));
});

test("Android dynamic security scan retries only transient local read errors", () => {
  assert.match(phoneDebugSecurityCollector, /\$outputStem-source-apk-safety\.json/);
  assert.match(phoneDebugSecurityCollector, /\$outputStem-source-apk-safety-retry\.json/);
  assert.match(phoneDebugSecurityCollector, /\$onlyTransientReadErrors = \$safety -and \$firstSourceReadErrors -gt 0 -and \[int\]\$safety\.issueCount -eq \$firstSourceReadErrors/);
  assert.match(phoneDebugSecurityCollector, /if \(\$onlyTransientReadErrors\)/);
  assert.match(phoneDebugSecurityCollector, /sourceAndApkScan = \[ordered\]@\{/);
  assert.match(phoneDebugSecurityCollector, /firstReadErrors = \$firstSourceReadErrors/);
});

test("Android source safety enumerates Unicode tracked paths as UTF-8", () => {
  assert.match(releaseSafetyVerifier, /"core\.quotepath=false", "ls-files", "-z"/);
  assert.match(releaseSafetyVerifier, /\$startInfo\.StandardOutputEncoding = \[Text\.Encoding\]::UTF8/);
  assert.match(releaseSafetyVerifier, /\$stdout -split "`0"/);
  assert.doesNotMatch(releaseSafetyVerifier, /@\(& \$git\.Source -C \$resolvedRoot ls-files/);
});

test("Android shell enables native background jobs when the bridge is available", () => {
  assert.match(
    studioStore,
    /function isAndroidTaskProxyMode\(\): boolean \{\s*return detectHostKind\(\) === "android-shell" && canUseAndroidJobs\(\);\s*\}/,
  );
});

test("Packaged Android generation checks the native job bridge before remote fallback", () => {
  assert.match(runtimeHost, /const ANDROID_APP_ASSETS_HOST = "appassets\.androidplatform\.net";/);
  assert.match(runtimeHost, /const ANDROID_JOB_BRIDGE_UNAVAILABLE_MESSAGE = "Android 后台 Bridge 不可用，请重启 App";/);
  const generatePath = runtimeHost.slice(
    runtimeHost.indexOf("export function Generate"),
    runtimeHost.indexOf("export function Edit"),
  );
  const editPath = runtimeHost.slice(
    runtimeHost.indexOf("export function Edit"),
    runtimeHost.indexOf("export function OptimizePrompt"),
  );
  for (const path of [generatePath, editPath]) {
    assert.ok(path.indexOf("missingPackagedAndroidJobBridgeError()") >= 0);
    assert.ok(path.indexOf("missingPackagedAndroidJobBridgeError()") < path.indexOf("startRemoteJob"));
  }
});

test("Android native background jobs take over all image generation APIs", () => {
  assert.match(studioStore, /if \(isBrowserTaskProxyMode\(\)\) return true;/);
  assert.match(studioStore, /void apiMode;/);
  assert.match(studioStore, /return isAndroidTaskProxyMode\(\);/);
  assert.match(runtimeHost, /return detectHostKind\(\) === "android-shell" && canUseAndroidJobs\(\);/);
  assert.match(runtimeHost, /apiMode: normalizeHostAPIMode\(options\.apiMode\)/);
  assert.match(androidJobManager, /val submittedAPIMode = payload\.optString\("apiMode", "responses"\)/);
  assert.match(androidJobManager, /val apiMode = normalizeSubmissionAPIMode\(submittedAPIMode\)/);
  assert.match(
    androidJobManager,
    /validatedNewSubmissionFHLPoolSlot\(\s*apiMode,\s*baseURL,\s*rawFHLImagesPoolSlot/,
  );
  assert.match(androidJobManager, /private fun normalizeSubmissionAPIMode\(raw: String\): String/);
  assert.match(androidJobManager, /官方 FHL 生图任务缺少合法的 FHL1-FHL10 槽位/);
  assert.match(androidJobManager, /\.put\("apiMode", apiMode\)/);
  assert.doesNotMatch(androidJobManager, /if \(apiMode != "responses"\)/);
  assert.match(androidJobManager, /"images" -> requestImages\(context, jobId, slotPayload, startedAt\)/);
  assert.match(androidJobManager, /else -> requestResponses\(context, jobId, slotPayload, startedAt\)/);
  assert.match(androidJobManager, /"apimart" -> requestAPIMart\(context, jobId, slotPayload, startedAt\)/);
  assert.match(androidJobManager, /"runninghub" -> requestRunningHub\(context, jobId, slotPayload, startedAt\)/);
  assert.match(androidJobManager, /private fun paidSubmissionAttemptNumbers\(apiMode: String\): IntRange/);
  assert.doesNotMatch(androidJobManager, /WithRetries|maxAttempts|retryBackoffMs/);
});

test("Android native APIMart parser accepts array-wrapped task responses", () => {
  assert.match(androidJobManager, /private fun extractTaskId\(value: Any\?, depth: Int = 0\): String/);
  assert.match(androidJobManager, /if \(value is JSONArray\) \{\s*for \(i in 0 until value\.length\(\)\) \{\s*val nested = extractTaskId\(value\.opt\(i\), depth \+ 1\)/);
  assert.match(androidJobManager, /val nested = extractTaskId\(child, depth \+ 1\)/);
  assert.match(androidJobManager, /private fun statusValueFromPayload\(value: Any\?, key: String\? = null, depth: Int = 0\): String/);
  assert.match(androidJobManager, /if \(value is JSONArray\) \{\s*for \(i in 0 until value\.length\(\)\) \{\s*val status = statusValueFromPayload\(value\.opt\(i\), key, depth \+ 1\)/);
});

test("Android native APIMart submit logs only sanitized request fields", () => {
  const diagnostics = androidJobManager.match(/private fun logAPIMartSubmitDiagnostics[\s\S]*?\n    private fun resultImagesFromPayload/)?.[0] ?? "";
  assert.ok(diagnostics, "APIMart submit diagnostics should exist");
  assert.match(androidJobManager, /logAPIMartSubmitDiagnostics\(baseUrl, body\)/);
  assert.match(diagnostics, /\.put\("baseURLHost", hostForURL\(baseUrl\)\)/);
  assert.match(diagnostics, /\.put\("size", body\.optString\("size"\)\)/);
  assert.match(diagnostics, /\.put\("resolution", body\.optString\("resolution"\)\)/);
  assert.match(diagnostics, /\.put\("official_fallback", body\.optBoolean\("official_fallback", true\)\)/);
  assert.match(diagnostics, /\.put\("image_urls_count", body\.optJSONArray\("image_urls"\)\?\.length\(\) \?: 0\)/);
  assert.doesNotMatch(diagnostics, /apiKey/);
  assert.doesNotMatch(diagnostics, /prompt/);
});

test("Android native APIMart jobs resume polling existing task IDs without resubmitting", () => {
  assert.match(androidJobManager, /val existingAPIMartTaskId = slot\.optString\("apimartTaskId"\)\.trim\(\)/);
  assert.match(androidJobManager, /slotPayload\.put\("apimartTaskId", existingAPIMartTaskId\)/);
  assert.match(androidJobManager, /val existingTaskId = payload\.optString\("apimartTaskId"\)\.trim\(\)/);
  const resumeBranch = androidJobManager.match(/if \(existingTaskId\.isNotBlank\(\)\) \{[\s\S]*?return JobImageResult\(/)?.[0] ?? "";
  assert.ok(resumeBranch, "APIMart resume branch should return through a recovered JobImageResult");
  assert.match(resumeBranch, /pollAPIMartTask\(context, jobId, baseUrl, apiKey, existingTaskId, payload, attempt, startedAt\)/);
  assert.doesNotMatch(resumeBranch, /submitAPIMartTask/);
  assert.doesNotMatch(resumeBranch, /uploadAPIMartImage/);
});

test("Android native recovery interrupts direct jobs and only resumes safe APIMart queries", () => {
  const reconcile = androidJobManager.match(/private fun reconcilePendingJobsLocked[\s\S]*?\n    private fun markDeadRunningJobsInterruptedLocked/)?.[0] ?? "";
  assert.ok(reconcile, "reconcilePendingJobsLocked should exist");
  assert.match(reconcile, /val sameProcessSession = group\.optString\("processSessionId"\) == processSessionId/);
  assert.match(reconcile, /val cancelRequested = slot\.optBoolean\("cancelRequested", false\)/);
  assert.match(reconcile, /val credentialAvailable = if \(cancelRequested\) false else temporaryCredentialAvailable\(context, groupId, apiMode\)/);
  assert.match(reconcile, /val action = pendingRecoveryAction\(/);
  assert.match(reconcile, /"resume_apimart_query" ->/);
  assert.match(reconcile, /"App 已恢复，只继续查询 APIMart 任务 \$apimartTaskId"/);
  assert.match(reconcile, /slot\.put\("apimartTaskStatus", "resume_pending"\)/);
  assert.match(reconcile, /"App 或系统重启后已中断未完成任务，未再次提交付费请求。"/);
  assert.doesNotMatch(reconcile, /App 已重启，正在恢复任务/);
});

test("Android activity checks background job recovery again when returning from background", () => {
  assert.match(
    mainActivity,
    /override fun onResume\(\) \{\s*super\.onResume\(\)\s*AndroidJobManager\.resumePendingWork\(applicationContext\)\s*refreshAndroidJobsForPage\(\)\s*\}/,
  );
  assert.match(mainActivity, /AndroidJobManager\.attach\(applicationContext\)/);
  assert.match(mainActivity, /image-studio:android-jobs-resume/);
});

test("Android native jobs notify users when background generation finishes", () => {
  assert.match(androidJobManager, /AndroidJobNotifications\.notifySuccess\(/);
  assert.match(androidJobManager, /AndroidJobNotifications\.notifyFailure\(context, jobId/);
  assert.match(androidJobNotifications, /fun foregroundNotification\(context: Context\): Notification/);
  assert.match(androidJobNotifications, /fun notifySuccess\(/);
  assert.match(androidJobNotifications, /setContentIntent\(openAppIntent\(context\)\)/);
  assert.match(androidJobNotifications, /setAutoCancel\(true\)/);
  assert.match(androidJobNotifications, /Pictures\/ImageStudio/);
});

test("Android job client reattaches native job events after returning to foreground", () => {
  assert.match(androidJobClient, /window\.addEventListener\("focus", refreshEvents\)/);
  assert.match(androidJobClient, /window\.addEventListener\("pageshow", refreshEvents\)/);
  assert.match(androidJobClient, /image-studio:android-jobs-resume/);
  assert.match(androidJobClient, /document\.visibilityState === "visible"/);
  assert.match(androidJobClient, /void attachAndroidJobEvents\(\)\.catch\(\(\) => undefined\)/);
});

test("Android native job callbacks use API 28 compatible JavaScript", () => {
  assert.match(androidImageStudioBridge, /typeof window\.__imageStudioNativeProgress === 'function'/);
  assert.match(androidImageStudioBridge, /typeof window\.__imageStudioAndroidJobEvent === 'function'/);
  assert.doesNotMatch(androidImageStudioBridge, /window\.__imageStudio(?:NativeProgress|AndroidJobEvent)\?\./);
});

test("Android sequential checkpoint recovery is fail-closed and persists the only resumed click", () => {
  const resumeStart = phoneDebugVerifier.indexOf("function Resume-RunningSequentialEvidence");
  const resumeEnd = phoneDebugVerifier.indexOf("function Update-ReportMeasurements", resumeStart);
  assert.ok(resumeStart >= 0 && resumeEnd > resumeStart);
  const resume = phoneDebugVerifier.slice(resumeStart, resumeEnd);
  assert.match(phoneDebugVerifier, /ResumeExistingSequential requires SkipInstall and never reinstalls the APK/);
  assert.match(resume, /recoveredClickedAt = \$null/);
  assert.match(resume, /clickedAtEvidence = "not-retained-after-host-timeout"/);
  assert.match(resume, /unknown paid outcome will not be retried/);
  assert.match(resume, /observedClickedAt = 9/);
  assert.match(resume, /recoveredClicksWithoutTimestamp = 1/);

  const click = resume.indexOf("$click = Click-GenerateOnce");
  const persist = resume.indexOf("Write-AtomicJsonArtifact -Path $resumeClickPath", click);
  const waitForNative = resume.indexOf("$created = Wait-NewNativeGroup", persist);
  assert.ok(click >= 0 && persist > click && waitForNative > persist);
});

test("Android real API load verifier uses non-retrying ten-click UI blocks against a frozen candidate", () => {
  assert.match(phoneDebugVerifier, /ValidateSet\("FreshInstall", "Upgrade", "TransportPersistence", "TransportToResponses", "ResponsesCapability", "Preflight", "Single", "Sequential", "Pool40", "Queue60"/);
  assert.match(phoneDebugVerifier, /\[string\]\$ExpectedGitCommit = ""/);
  assert.match(phoneDebugVerifier, /ExpectedGitCommit must be the complete 40-character candidate commit/);
  assert.match(phoneDebugVerifier, /rev-parse", "--verify", "\$normalizedGitCommit\^\{commit\}"/);
  assert.match(phoneDebugVerifier, /function Get-ApkBuildIdentity/);
  assert.match(phoneDebugVerifier, /IMAGE_STUDIO_SERVICE_INSTANCE_ID/);
  assert.match(phoneDebugVerifier, /Get-ApkBuildIdentity -Path \$resolvedApkPath -GitCommit \$normalizedGitCommit/);
  assert.match(phoneDebugVerifier, /verifierScriptSha256/);
  assert.match(phoneDebugVerifier, /requires the exact committed verifier script/);
  assert.doesNotMatch(phoneDebugVerifier, /gradlew|assembleDebug|npm\s+run\s+build/i);

  const clickStart = phoneDebugVerifier.indexOf("function Invoke-LoadClickBlock");
  const clickEnd = phoneDebugVerifier.indexOf("function Assert-SubmitReadiness", clickStart);
  assert.ok(clickStart >= 0 && clickEnd > clickStart, "load click block should exist");
  const clickBlock = phoneDebugVerifier.slice(clickStart, clickEnd);
  assert.match(clickBlock, /\$Count -ne 10/);
  assert.match(clickBlock, /android-phone-sticky-cta button\.liquid-primary-button/);
  assert.match(clickBlock, /\\u8ffd\\u52a0\\u751f\\u6210/);
  assert.match(clickBlock, /readCursor\(\)!==expectedSlot/);
  assert.match(clickBlock, /native-confirmed pool cursor did not advance/);
  assert.match(clickBlock, /Invoke-CdpExpressionOnce -Expression \$expression/);
  assert.doesNotMatch(clickBlock, /Invoke-CdpExpression -Expression/);
  assert.match(clickBlock, /unknown paid outcome and must not be replayed/);
});

test("Android Single and Sequential verifier freezes either official FHL Images or Responses transport", () => {
  assert.ok(phoneDebugVerifier.includes('[ValidateSet("images", "responses")]'));
  assert.ok(phoneDebugVerifier.includes('[string]$ExpectedFHLTransportMode = "images"'));
  assert.ok(phoneDebugVerifier.includes('profile.apiMode==="images"||profile.apiMode==="responses"'));
  assert.ok(phoneDebugVerifier.includes('url.hostname.toLowerCase()==="www.fhl.mom"'));
  assert.ok(phoneDebugVerifier.includes('transportMode:responsesPressed&&!imagesPressed?"responses"'));
  assert.ok(phoneDebugVerifier.includes('function Assert-ExpectedFHLTransportMode'));
  assert.ok(phoneDebugVerifier.includes('expected the explicit Responses preference to be persisted before any paid click'));
  assert.ok(phoneDebugVerifier.includes('did not freeze the expected $ExpectedFHLTransportMode transport on both group and task'));
  assert.ok(phoneDebugVerifier.includes('[string]$Attempt.apiMode -ne $ExpectedFHLTransportMode'));
  assert.ok(phoneDebugVerifier.includes('return "FHL$PoolSlot · $modeLabel"'));

  const singleStart = phoneDebugVerifier.indexOf("function Invoke-SingleScenario");
  const singleEnd = phoneDebugVerifier.indexOf("function Invoke-CompatibilitySingleScenario", singleStart);
  const single = phoneDebugVerifier.slice(singleStart, singleEnd);
  assert.ok(single.includes('Assert-ExpectedFHLTransportMode -BrowserState $InitialState -Context "Single preflight"'));
  assert.ok(single.includes('expectedHistoryLabel = Get-ExpectedHistorySourceLabel'));
  assert.ok(single.includes('newestSourceLabel -ne $expectedHistoryLabel'));
  assert.ok(single.includes('expectedAPIMode = $ExpectedFHLTransportMode'));

  const sequentialStart = phoneDebugVerifier.indexOf("function Invoke-SequentialScenario");
  const sequentialEnd = phoneDebugVerifier.indexOf("function Invoke-StartupScenario", sequentialStart);
  const sequential = phoneDebugVerifier.slice(sequentialStart, sequentialEnd);
  assert.ok(sequential.includes('Assert-ExpectedFHLTransportMode -BrowserState $InitialState -Context "Sequential preflight"'));
  assert.ok(phoneDebugVerifier.includes('$sequentialMinimumIntervalMilliseconds = 7000L'));
  assert.ok(sequential.includes('Start-Sleep -Milliseconds ([int]$remainingDelay)'));
  assert.ok(sequential.includes('Assert-ExpectedFHLTransportMode -BrowserState $beforeState -Context "$expectedLabel pre-click"'));
  assert.ok(sequential.includes('Assert-ExpectedFHLTransportMode -BrowserState $clickState -Context "$expectedLabel click-time"'));
  assert.ok(sequential.includes('Assert-ExpectedFHLTransportMode -BrowserState $finalState -Context "Sequential completion"'));
  assert.ok(sequential.includes('newestSlotSourceLabel -ne $expectedHistoryLabel'));
  assert.ok(phoneDebugVerifier.includes('Responses transport evidence is currently supported only by TransportPersistence, Single, Sequential, and ResponsesCapability'));

  assert.ok(androidJobManager.includes('val url = "$baseUrl/v1/responses"'));
  assert.ok(androidJobManager.includes('"$baseUrl/v1/images/generations"'));
  assert.ok(androidJobManager.includes('"$baseUrl/v1/images/edits"'));
});

test("Android transport persistence verifier switches both modes across force-stop without paid work", () => {
  assert.ok(phoneDebugVerifier.includes('"TransportPersistence"'));
  assert.ok(phoneDebugVerifier.includes('function Set-FHLTransportModeForVerification'));
  assert.ok(phoneDebugVerifier.includes('function ConvertTo-TransportPersistenceComparableJson'));
  assert.ok(phoneDebugVerifier.includes('function Invoke-TransportPersistenceScenario'));
  const start = phoneDebugVerifier.indexOf('function Invoke-TransportPersistenceScenario');
  const end = phoneDebugVerifier.indexOf('function Invoke-TransportToResponsesScenario', start);
  const scenario = phoneDebugVerifier.slice(start, end);
  assert.ok(scenario.includes('Set-FHLTransportModeForVerification -Mode responses'));
  assert.ok(phoneDebugVerifier.includes('$transportPreferenceDurabilityWaitSeconds = 5'));
  assert.ok(phoneDebugVerifier.includes('FHL transport preference was not durable after'));
  assert.ok(phoneDebugVerifier.includes('function Save-DebugTransportCrashAnrArtifact'));
  assert.ok(phoneDebugVerifier.includes('Transport mode evidence detected a crash or ANR'));
  assert.ok(phoneDebugVerifier.includes('profileKeys[0].slice(0,-profilesSuffix.length)+suffix'));
  assert.ok(scenario.includes('transportPreferenceDurabilityWaitSeconds = $transportPreferenceDurabilityWaitSeconds'));
  assert.ok(scenario.includes('Responses API preference did not survive force-stop and restart'));
  assert.ok(scenario.includes('Set-FHLTransportModeForVerification -Mode images'));
  assert.ok(scenario.includes('Images API preference did not survive force-stop and restart'));
  assert.ok(scenario.includes('ConvertTo-TransportPersistenceComparableJson'));
  assert.ok(scenario.includes('Assert-NativeRegistryStateUnchanged'));
  assert.ok(scenario.includes('Assert-UpstreamAttemptStateUnchanged'));
  assert.ok(scenario.includes('Responses restart observation'));
  assert.ok(scenario.includes('Images restart observation'));
  assert.ok(scenario.includes('Transport persistence emitted unexpected native work or upstream POST'));
  assert.ok(scenario.includes('initialMode = $ExpectedFHLTransportMode'));
  assert.match(
    phoneDebugVerifier,
    /ExpectedFHLTransportMode -eq "responses" -and \$Scenario -notin @\("TransportPersistence", "Single", "Sequential", "ResponsesCapability"\)/,
  );
  assert.ok(scenario.includes('nativeIdentityStatePreserved = $true'));
  assert.ok(scenario.includes('upstreamAttemptIdentityStatePreserved = $true'));
  assert.ok(scenario.includes('automaticPostCount = 0'));
});

test("Android Home verifier requires Images both before readiness and at the paid click", () => {
  const start = phoneDebugVerifier.indexOf('function Invoke-HomeScenario');
  const end = phoneDebugVerifier.indexOf('function Invoke-ColdStartScenario', start);
  assert.ok(start >= 0 && end > start, "Home scenario should exist");
  const scenario = phoneDebugVerifier.slice(start, end);
  assert.ok(scenario.includes('Assert-OfficialFHLImagesHomeSource -BrowserState $InitialState -Context "Home preflight"'));
  assert.ok(scenario.includes('Assert-OfficialFHLImagesHomeSource -BrowserState $clickState -Context "Home click-time"'));
  assert.match(
    phoneDebugVerifier,
    /function Assert-OfficialFHLImagesHomeSource[\s\S]*?Assert-ExpectedFHLTransportMode -BrowserState \$BrowserState -Context \$Context[\s\S]*?active\.official[\s\S]*?active\.poolSlot/,
  );
  assert.ok(phoneDebugVerifier.includes('requires the active Profile to be an official FHL pool member; no third-party API may be submitted'));
  assert.ok(scenario.indexOf('Home click-time') < scenario.indexOf('Click-GenerateOnce'));
  assert.ok(scenario.includes('$expectedHistoryLabel = Get-ExpectedHistorySourceLabel -PoolSlot $expectedSlot'));
  assert.ok(scenario.includes('[string]$history.newestSourceLabel -ne $expectedHistoryLabel'));
  assert.ok(scenario.includes('[string]$history.newestSlotSourceLabel -ne $expectedHistoryLabel'));
  assert.ok(scenario.includes('expectedHistoryLabel = $expectedHistoryLabel'));
});

test("Android Offline verifier checks the frozen Images transport label", () => {
  const start = phoneDebugVerifier.indexOf('function Invoke-OfflineScenario');
  const end = phoneDebugVerifier.indexOf('function Invoke-HomeScenario', start);
  assert.ok(start >= 0 && end > start, "Offline scenario should exist");
  const scenario = phoneDebugVerifier.slice(start, end);
  assert.ok(scenario.includes('Assert-OfficialFHLImagesHomeSource -BrowserState $InitialState -Context "Offline preflight"'));
  assert.ok(scenario.includes('Assert-OfficialFHLImagesHomeSource -BrowserState $clickState -Context "Offline click-time"'));
  assert.ok(scenario.indexOf('Offline click-time') < scenario.indexOf('$click = Click-GenerateOnce'));
  assert.ok(scenario.includes('$expectedHistoryLabel = Get-ExpectedHistorySourceLabel -PoolSlot $expectedSlot'));
  assert.ok(scenario.includes('[string]$history.newestSourceLabel -ne $expectedHistoryLabel'));
  assert.ok(scenario.includes('[string]$history.newestSlotSourceLabel -ne $expectedHistoryLabel'));
  assert.ok(scenario.includes('expectedHistoryLabel = $expectedHistoryLabel'));
});

test("Android ColdStart verifier blocks non-official Profiles before the paid click", () => {
  const start = phoneDebugVerifier.indexOf('function Invoke-ColdStartScenario');
  const end = phoneDebugVerifier.indexOf('if ($FinalizeExistingSequential', start);
  assert.ok(start >= 0 && end > start, "ColdStart scenario should exist");
  const scenario = phoneDebugVerifier.slice(start, end);
  assert.ok(scenario.includes('Assert-OfficialFHLImagesHomeSource -BrowserState $InitialState -Context "Cold-start preflight"'));
  assert.ok(scenario.includes('Assert-OfficialFHLImagesHomeSource -BrowserState $clickState -Context "Cold-start click-time"'));
  assert.ok(scenario.indexOf('Cold-start click-time') < scenario.indexOf('$click = Click-GenerateOnce'));
});

test("Android MatrixStartup verifies zero, one, or ten-slot phone and tablet startup without submitting", () => {
  assert.ok(phoneDebugVerifier.includes('"MatrixStartup"'));
  assert.ok(phoneDebugVerifier.includes('function Get-MatrixStartupState'));
  assert.ok(phoneDebugVerifier.includes('function Wait-AndroidMatrixStartupReady'));
  assert.ok(phoneDebugVerifier.includes('function Assert-MatrixStartupState'));
  assert.ok(phoneDebugVerifier.includes('function Invoke-MatrixStartupScenario'));
  assert.ok(phoneDebugVerifier.includes('.android-phone-compose,.android-pad-compose'));
  assert.ok(phoneDebugVerifier.includes('@("setup", "generate", "edit")'));
  assert.ok(phoneDebugVerifier.includes('$configured.Count -notin @(0, 1, 10)'));
  assert.ok(phoneDebugVerifier.includes('Get-MatrixStartupState'));
  assert.ok(phoneDebugVerifier.includes('Wait-AndroidMatrixStartupReady'));

  const readinessStart = phoneDebugVerifier.indexOf('function Wait-AndroidMatrixStartupReady');
  const readinessEnd = phoneDebugVerifier.indexOf('function Set-MatrixPromptAndReadiness', readinessStart);
  const readiness = phoneDebugVerifier.slice(readinessStart, readinessEnd);
  assert.ok(readiness.includes('.android-phone-sticky-cta > button.liquid-primary-button'));
  assert.ok(readiness.includes('.android-pad-side-cta > button.liquid-primary-button'));
  assert.ok(readiness.includes('.android-pad-cta > button.liquid-primary-button'));
  assert.ok(readiness.includes('root.querySelectorAll(actionSelector)'));
  assert.doesNotMatch(readiness, /root\.querySelectorAll\("button\.liquid-primary-button"\)/);

  const start = phoneDebugVerifier.indexOf('function Invoke-MatrixStartupScenario');
  const end = phoneDebugVerifier.indexOf('function Invoke-OfflineScenario', start);
  assert.ok(start >= 0 && end > start, "MatrixStartup scenario should exist");
  const scenario = phoneDebugVerifier.slice(start, end);
  assert.ok(scenario.includes('Assert-UpstreamAttemptStateUnchanged'));
  assert.ok(scenario.includes('Assert-NativeRegistryStateUnchanged'));
  assert.ok(scenario.includes('$Report.metrics.groups = 0'));
  assert.ok(scenario.includes('$Report.metrics.tasks = 0'));
  assert.ok(scenario.includes('$Report.metrics.upstreamPosts = 0'));
  assert.doesNotMatch(scenario, /Click-GenerateOnce|Set-PromptAndReadiness/);
});

test("Android MatrixStartup treats a setup CTA as no usable credential despite a stale slot hint", () => {
  assert.match(phoneDebugVerifier, /BootstrapState\.readyKind -eq "setup"[\s\S]*return @\(\)/);
  assert.match(phoneDebugVerifier, /Assert-MatrixSingleConfiguredSlot[\s\S]*configured\.Count -ne 1/);
});

test("Android MatrixSingle verifies one official Images slot before one phone or tablet submission", () => {
  assert.ok(phoneDebugVerifier.includes('"MatrixSingle"'));
  assert.ok(phoneDebugVerifier.includes('function Set-MatrixPromptAndReadiness'));
  assert.ok(phoneDebugVerifier.includes('function Click-MatrixGenerateOnce'));
  assert.ok(phoneDebugVerifier.includes('function Assert-MatrixSingleConfiguredSlot'));
  const guardStart = phoneDebugVerifier.indexOf('function Assert-MatrixSingleConfiguredSlot');
  const guardEnd = phoneDebugVerifier.indexOf('function Get-FreshInstallHistoryState', guardStart);
  const guard = phoneDebugVerifier.slice(guardStart, guardEnd);
  assert.ok(guard.includes('Assert-OfficialFHLImagesHomeSource'));
  const start = phoneDebugVerifier.indexOf('function Invoke-MatrixSingleScenario');
  const end = phoneDebugVerifier.indexOf('function Invoke-OfflineScenario', start);
  assert.ok(start >= 0 && end > start, "MatrixSingle scenario should exist");
  const scenario = phoneDebugVerifier.slice(start, end);
  assert.ok(scenario.includes('Assert-MatrixSingleConfiguredSlot'));
  assert.ok(scenario.includes('Assert-UpstreamAttemptStateUnchanged'));
  assert.ok(scenario.includes('Assert-NativeRegistryStateUnchanged'));
  assert.ok(scenario.includes('Start-Sleep -Seconds $ObservationSeconds'));
  assert.ok(scenario.indexOf('MatrixSingle click-time') < scenario.indexOf('$click = Click-MatrixGenerateOnce'));
  assert.ok(scenario.includes('[string]$click.submitKind -ne $expectedSubmitKind'));
  assert.ok(scenario.includes('MatrixSingle reused an existing clientSubmissionId'));
  assert.ok(scenario.includes('$newAttempts.Count -ne 1'));
  assert.ok(scenario.includes('[string]$registryDelta.groupIds[0] -ne [string]$group.groupId'));
  assert.ok(scenario.includes('[string]$registryDelta.taskIds[0] -ne [string]@($group.slots)[0].jobId'));
  assert.ok(scenario.includes('[string]$terminal.slot.status -ne "succeeded"'));
  assert.ok(scenario.includes('[string]$history.newestSourceLabel -ne $expectedHistoryLabel'));
  assert.ok(scenario.includes('[string]$history.newestSlotSourceLabel -ne $expectedHistoryLabel'));
  assert.ok(scenario.includes('[string]$history.newestSlotStatus -ne "succeeded"'));
  assert.ok(scenario.includes('submitKind = $expectedSubmitKind'));
  assert.ok(scenario.includes('targetPlatform = [string]$readiness.targetPlatform'));
  assert.ok(scenario.includes('automaticGroupCount = 0'));
  assert.ok(scenario.includes('automaticTaskCount = 0'));
  assert.ok(scenario.includes('automaticSubmissionCount = 0'));
  assert.ok(scenario.includes('historySlotLabel = [string]$history.newestSlotSourceLabel'));
  assert.ok(phoneDebugVerifier.includes('$Scenario -in @("MatrixStartup", "MatrixSingle")'));
  assert.ok(phoneDebugVerifier.includes('Invoke-MatrixSingleScenario -Report $report'));
  assert.ok(phoneDebugVerifier.includes('$Scenario -eq "MatrixSingle" -and $EvidenceSource -ne "DebugRunAs"'));

  const finalGuardStart = phoneDebugVerifier.indexOf('function Assert-MatrixSingleFinalMeasurements');
  const finalGuardEnd = phoneDebugVerifier.indexOf('function Invoke-CompatibilityWorkflowScenario', finalGuardStart);
  assert.ok(finalGuardStart >= 0 && finalGuardEnd > finalGuardStart, "MatrixSingle final measurement guard should exist");
  const finalGuard = phoneDebugVerifier.slice(finalGuardStart, finalGuardEnd);
  assert.ok(finalGuard.includes('[int]$Report.metrics.groups -ne 1'));
  assert.ok(finalGuard.includes('[int]$Report.metrics.tasks -ne 1'));
  assert.ok(finalGuard.includes('[int]$Report.metrics.upstreamPosts -ne 1'));
  assert.ok(finalGuard.includes('$Attempts.Count -ne 1'));
  for (const field of ['groupId', 'jobId', 'clientSubmissionId', 'requestRunId']) {
    assert.ok(finalGuard.includes(`"${field}"`));
    assert.ok(finalGuard.includes(`[string]$attempt.${field} -ne [string]$result.${field}`));
  }
  assert.ok(finalGuard.includes('[string]$slot.status -ne "succeeded"'));

  const passedIndex = phoneDebugVerifier.indexOf('$report.status = "passed"');
  const finalMeasurementIndex = phoneDebugVerifier.lastIndexOf(
    '$evidenceAttempts = @(Update-ReportMeasurements -Report $report)',
    passedIndex,
  );
  const finalAssertionIndex = phoneDebugVerifier.lastIndexOf(
    'Assert-MatrixSingleFinalMeasurements -Report $report -Attempts $evidenceAttempts',
    passedIndex,
  );
  assert.ok(finalMeasurementIndex >= 0 && finalMeasurementIndex < finalAssertionIndex);
  assert.ok(finalAssertionIndex < passedIndex, "MatrixSingle must be rechecked immediately before a passed report");
});

test("Android evidence renders compatibility details only for CompatibilityWorkflow", () => {
  const start = phoneDebugVerifier.indexOf("function Write-Evidence");
  const end = phoneDebugVerifier.indexOf("function Complete-ExistingSequentialEvidence", start);
  assert.ok(start >= 0 && end > start, "evidence writer should exist");
  const writer = phoneDebugVerifier.slice(start, end);
  const scenarioGuard = 'elseif ([string]$Report.scenario -eq "CompatibilityWorkflow")';
  assert.ok(writer.includes(scenarioGuard));
  assert.ok(writer.indexOf(scenarioGuard) < writer.indexOf("Compatibility workflow UI actions"));
  assert.doesNotMatch(writer, /else\s*\{\s*\$lines \+= @\(\s*"- Compatibility workflow UI actions/);
});

test("Android CompatibilitySingle checks the frozen Images history label", () => {
  const start = phoneDebugVerifier.indexOf('function Invoke-CompatibilitySingleScenario');
  const end = phoneDebugVerifier.indexOf('function Invoke-PoolLoadScenario', start);
  assert.ok(start >= 0 && end > start, "CompatibilitySingle scenario should exist");
  const scenario = phoneDebugVerifier.slice(start, end);
  assert.ok(scenario.includes('Assert-OfficialFHLImagesHomeSource -BrowserState $InitialState -Context "CompatibilitySingle preflight"'));
  assert.ok(scenario.includes('Assert-OfficialFHLImagesHomeSource -BrowserState $beforeClickState -Context "CompatibilitySingle click-time"'));
  assert.ok(scenario.includes('[int]$beforeClickState.activeProfile.poolSlot -ne 1'));
  assert.ok(scenario.indexOf('CompatibilitySingle click-time') < scenario.indexOf('$click = Click-GenerateOnce'));
  assert.ok(scenario.includes('$expectedSubmitKind = [string]$readiness.submitKind'));
  assert.ok(scenario.includes('[string]$click.submitKind -ne $expectedSubmitKind'));
  assert.ok(scenario.includes('submitKind = $expectedSubmitKind'));
  assert.ok(scenario.includes('$expectedHistoryLabel = Get-ExpectedHistorySourceLabel -PoolSlot 1'));
  assert.ok(scenario.includes('[string]$history.newestSourceLabel -ne $expectedHistoryLabel'));
  assert.ok(scenario.includes('[string]$history.newestSlotSourceLabel -ne $expectedHistoryLabel'));
  assert.ok(scenario.includes('expectedHistoryLabel = $expectedHistoryLabel'));
});

test("Android phone verifier reads UTF-8 evidence explicitly on Windows PowerShell", () => {
  assert.ok(
    phoneDebugVerifier.includes(
      '$existingReport = Get-Content -Raw -Encoding UTF8 -LiteralPath $reportPath | ConvertFrom-Json',
    ),
  );
  assert.ok(
    phoneDebugVerifier.includes(
      '$attempts = Get-Content -Raw -Encoding UTF8 -LiteralPath $attemptsPath | ConvertFrom-Json',
    ),
  );
  assert.doesNotMatch(phoneDebugVerifier, /Get-Content -Raw -LiteralPath/);
});

test("Android Images Preflight records and validates the official active FHL Profile without paid work", () => {
  const start = phoneDebugVerifier.indexOf('function Invoke-PreflightScenario');
  const end = phoneDebugVerifier.indexOf('function Invoke-SingleScenario', start);
  assert.ok(start >= 0 && end > start, "Preflight scenario should exist");
  const scenario = phoneDebugVerifier.slice(start, end);
  assert.ok(scenario.includes('Assert-OfficialFHLImagesHomeSource -BrowserState $InitialState -Context "Preflight"'));
  assert.ok(scenario.indexOf('Assert-OfficialFHLImagesHomeSource') < scenario.indexOf('Set-PromptAndReadiness'));
  assert.ok(phoneDebugVerifier.includes('activeProfile = if ($null -ne $initialState.activeProfile)'));
  assert.ok(phoneDebugVerifier.includes('official = [bool]$initialState.activeProfile.official'));
  assert.ok(phoneDebugVerifier.includes('poolSlot = [int]$initialState.activeProfile.poolSlot'));
});

test("Android one-way Responses transport gate persists the target mode without paid work", () => {
  assert.ok(phoneDebugVerifier.includes('"TransportToResponses"'));
  const start = phoneDebugVerifier.indexOf('function Invoke-TransportToResponsesScenario');
  const end = phoneDebugVerifier.indexOf('function Invoke-PreflightScenario', start);
  assert.ok(start >= 0 && end > start, "one-way Responses scenario should exist");
  const scenario = phoneDebugVerifier.slice(start, end);

  assert.ok(scenario.includes('Assert-ExpectedFHLTransportMode -BrowserState $InitialState -Context "TransportToResponses initial state"'));
  assert.ok(scenario.includes('Set-FHLTransportModeForVerification -Mode responses'));
  assert.doesNotMatch(scenario, /Set-FHLTransportModeForVerification -Mode images/);
  assert.ok(scenario.includes('Responses API preference did not survive the one-way force-stop and restart'));
  assert.ok(scenario.includes('Responses API selector state is inconsistent after the one-way restart'));
  assert.ok(scenario.includes('ConvertTo-TransportPersistenceComparableJson'));
  assert.ok(scenario.includes('Assert-NativeRegistryStateUnchanged'));
  assert.ok(scenario.includes('Assert-UpstreamAttemptStateUnchanged'));
  assert.ok(scenario.includes('One-way Responses switch emitted unexpected native work or upstream POST'));
  assert.ok(scenario.includes('finalMode = "responses"'));
  assert.ok(scenario.includes('$Report.metrics.clicks = 0'));
  assert.ok(scenario.includes('$Report.metrics.groups = 0'));
  assert.ok(scenario.includes('$Report.metrics.tasks = 0'));
  assert.ok(scenario.includes('$Report.metrics.upstreamPosts = 0'));
  assert.match(phoneDebugVerifier, /Save-DebugTransportCrashAnrArtifact[\s\S]*TransportToResponses/);
  assert.match(phoneDebugVerifier, /"TransportToResponses" \{[\s\S]*Invoke-TransportToResponsesScenario/);
});

test("Android Responses capability audit is redacted, text-only, and cannot create image jobs", () => {
  assert.ok(phoneDebugVerifier.includes('"ResponsesCapability"'));
  const planStart = phoneDebugVerifier.indexOf('function Get-FHLResponsesCapabilityPlan');
  const slotStart = phoneDebugVerifier.indexOf('function Invoke-FHLResponsesCapabilitySlotAudit', planStart);
  const validatorStart = phoneDebugVerifier.indexOf('function Assert-FHLResponsesCapabilitySlotResult', slotStart);
  const auditStart = phoneDebugVerifier.indexOf('function Get-FHLResponsesCapabilityAudit', validatorStart);
  const scenarioStart = phoneDebugVerifier.indexOf('function Invoke-ResponsesCapabilityScenario', auditStart);
  assert.ok(planStart >= 0 && slotStart > planStart && validatorStart > slotStart && auditStart > validatorStart && scenarioStart > auditStart);

  const plan = phoneDebugVerifier.slice(planStart, slotStart);
  const slotAudit = phoneDebugVerifier.slice(slotStart, validatorStart);
  const audit = phoneDebugVerifier.slice(auditStart, scenarioStart);
  for (const block of [plan, slotAudit]) {
    const expressionStart = block.indexOf("$expression = @'") + "$expression = @'".length;
    const expressionEnd = block.indexOf("'@", expressionStart);
    assert.ok(expressionStart > 0 && expressionEnd > expressionStart, "Responses capability JavaScript should be extractable");
    const expression = block.slice(expressionStart, expressionEnd).replaceAll('__SLOT__', '1');
    assert.doesNotThrow(() => new Function(expression));
  }
  assert.ok(plan.includes('(!parsed.port||parsed.port==="443")'));
  assert.ok(plan.includes('["","/","/v1","/v1/"].includes(parsed.pathname)'));
  assert.ok(slotAudit.includes('method:"POST"'));
  assert.ok(slotAudit.includes('url:parsedURL.origin+"/v1/responses"'));
  assert.ok(slotAudit.includes('model:"gpt-5.5"'));
  assert.ok(slotAudit.includes('max_output_tokens:8'));
  assert.ok(slotAudit.includes('(parsedURL.port&&parsedURL.port!=="443")'));
  assert.ok(slotAudit.includes('!["","/","/v1","/v1/"].includes(parsedURL.pathname)'));
  assert.ok(slotAudit.includes('input:"Return exactly OK."'));
  assert.ok(slotAudit.includes('Invoke-CdpExpressionOnce -Expression $expression -TimeoutSeconds $responsesCapabilitySlotTimeoutSeconds'));
  assert.doesNotMatch(slotAudit, /Invoke-CdpExpression -Expression/);
  assert.doesNotMatch(slotAudit, /images\/generations|images\/edits|image_generation/);
  assert.doesNotMatch(slotAudit, /response\.body|response\.bodyBase64|rawResponse|rawBody/);
  assert.doesNotMatch(slotAudit, /keyTail|keySuffix|apiKey\s*:/i);
  assert.ok(audit.includes('foreach ($rawSlot in @($plan.plannedSlots))'));
  assert.ok(audit.includes('Invoke-FHLResponsesCapabilitySlotAudit -Slot $slot'));
  assert.ok(audit.includes('$capabilityTextPostCountUpperBound = $capabilityTextPostCountLowerBound + 1'));
  assert.ok(audit.includes('$stoppedReason = "cdp_indeterminate"'));
  assert.ok(audit.includes('Stop-App'));
  assert.ok(audit.includes('Wait-AppProcessStopped'));
  assert.ok(audit.includes('Get-ResponsesCapabilityStopDecision'));
  assert.ok(audit.includes('$responsesCapabilityMinimumIntervalMilliseconds'));
  assert.doesNotMatch(audit, /TimeoutSeconds 900/);

  const scenarioEnd = phoneDebugVerifier.indexOf('function Invoke-PreflightScenario', scenarioStart);
  const scenario = phoneDebugVerifier.slice(scenarioStart, scenarioEnd);
  assert.ok(scenario.includes('Get-FHLResponsesCapabilityAudit'));
  assert.ok(scenario.includes('Responses capability audit created an image job or image-generation POST'));
  assert.ok(scenario.includes('$Report.metrics.groups = 0'));
  assert.ok(scenario.includes('$Report.metrics.tasks = 0'));
  assert.ok(scenario.includes('$Report.metrics.upstreamPosts = 0'));
  assert.ok(scenario.includes('$Report.metrics.imageGenerationPostCount = 0'));
  assert.ok(scenario.includes('capabilityTextPostCountLowerBound'));
  assert.ok(scenario.includes('capabilityTextPostCountUpperBound'));
  assert.ok(scenario.includes('capabilityTextPostCountExact'));
  assert.ok(scenario.includes('recorded text POST range must not be replayed'));
  assert.ok(scenario.includes('imageGenerationPostCount = 0'));
  assert.ok(scenario.includes('capabilityPostsAreTextOnly = $true'));
  assert.ok(phoneDebugVerifier.includes('Responses text capability POST range'));
  assert.ok(phoneDebugVerifier.includes('image-generation POSTs'));
  assert.match(phoneDebugVerifier, /"ResponsesCapability" \{[\s\S]*Invoke-ResponsesCapabilityScenario/);
});

test("Android Upgrade verifier preserves ten redacted Profiles and Keystore credentials across install -r", () => {
  assert.match(phoneDebugVerifier, /\[string\]\$ExpectedBaselineApkSha256 = ""/);
  assert.match(phoneDebugVerifier, /function Initialize-UpgradeBaseline/);
  assert.match(phoneDebugVerifier, /Upgrade refused to run because the installed APK does not match the expected baseline SHA-256/);
  assert.match(phoneDebugVerifier, /Upgrade refused to replace a baseline with \$pending queued or running task/);
  assert.match(phoneDebugVerifier, /function Get-UpgradeBrowserSnapshot/);

  const snapshotStart = phoneDebugVerifier.indexOf("function Get-UpgradeBrowserSnapshot");
  const snapshotEnd = phoneDebugVerifier.indexOf("function Get-UpgradeTransportState", snapshotStart);
  assert.ok(snapshotStart >= 0 && snapshotEnd > snapshotStart, "Upgrade redacted snapshot should exist");
  const snapshot = phoneDebugVerifier.slice(snapshotStart, snapshotEnd);
  assert.match(snapshot, /crypto\.subtle\.digest\("SHA-256"/);
  assert.match(snapshot, /profileIdSha256/);
  assert.match(snapshot, /activeProfileIdSha256/);
  assert.match(snapshot, /workspaceIdSha256/);
  assert.match(snapshot, /invokeNative\("GetStoredAPIKey"/);
  assert.match(snapshot, /credentialReadable:readable/);
  assert.match(snapshot, /credentialPresent:present/);
  assert.doesNotMatch(snapshot, /apiKey\s*:/i);
  assert.doesNotMatch(snapshot, /keyTail|keySuffix/i);
  assert.match(snapshot, /objectStore\("history"\)\.count\(\)/);

  const scenarioStart = phoneDebugVerifier.indexOf("function Invoke-UpgradeScenario");
  const scenarioEnd = phoneDebugVerifier.indexOf("function Invoke-TransportPersistenceScenario", scenarioStart);
  assert.ok(scenarioStart >= 0 && scenarioEnd > scenarioStart, "Upgrade scenario should exist");
  const scenario = phoneDebugVerifier.slice(scenarioStart, scenarioEnd);
  assert.match(scenario, /ConvertTo-UpgradeComparableJson/);
  assert.match(scenario, /did not default to Images API/);
  assert.match(scenario, /Start-Sleep -Seconds \$ObservationSeconds/);
  assert.match(scenario, /Get-NewAttempts -Before @\(\$baseline\.attempts\)/);
  assert.match(scenario, /unexpected upstream POST attempt/);
  assert.match(scenario, /readableCredentialCount/);
  assert.match(phoneDebugVerifier, /if \(\$Scenario -eq "Upgrade"\)[\s\S]*Initialize-UpgradeBaseline[\s\S]*Install-CandidateApk/);
  assert.match(phoneDebugVerifier, /if \(\$Scenario -in @\("Upgrade", "TransportPersistence", "TransportToResponses", "ResponsesCapability", "Startup"\)\)[\s\S]*Assert-TenCredentialInputsEmpty/);
});

test("Android FreshInstall verifier proves the empty default Images state without weakening configured startup", () => {
  assert.match(phoneDebugVerifier, /FreshInstall requires the package to be absent before verification/);
  assert.match(phoneDebugVerifier, /FreshInstall requires a new install and does not allow SkipInstall/);
  assert.match(phoneDebugVerifier, /function Wait-AndroidFreshInstallReady/);
  assert.match(phoneDebugVerifier, /fhl-transport-images/);
  assert.match(phoneDebugVerifier, /imagesPressed==="true"/);
  assert.match(phoneDebugVerifier, /responsesPressed==="false"/);
  assert.match(phoneDebugVerifier, /state\.setupCount===1&&state\.paidCount===0/);

  const stateStart = phoneDebugVerifier.indexOf("function Get-FreshInstallState");
  const stateEnd = phoneDebugVerifier.indexOf("function Assert-TenCredentialInputsEmpty", stateStart);
  assert.ok(stateStart >= 0 && stateEnd > stateStart, "FreshInstall state gate should exist");
  const stateGate = phoneDebugVerifier.slice(stateStart, stateEnd);
  for (const marker of [
    "profileKeyCount",
    "activeProfileKeyCount",
    "sessionKeyCount",
    "transportPreferenceKeyCount",
    "cursorKeyCount",
    "filledCredentialInputCount",
  ]) {
    assert.ok(stateGate.includes(marker), "FreshInstall should audit " + marker);
  }
  assert.match(stateGate, /FreshInstall unexpectedly restored a Profile, active Profile, transport preference, or pool cursor/);
  assert.match(stateGate, /android-history-empty/);
  assert.match(stateGate, /groupCount[\s\S]*-ne 0/);

  const scenarioStart = phoneDebugVerifier.indexOf("function Invoke-FreshInstallScenario");
  const scenarioEnd = phoneDebugVerifier.indexOf("function Invoke-PreflightScenario", scenarioStart);
  assert.ok(scenarioStart >= 0 && scenarioEnd > scenarioStart, "FreshInstall scenario should exist");
  const scenario = phoneDebugVerifier.slice(scenarioStart, scenarioEnd);
  assert.match(scenario, /Get-NewAttempts -Before \$InitialAttempts/);
  assert.match(scenario, /FreshInstall observed automatic work/);
  assert.match(scenario, /historyGroupCount = \[int\]\$historyState\.groupCount/);

  const startupStart = phoneDebugVerifier.indexOf("function Invoke-StartupScenario");
  const startupEnd = phoneDebugVerifier.indexOf("function Invoke-OfflineScenario", startupStart);
  const startup = phoneDebugVerifier.slice(startupStart, startupEnd);
  assert.match(startup, /Assert-TenConfiguredSlots -BrowserState \$afterState/);
  assert.match(phoneDebugVerifier, /if \(\$Scenario -in @\("Upgrade", "TransportPersistence", "TransportToResponses", "ResponsesCapability", "Startup"\)\)[\s\S]*Assert-TenCredentialInputsEmpty/);
});

test("Android real API load verifier proves 4/40, Queue60 FIFO, exact identities, and sanitized evidence", () => {
  const parserStart = phoneDebugVerifier.indexOf("function Get-RedactedNativeAuditEvents");
  const parserEnd = phoneDebugVerifier.indexOf("function Get-NativeAuditEventIdentity", parserStart);
  const parser = phoneDebugVerifier.slice(parserStart, parserEnd);
  assert.match(parser, /"slot_claimed"/);
  assert.match(parser, /"slot_reservation_released"/);
  assert.match(parser, /"slot_terminal"/);
  assert.match(parser, /"slot_error"/);
  assert.doesNotMatch(parser, /"slot_succeeded"|"slot_failed"|"slot_interrupted"/);
  assert.match(parser, /invalid intermediate JSONL record/);
  assert.match(parser, /\$index -eq \$lastContentIndex/);
  assert.match(parser, /\$readAttempt -le 5/);

  const auditStart = phoneDebugVerifier.indexOf("function Get-LoadAuditMetrics");
  const auditEnd = phoneDebugVerifier.indexOf("function Assert-LoadDistribution", auditStart);
  const audit = phoneDebugVerifier.slice(auditStart, auditEnd);
  assert.match(audit, /LoadAuditEvents\.Values \| Sort-Object \{ \[int\]\$_\.captureOrder \}/);
  assert.doesNotMatch(audit, /Sort-Object[^\n]*timestamp/);
  assert.match(audit, /\$queued\.Values[\s\S]*activePerSlot[\s\S]*Sort-Object[\s\S]*queueSequence/);
  assert.match(audit, /\[string\]\$eligible\[0\]\.jobId -ne \$jobId/);
  assert.match(audit, /global oldest-runnable FIFO queueSequence ordering/);
  assert.match(audit, /activePerSlot\[\$slot\]\) -gt 4 -or \$active\.Count -gt 40/);
  assert.match(audit, /recorded an upstream POST outside its active reservation window/);
  assert.match(audit, /more than one upstream POST for a task/);
  assert.match(audit, /exactly one submit, claim, POST, terminal event, and release per task/);

  const scenarioStart = phoneDebugVerifier.indexOf("function Invoke-PoolLoadScenario");
  const scenarioEnd = phoneDebugVerifier.indexOf("function Invoke-SequentialScenario", scenarioStart);
  const scenario = phoneDebugVerifier.slice(scenarioStart, scenarioEnd);
  assert.match(scenario, /if \(\[string\]\$Report\.scenario -eq "Pool40"\) \{ 40 \} else \{ 60 \}/);
  assert.match(scenario, /Invoke-LoadClickBlock -BlockNumber \$block/);
  assert.match(scenario, /requires continuous generation to be enabled before any paid click/);
  assert.match(scenario, /uniqueSubmissionIds/);
  assert.match(scenario, /running -eq 40/);
  assert.match(scenario, /activeReservations -eq 40/);
  assert.match(scenario, /queued -eq \$expectedQueuedAtCheckpoint/);
  assert.match(scenario, /exact host state of 40 active\/running/);
  assert.match(scenario, /checkpointDeadline = \(Get-Date\)\.AddSeconds\(10\)/);
  assert.match(scenario, /Assert-LoadDistribution[\s\S]*ExpectedPerSlot \$expectedPerSlot/);
  assert.match(scenario, /requires every real API task to succeed/);
  assert.match(scenario, /totalPeak -ne 40/);
  assert.match(scenario, /peak -ne 4/);
  assert.match(scenario, /Write-Evidence -Report \$Report -Attempts \$partialAttempts/);
  assert.match(scenario, /paid-block-outcome-unknown/);
  assert.match(scenario, /mustNotReplayUnknownOutcome/);

  const safetyStart = phoneDebugVerifier.indexOf("function Assert-LoadHostSafety");
  const safetyEnd = phoneDebugVerifier.indexOf("function Get-LoadAuditMetrics", safetyStart);
  const safety = phoneDebugVerifier.slice(safetyStart, safetyEnd);
  assert.match(safety, /authentication failure/);
  assert.match(safety, /Where-Object \{ \$_\.Count -ge 3 \}/);
  assert.match(safety, /per-slot limit of four/);

  const artifactStart = phoneDebugVerifier.indexOf("function Assert-SanitizedLoadArtifact");
  const artifactEnd = phoneDebugVerifier.indexOf("function Write-Evidence", artifactStart);
  const artifacts = phoneDebugVerifier.slice(artifactStart, artifactEnd);
  assert.match(artifacts, /native-scheduler-audit\.json|\$loadAuditPath/);
  assert.match(artifacts, /host-queue-samples\.json|\$loadSamplesPath/);
  assert.match(artifacts, /apiKey\|prompt\|negativePrompt/);
  assert.match(artifacts, /Write-AtomicJsonArtifact -Path \$loadCheckpointPath/);
});

test(
  "Android load verifier behavior rejects early POST, duplicates, FIFO inversion, incomplete audit, and over-capacity fixtures",
  { skip: process.platform !== "win32" },
  () => {
    const output = execFileSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        phoneDebugVerifierPath,
        "-Scenario",
        "Preflight",
        "-ApkPath",
        "unused-in-internal-self-test.apk",
        "-ExpectedApkSha256",
        "0".repeat(64),
        "-RunInternalLoadAuditSelfTest",
      ],
      { encoding: "utf8", timeout: 30_000 },
    );
    assert.match(output, /Android load audit internal self-test: PASS/);
  },
);

test(
  "Android Responses capability stop policy is behavior-checked without network access",
  { skip: process.platform !== "win32" },
  () => {
    const output = execFileSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        phoneDebugVerifierPath,
        "-Scenario",
        "ResponsesCapability",
        "-ApkPath",
        "unused-in-internal-self-test.apk",
        "-ExpectedApkSha256",
        "0".repeat(64),
        "-RunInternalResponsesCapabilityAuditSelfTest",
      ],
      { encoding: "utf8", timeout: 30_000 },
    );
    assert.match(output, /Android Responses capability audit internal self-test: PASS/);
  },
);

test("Android formal verifier uses explicit ReleaseLogcat evidence without run-as fallback", () => {
  assert.match(phoneDebugVerifier, /ValidateSet\("DebugRunAs", "ReleaseLogcat"\)/);
  assert.match(phoneDebugVerifier, /evidenceSource = \$EvidenceSource/);
  assert.match(phoneDebugVerifier, /function ConvertFrom-ReleaseLogcatAuditText/);
  assert.match(phoneDebugVerifier, /logcat", "-d", "-v", "epoch", "-s", "FHLImageStudioJobs:I"/);
  assert.match(phoneDebugVerifier, /missing or truncated Job audit record at physical line/);
  assert.match(phoneDebugVerifier, /forbidden credential or prompt field/);
  assert.match(phoneDebugVerifier, /function Get-NativeRegistrySummaryFromBridge/);
  assert.match(phoneDebugVerifier, /ListAndroidJobs/);
  for (const field of ["queueSequence", "reservationActive", "reservationKind", "reservationSlot", "settledAt"]) {
    assert.ok(phoneDebugVerifier.includes(field), `Release Bridge evidence should include ${field}`);
  }
  const registryDispatch = phoneDebugVerifier.match(/function Get-NativeRegistrySummary \{[\s\S]*?\n\}/)?.[0] ?? "";
  const auditDispatch = phoneDebugVerifier.match(/function Get-RedactedNativeAuditEvents \{[\s\S]*?\n\}/)?.[0] ?? "";
  const registryReleaseBranch = registryDispatch.slice(registryDispatch.indexOf('if ($EvidenceSource -eq "ReleaseLogcat")'));
  const auditReleaseBranch = auditDispatch.slice(auditDispatch.indexOf('if ($EvidenceSource -eq "ReleaseLogcat")'));
  assert.match(registryDispatch, /ReleaseLogcat[\s\S]*Get-NativeRegistrySummaryFromBridge/);
  assert.doesNotMatch(registryReleaseBranch, /catch|Get-NativeRegistrySummaryFromRunAs/);
  assert.match(auditDispatch, /ReleaseLogcat[\s\S]*Get-RedactedNativeAuditEventsFromReleaseLogcat/);
  assert.doesNotMatch(auditReleaseBranch, /catch|Get-RedactedNativeAuditEventsFromRunAs/);
  assert.match(phoneDebugVerifier, /6B04A805E50CF66E37C740AD0336BBDF6445653F93802005967BABF472E8DA36/);
  assert.match(phoneDebugVerifier, /\[string\]\$releaseMetadata\.debuggable -ne "false"/);
  assert.match(phoneDebugVerifier, /ReleaseLogcat rejected the APK signing certificate/);
  assert.match(phoneDebugVerifier, /ReleaseLogcat detected native job activity during startup/);
  assert.match(phoneDebugVerifier, /ReleaseLogcatProcessIds/);
  assert.match(phoneDebugVerifier, /source PID or process session is invalid/);
  assert.match(phoneDebugVerifier, /audit sequence has a gap, duplicate, or ring-buffer truncation/);
  assert.match(phoneDebugVerifier, /release-logcat-audit-redacted\.txt/);
  assert.match(phoneDebugVerifier, /process_started/);
  assert.match(phoneDebugVerifier, /evidence-manifest\.json/);
  assert.match(phoneDebugVerifier, /ListAndroidJobs",JSON\.stringify\(\[workspaceId,700\]\)/);
  assert.match(androidJobManager, /ensureProcessAuditStarted\(appContext\)/);
  assert.match(androidJobManager, /"process_started"/);
  const offlineScenario = phoneDebugVerifier.match(/function Invoke-OfflineScenario \{[\s\S]*?\n\}/)?.[0] ?? "";
  assert.match(offlineScenario, /EvidenceSource -eq "DebugRunAs"[\s\S]*Clear-DeviceLogcat/);
  assert.match(offlineScenario, /diagnosticDelta/);
});

test("Release WebView acceptance access is limited to emulator hardware", () => {
  assert.match(mainActivity, /private fun isAndroidEmulator\(\): Boolean/);
  assert.match(mainActivity, /hardware in setOf\("goldfish", "ranchu"\)/);
  assert.match(mainActivity, /BuildConfig\.DEBUG \|\| isAndroidEmulator\(\)/);
  assert.doesNotMatch(mainActivity, /WebView\.setWebContentsDebuggingEnabled\(true\)[\s\S]{0,80}else/);
});

test("Android synthetic UI audit store is limited to Debug emulator sessions", () => {
  assert.match(mainActivity, /BuildConfig\.DEBUG && isAndroidEmulator\(\)/);
  assert.match(mainActivity, /@JavascriptInterface\s+fun enabled\(\): Boolean = true/);
  assert.match(mainActivity, /"AndroidEmulatorAudit"/);
  assert.match(frontendMain, /AndroidEmulatorAudit\?\.enabled\?\.\(\) === true/);
  assert.match(frontendMain, /import\.meta\.env\.DEV \|\| isAndroidEmulatorAuditSession\(\)/);
  assert.doesNotMatch(mainActivity, /addJavascriptInterface[\s\S]{0,200}"AndroidEmulatorAudit"[\s\S]{0,80}else/);
});

test("Android bulk/grid verifier compiles embedded CDP expressions before execution", () => {
  assert.match(bulkGridVerifier, /Function\(`return \$\{expression\};`\)/);
  assert.match(bulkGridVerifier, /join\("\\\\n"\)/);
  assert.match(bulkGridVerifier, /FHL\\\\d\+sk-\\\\\*/);
  assert.match(bulkGridVerifier, /Verifier source does not match the declared verifier commit/);
  assert.match(bulkGridVerifier, /Installed Android APK hash does not match the frozen candidate/);
  assert.match(bulkGridVerifier, /captureNativeSnapshot\(\)/);
  assert.match(bulkGridVerifier, /nativeAfter\.registry\.sha256 !== nativeBefore\.registry\.sha256/);
  assert.match(bulkGridVerifier, /nativeAfter\.audit\.upstreamSubmitAttempts - nativeBefore\.audit\.upstreamSubmitAttempts/);
  assert.match(bulkGridVerifier, /nativeAfter\.encryptedCredentials\.sha256 !== nativeBefore\.encryptedCredentials\.sha256/);
  assert.match(bulkGridVerifier, /Frontend state did not return to its exact redacted baseline/);
  assert.match(bulkGridVerifier, /CDP port is not bound to the declared emulator and application PID/);
  assert.match(bulkGridVerifier, /Clipboard helper is missing or requests network access/);
  assert.match(bulkGridVerifier, /Clipboard helper APK does not match the reviewed no-network helper/);
  assert.match(bulkGridVerifier, /function prepareNotificationPermissionForVerification\(\)/);
  assert.match(bulkGridVerifier, /if \(!beforeGranted\) runAdb\(\["shell", "pm", "grant", androidPackage, permission\]\)/);
  assert.match(bulkGridVerifier, /return \{ required: true, beforeGranted, changed: !beforeGranted, granted \}/);
  assert.match(bulkGridVerifier, /android\\\.permission\\\.POST_NOTIFICATIONS:\\s\+granted=true/);
  assert.match(bulkGridVerifier, /function findFocusedPackageLine\(raw, primaryPattern, fallbackPattern, packageName\)/);
  assert.match(bulkGridVerifier, /function waitForProductForeground\(timeoutMs = 15000\)/);
  const foregroundWait = bulkGridVerifier.match(
    /function waitForProductForeground\(timeoutMs = 15000\) \{[\s\S]*?\r?\n\}\r?\n\r?\nfunction seedSyntheticClipboard/,
  )?.[0] ?? "";
  const primaryResumedIndex = foregroundWait.indexOf("/topResumedActivity/");
  const fallbackResumedIndex = foregroundWait.indexOf("/(?:mResumedActivity|ResumedActivity)/");
  const primaryFocusIndex = foregroundWait.indexOf("/mCurrentFocus/");
  const fallbackFocusIndex = foregroundWait.indexOf("/mFocusedApp/");
  assert.ok(
    primaryResumedIndex >= 0
      && fallbackResumedIndex >= 0
      && primaryResumedIndex < fallbackResumedIndex,
  );
  assert.ok(
    primaryFocusIndex >= 0
      && fallbackFocusIndex >= 0
      && primaryFocusIndex < fallbackFocusIndex,
  );
  assert.match(bulkGridVerifier, /"shell", "dumpsys", "window"\]\)/);
  assert.doesNotMatch(bulkGridVerifier, /"shell", "dumpsys", "window", "windows"/);
  assert.match(bulkGridVerifier, /Android product Activity did not become resumed and focused before clipboard verification/);
  const clipboardPreflight = bulkGridVerifier.match(/try \{\r?\n  devicePreparation\.notificationPermission[\s\S]*?\r?\n\} catch \(preflightError\) \{/)?.[0] ?? "";
  const clipboardCleanup = bulkGridVerifier.match(/function clearSyntheticClipboard\(\) \{[\s\S]*?\r?\n\}/)?.[0] ?? "";
  const permissionPreparationIndex = clipboardPreflight.indexOf(
    "devicePreparation.notificationPermission = prepareNotificationPermissionForVerification()",
  );
  const clipboardSeedIndex = clipboardPreflight.indexOf("clipboardHelperIdentity = seedSyntheticClipboard()");
  const productLaunchIndex = clipboardPreflight.indexOf("startLauncher(androidPackage, [], apiLevel > 28)");
  const foregroundWaitIndex = clipboardPreflight.indexOf(
    "devicePreparation.productForeground = waitForProductForeground()",
  );
  assert.ok(
    permissionPreparationIndex >= 0
      && clipboardSeedIndex >= 0
      && permissionPreparationIndex < clipboardSeedIndex,
  );
  assert.ok(
    productLaunchIndex >= 0
      && foregroundWaitIndex >= 0
      && productLaunchIndex < foregroundWaitIndex,
  );
  const clipboardClearIndex = clipboardCleanup.indexOf(
    'startLauncher(clipboardHelperPackage, ["--ez", "clear", "true"], apiLevel > 28)',
  );
  const cleanupProductLaunchIndex = clipboardCleanup.indexOf(
    "startLauncher(androidPackage, [], apiLevel > 28)",
  );
  const cleanupForegroundWaitIndex = clipboardCleanup.indexOf("waitForProductForeground()");
  assert.ok(
    clipboardClearIndex >= 0
      && cleanupProductLaunchIndex >= 0
      && clipboardClearIndex < cleanupProductLaunchIndex,
  );
  assert.ok(
    cleanupProductLaunchIndex >= 0
      && cleanupForegroundWaitIndex >= 0
      && cleanupProductLaunchIndex < cleanupForegroundWaitIndex,
  );
  assert.match(bulkGridVerifier, /System clipboard does not match this verifier's synthetic input/);
  assert.match(bulkGridVerifier, /Synthetic clipboard cleanup verification failed/);
  assert.match(bulkGridVerifier, /waitForLaunch \? 30000 : 10000/);
  assert.match(bulkGridVerifier, /startLauncher\(clipboardHelperPackage, \["--ei", "seed", String\(seed\)\], apiLevel > 28\)/);
  assert.match(bulkGridVerifier, /startLauncher\(clipboardHelperPackage, \["--ez", "clear", "true"\], apiLevel > 28\)/);
  assert.match(bulkGridVerifier, /startLauncher\(androidPackage, \[\], apiLevel > 28\)/);
  assert.match(bulkGridVerifier, /document\.querySelector\("\.android-bottom-nav"\) \|\| document\.querySelector\("\.android-rail"\)/);
  assert.match(bulkGridVerifier, /Android canvas navigation button is unavailable/);
  assert.doesNotMatch(bulkGridVerifier, /const canvasButton = document\.querySelector\("\.android-bottom-nav button:nth-child\(2\)"\)/);
  assert.match(bulkGridVerifier, /batchResultFingerprint: await digest\(batchResultStructure\)/);
  assert.doesNotMatch(bulkGridVerifier, /baseline\.batchResults !== 0/);
  assert.match(bulkGridVerifier, /async screenshot\(fileName\)[\s\S]*exec-out", "screencap", "-p"/);
  assert.doesNotMatch(bulkGridVerifier, /Page\.captureScreenshot/);
  assert.match(bulkGridVerifier, /screenshotPrivacyWaitMs = apiLevel >= 33 \? 5000 : 0/);
  assert.match(bulkGridVerifier, /setTimeout\(resolve, report\.screenshotPrivacyWaitMs\)/);
  assert.match(bulkGridVerifier, /Installed APK service identity does not match the declared product commit/);
  assert.match(bulkGridVerifier, /performance\.getEntriesByType\("resource"\)/);
  assert.match(bulkGridVerifier, /data-batch-grid-total-rows[\s\S]*expectedRows/);
  assert.match(bulkGridVerifier, /p95ScrollProcessingMs < 8/);
  assert.match(bulkGridVerifier, /p95WindowCommitLatencyMs < 250/);
  assert.match(bulkGridVerifier, /rafCallbackDurations\.push\(performance\.now\(\) - callbackStarted\)/);
  assert.match(bulkGridVerifier, /waitForWindowCommit/);
  assert.match(bulkGridVerifier, /peakMountedTiles/);
  assert.match(bulkGridVerifier, /mountViolations/);
  assert.match(bulkGridVerifier, /windowIdentityMatches/);
  assert.match(bulkGridVerifier, /p95FrameDelayMs/);
  assert.match(bulkGridVerifier, /const gfxScrollGateMode = readArg\("gfx-scroll-gate", "off"\)/);
  assert.match(bulkGridVerifier, /function resetGfxInfo\(\)/);
  assert.match(bulkGridVerifier, /function captureGfxInfo\(\)/);
  assert.match(bulkGridVerifier, /HISTOGRAM:[\s\S]*GPU HISTOGRAM:/);
  assert.match(bulkGridVerifier, /bucket\.milliseconds >= 700/);
  assert.match(bulkGridVerifier, /if \(gfxScrollGateEnabled\) resetGfxInfo\(\)/);
  assert.match(bulkGridVerifier, /metrics\.gfxScroll = captureGfxInfo\(\)/);
  assert.ok(
    bulkGridVerifier.indexOf("metrics.gfxScroll = captureGfxInfo()")
      < bulkGridVerifier.indexOf("await client.screenshot(`virtual-grid-${itemCount}.png`)")
  );
  assert.match(bulkGridVerifier, /metrics\.gfxScroll\.frozenFrames !== 0/);
  assert.ok(
    bulkGridVerifier.indexOf("report.virtualGrid.push(metrics)")
      < bulkGridVerifier.indexOf("if (!metrics.performancePassed)"),
  );
  assert.match(bulkGridVerifier, /counters\.outstanding\.size === 0/);
  assert.match(bulkGridVerifier, /duplicateTrackedRevokes === 0/);
  assert.match(bulkGridVerifier, /__androidBulkGridVerifierGenerationClicks/);
  assert.match(bulkGridVerifier, /data-audit-id="toggle-android-quick-settings"/);
  assert.match(bulkGridVerifier, /document\.querySelector\("#android-header-quick-settings"\)/);
  assert.match(bulkGridVerifier, /Page\.reload/);
  assert.match(bulkGridVerifier, /collapsedReloaded = await reloadWebViewAndWait\(client, false\)/);
  assert.match(bulkGridVerifier, /expandedReloaded = await reloadWebViewAndWait\(client, true\)/);
  assert.match(bulkGridVerifier, /writeQuickSettingsPreferenceEntries\(client, \[\]\)/);
  assert.match(bulkGridVerifier, /writeQuickSettingsPreferenceEntries\(client, \[\[preferenceKey, "corrupt"\]\]\)/);
  assert.match(bulkGridVerifier, /writeQuickSettingsPreferenceEntries\(client, \[\[preferenceKey, "1"\]\]\)/);
  assert.match(bulkGridVerifier, /restoreQuickSettings/);
  assert.match(bulkGridVerifier, /assertQuickSettingsSnapshot/);
  assert.match(bulkGridVerifier, /quickSettingsBusinessSnapshotExpression/);
  assert.match(bulkGridVerifier, /waitForQuickSettingsBusiness\(client, quickBusinessBefore\.fingerprint, 30000\)/);
  assert.match(bulkGridVerifier, /quickBusinessAfter\.fingerprint !== quickBusinessBefore\.fingerprint/);
  assert.match(bulkGridVerifier, /quickPaidWork\.groups !== 0/);
  assert.match(bulkGridVerifier, /quickPaidWork\.tasks !== 0/);
  assert.match(bulkGridVerifier, /quickPaidWork\.upstreamPosts !== 0/);
  assert.match(bulkGridVerifier, /\["system-textarea-rows", systemRead\.textareaRows === 2\]/);
  assert.match(bulkGridVerifier, /systemRead\.textareaHeight >= 63 && systemRead\.textareaHeight <= 65/);
  assert.match(bulkGridVerifier, /\["system-textarea-min-height", systemRead\.textareaMinHeight === "64px"\]/);
  assert.match(bulkGridVerifier, /\["system-textarea-resize", systemRead\.textareaResize === "none"\]/);
  assert.match(bulkGridVerifier, /已识别 10 个 API，需修改请重新粘贴覆盖/);
  assert.match(bulkGridVerifier, /clipboardMock\.mode = "empty"/);
  assert.match(bulkGridVerifier, /emulatorAudit\.enabled\(\) !== true/);
  assert.match(bulkGridVerifier, /clipboardMock\.mode = "reject"/);
  assert.match(bulkGridVerifier, /clipboardMock\.mode = "defer"/);
  assert.match(bulkGridVerifier, /\["empty-preview-cleared", emptyClipboard\.previewCount === 0\]/);
  assert.match(bulkGridVerifier, /\["rejected-preview-cleared", rejectedClipboard\.previewCount === 0\]/);
  assert.match(bulkGridVerifier, /\["stale-preview-cleared", staleClipboard\.previewCount === 0\]/);
  assert.match(bulkGridVerifier, /window\.__imageStudioNativeResolve = \(requestId, payload\)/);
  assert.match(bulkGridVerifier, /originalNativeResolve\(deferred\.requestId, deferred\.payload\)/);
  assert.match(bulkGridVerifier, /invalid replacement preview clear/);
  assert.match(bulkGridVerifier, /invalidReplacement\.confirmDisabled/);
  assert.match(bulkGridVerifier, /invalidReplacement\.recognizedHintPresent/);
  assert.match(bulkGridVerifier, /const failedChecks = \[/);
  assert.match(bulkGridVerifier, /report\.bulkDialog = bulkResult;/);
  assert.match(bulkGridVerifier, /Android bulk dialog checks failed:/);
  assert.doesNotMatch(bulkGridVerifier, /\?\.|\?\?|\b\d[\d_]*_\d[\d_]*\b/);
  assert.match(bulkGridVerifier, /artifact-manifest\.json/);
});

test("Android reproducible Release gate fixes the certificate trust anchor and production manifest", () => {
  assert.match(reproducibleVerifier, /officialReleaseCertificateSha256\s*=\s*"6b04a805e50cf66e37c740ad0336bbdf6445653f93802005967babf472e8da36"/);
  assert.match(reproducibleVerifier, /Artifact -eq "Release" -and \$normalizedCertificate -ne \$officialReleaseCertificateSha256/);
  assert.match(reproducibleVerifier, /debuggable = "debuggable"/);
  assert.match(reproducibleVerifier, /debuggable = "false"/);
  assert.match(reproducibleVerifier, /Verified using v2 scheme/);
  assert.match(reproducibleVerifier, /valid = \$metadataMatches -and \$certificateMatches -and \$signatureV2/);
});

test("Android Release gate binds the 216-task emulator evidence to the exact signed APK", () => {
  assert.match(releaseVerifier, /totalJobs -eq 216/);
  assert.match(releaseVerifier, /evidenceSource -eq "ReleaseLogcat"/);
  assert.match(releaseVerifier, /emulator-complete-pending-real-device/);
  for (const field of [
    "apkSha256",
    "installedApkSha256",
    "candidateGitCommit",
    "verifierGitCommit",
    "apkBuildId",
    "apkServiceIdentity",
    "apkCertificateSha256",
    "apkDebuggable",
  ]) {
    assert.ok(releaseVerifier.includes(field), `Release evidence binding should include ${field}`);
  }
  assert.match(releaseVerifier, /live-acceptance-built-apk/);
  assert.match(releaseVerifier, /release-signature-v2/);
  assert.match(releaseVerifier, /Protect-AuditText/);
  assert.match(releaseVerifier, /LiveAcceptanceEvidenceRoot/);
  assert.match(releaseVerifier, /finalize-android-emulator-acceptance\.ps1/);
  assert.match(releaseVerifier, /-Mode", "Verify"/);
  assert.match(acceptanceAggregator, /A task identity was reused across formal acceptance runs/);
  assert.match(acceptanceAggregator, /totalJobs -ne 216/);
  assert.match(acceptanceAggregator, /Audit sequence has a gap, duplicate, or truncated prefix/);
  assert.match(acceptanceAggregator, /singleClick[\s\S]*tenSlotRoundRobin[\s\S]*pool40[\s\S]*queue60/);
});

test("Android API 28 compatibility workflow is a zero-submit canvas and history audit", () => {
  assert.match(phoneDebugVerifier, /"CompatibilitySingle", "CompatibilityWorkflow"/);
  const uiStart = phoneDebugVerifier.indexOf("function Invoke-CompatibilityWorkflowUI");
  const uiEnd = phoneDebugVerifier.indexOf("function Assert-NoPendingSlots", uiStart);
  const scenarioStart = phoneDebugVerifier.indexOf("function Invoke-CompatibilityWorkflowScenario");
  const scenarioEnd = phoneDebugVerifier.indexOf("function Invoke-PreflightScenario", scenarioStart);
  assert.ok(uiStart >= 0 && uiEnd > uiStart, "CompatibilityWorkflow CDP body should exist");
  assert.ok(scenarioStart >= 0 && scenarioEnd > scenarioStart, "CompatibilityWorkflow scenario gate should exist");
  const ui = phoneDebugVerifier.slice(uiStart, uiEnd);
  const scenario = phoneDebugVerifier.slice(scenarioStart, scenarioEnd);

  for (const selector of [
    "android-history-feature-card .android-history-feature-tile",
    "button.android-history-tile-menu",
    "android-history-action-sheet",
    "android-phone-source-card",
    "android-canvas-tool-segment",
    "stage-canvas-wrap .konvajs-content canvas",
  ]) {
    assert.ok(ui.includes(selector), `CompatibilityWorkflow should use ${selector}`);
  }
  for (const label of ["设为源图", "文字", "自由画", "箭头", "矩形", "裁出选中矩形", "左转 90°", "右转 90°", "水平翻转", "竖直翻转", "保存原图"]) {
    assert.ok(ui.includes(label), `CompatibilityWorkflow should exercise ${label}`);
  }
  assert.doesNotMatch(ui, /Click-GenerateOnce|Set-PromptAndReadiness|\.click\(\).*开始(?:生成|编辑)/);
  assert.match(scenario, /Assert-RegistryDeltaMatches[\s\S]*ExpectedGroupIds @\(\)[\s\S]*ExpectedTaskIds @\(\)/);
  assert.match(scenario, /Get-NewAttempts -Before \$InitialAttempts/);
  assert.match(scenario, /zero-POST gate/);
  assert.match(scenario, /\$Report\.metrics\.groups = 0/);
  assert.match(scenario, /\$Report\.metrics\.tasks = 0/);
  assert.match(scenario, /\$Report\.metrics\.upstreamPosts = 0/);
  assert.match(scenario, /Get-CompatibilityOutputFiles/);
  assert.match(scenario, /savedOutputBytes = Get-CompatibilityOutputFileSize/);
  assert.match(scenario, /pathSha256 = Get-RedactedPathFingerprint/);
  assert.match(ui, /window\.Konva[\s\S]*fire\("click"/);
  assert.match(phoneDebugVerifier, /function Save-CompatibilityWorkflowScreenshot/);
  assert.match(phoneDebugVerifier, /function Write-CompatibilityWorkflowLogcat/);
});

test("Android offline verifier accepts target TCP reachability without weakening the offline gate", () => {
  assert.match(phoneDebugVerifier, /function Test-UpstreamTcpReachability/);
  assert.match(phoneDebugVerifier, /"echo -n \| toybox nc -w 10 -q 1 www\.fhl\.mom 443"/);
  assert.doesNotMatch(phoneDebugVerifier, /"nc", "-z"/);
  assert.match(phoneDebugVerifier, /\[bool\]\$state\.validated -or \$targetReachable/);
  assert.match(phoneDebugVerifier, /-not \[bool\]\$state\.validated/);
  assert.match(phoneDebugVerifier, /onlineSource = \[string\]\$onlineState\.source/);
  assert.match(phoneDebugVerifier, /restoreSource = \[string\]\$restoredState\.source/);
});

test("Android parameter changes stay mirrored into the active workspace", () => {
  const setFieldStart = studioStore.indexOf("setField: (key, value) => {");
  const setFieldEnd = studioStore.indexOf("setFullscreen: async", setFieldStart);
  assert.ok(setFieldStart >= 0 && setFieldEnd > setFieldStart, "setField body should be present");
  const setFieldBody = studioStore.slice(setFieldStart, setFieldEnd);
  for (const key of ["prompt", "negativePrompt", "mode", "size", "quality", "outputFormat", "seed", "styleTag", "sources"]) {
    assert.match(setFieldBody, new RegExp(`key === "${key}"`));
  }
  assert.match(setFieldBody, /\{\s*\.\.\.w,\s*\[key\]: normalizedValue\s*\} as Workspace/);
});

test("Android parameter modal leaves room below controls for the sticky save button", () => {
  assert.match(androidParametersCSS, /scroll-padding-bottom:\s*calc\(108px \+ var\(--android-safe-bottom-value, 0px\)\)/);
  assert.match(androidParametersCSS, /\.android-parameter-modal-stack[\s\S]*padding:\s*14px 14px calc\(108px \+ var\(--android-safe-bottom-value, 0px\)\)/);
});

test("Android native Images jobs log sanitized FHL request diagnostics", () => {
  assert.match(androidJobManager, /private fun logFHLImagesRequestDiagnostics\(payload: JSONObject\)/);
  assert.match(androidJobManager, /if \(!isFHLBaseURL\(payload\.optString\("baseURL"\)\)\) return/);
  assert.match(androidJobManager, /\.put\("baseURLHost", hostForURL\(payload\.optString\("baseURL"\)\)\)/);
  assert.match(androidJobManager, /\.put\("size", payload\.optString\("size", "1024x1024"\)/);
  assert.match(androidJobManager, /\.put\("sourceCount", payload\.optJSONArray\("sourceImagePaths"\)\?\.length\(\) \?: 0\)/);
  assert.match(androidJobManager, /Log\.i\(logTag, "FHL Images request \$\{diagnostics\}"\)/);
  assert.doesNotMatch(androidJobManager, /Log\.i\(logTag,[\s\S]{0,240}apiKey/);
  assert.doesNotMatch(androidJobManager, /Log\.i\(logTag,[\s\S]{0,240}prompt/);
});

test("Android native Images parser reports Cloudflare JSON errors clearly", () => {
  assert.match(androidJobManager, /private fun describeJSONProblem\(parsed: JSONObject, httpStatus: Int\): String\?/);
  assert.match(androidJobManager, /private fun payloadStatusCode\(parsed: JSONObject\): Int/);
  assert.match(
    androidJobManager,
    /describeJSONProblem\(parsed, 0\)\?\.let \{\s*throw JobRequestException\(it, rawPath, isRetryableRaw\(raw, payloadStatusCode\(parsed\)\)\)\s*\}/,
  );
  assert.match(androidJobManager, /parsed\.optBoolean\("cloudflare_error", false\)/);
  assert.match(androidJobManager, /Cloudflare \$\{if \(status > 0\) status else "错误"\}/);
  assert.match(androidJobManager, /describeJSONProblem\(parsed, status\)/);
});

test("Android native Images requests preserve the submitted pixel size", () => {
  const imagesRequestBody = androidJobManager.match(/private fun buildImagesRequestBody[\s\S]*?\n    private fun logFHLImagesRequestDiagnostics/)?.[0] ?? "";
  assert.ok(imagesRequestBody, "buildImagesRequestBody should exist");
  assert.match(imagesRequestBody, /val size = payload\.optString\("size", "864x1536"\)\.ifBlank \{ "864x1536" \}/);
  assert.doesNotMatch(imagesRequestBody, /repairSizeForOpenAI/);
  assert.match(imagesRequestBody, /\.put\("size", size\)/);
  assert.match(imagesRequestBody, /appendMultipartField\(out, boundary, "size", size\)/);
});

test("Android native Responses requests apply FHL exact ratio constraints", () => {
  const responsesPayload = androidJobManager.match(/private fun buildResponsesPayload[\s\S]*?\n    private fun batchVariationInstruction/)?.[0] ?? "";
  assert.ok(responsesPayload, "buildResponsesPayload should exist");
  assert.match(responsesPayload, /val size = when \{/);
  assert.match(responsesPayload, /parsedSize != null -> repairSizeForOpenAI\(rawSize\)/);
  assert.match(responsesPayload, /val aspectSuffix = fhlExactResponsesAspectPromptSuffix\(payload, size\)/);
  assert.match(responsesPayload, /if \(shouldDisablePartialImagesForFHLExactResponses\(payload, size\)\) 0 else normalizePartialImages/);
  assert.match(responsesPayload, /buildResponsesInstructions\(payload, size\)/);
  assert.match(androidJobManager, /private fun shouldDisablePartialImagesForFHLExactResponses\(payload: JSONObject, size: String\): Boolean/);
  assert.match(androidJobManager, /private fun fhlExactResponsesAspectInstruction\(payload: JSONObject, size: String\): String/);
  assert.match(androidJobManager, /private fun fhlExactResponsesAspectPromptSuffix\(payload: JSONObject, size: String\): String/);
  assert.match(androidJobManager, /The selected output aspect ratio is \$aspect/);
  assert.match(androidJobManager, /竖版画幅/);
  assert.match(androidJobManager, /横版画幅/);
});

test("Android native Responses jobs finish as soon as a final image SSE event arrives", () => {
  assert.match(androidJobManager, /private fun finalFromSSEEvent\(event: JSONObject\): JobImageResult\?/);
  assert.match(androidJobManager, /val final = finalFromSSEEvent\(event\)/);
  assert.match(androidJobManager, /writeRawLog\(context, "sse-response-attempt\$attempt-\$\{jobId\.takeLast\(8\)\}\.txt", raw\.toString\(\)\)/);
  assert.match(androidJobManager, /return final\.copy\(rawPath = rawPath\)/);
  assert.match(androidJobManager, /finalFromSSEEvent\(event\)\?\.let \{ return it \}/);
});

test("Android native queue audit records generation clicks without secrets", () => {
  const submitAudit = androidJobManager.match(/private fun buildSubmitAudit[\s\S]*?\n    private fun buildSlotAudit/)?.[0] ?? "";
  assert.ok(submitAudit, "buildSubmitAudit should exist");
  assert.match(androidJobManager, /private const val auditLogVersion = 2/);
  assert.match(androidJobManager, /private val auditLock = Any\(\)/);
  assert.match(androidJobManager, /private val auditSequence = AtomicLong\(0L\)/);
  assert.match(androidJobManager, /\.put\("processSessionId", processSessionId\)/);
  assert.match(androidJobManager, /\.put\("processId", android\.os\.Process\.myPid\(\)\)/);
  assert.match(androidJobManager, /\.put\("auditSequence", auditSequence\.incrementAndGet\(\)\)/);
  assert.match(androidJobManager, /private fun auditFile\(context: Context\): File = File\(context\.filesDir, "jobs\/android-job-audit\.v1\.jsonl"\)/);
  assert.match(androidJobManager, /appendJobAudit\(appContext, "submit", buildSubmitAudit\(createdGroup!!, createdPayload!!\)\)/);
  assert.match(androidJobManager, /appendJobAudit\(context, "slot_\$resolvedEventType", buildSlotAudit\(group, slot\)\)/);
  assert.match(androidJobManager, /appendJobAudit\(context, "slot_claimed", buildSlotAudit\(liveGroup, liveSlot\)\)/);
  assert.match(androidJobManager, /\.put\("mode", group\.optString\("mode"\)\)/);
  assert.match(androidJobManager, /\.put\("apiMode", group\.optString\("apiMode"\)\)/);
  assert.match(androidJobManager, /\.put\("clientSubmissionId", group\.optString\("clientSubmissionId"\)\)/);
  assert.match(androidJobManager, /val storedPayload = payloadForPersistence\(payload, groupId\)/);
  assert.match(androidJobManager, /stored\.remove\("apiKey"\)/);
  assert.match(androidJobManager, /require\(!payload\.has\("apiKey"\)\)/);
  assert.match(androidJobManager, /setTemporaryJobCredential\(groupId, submittedCredential\)/);
  assert.match(androidJobManager, /getTemporaryJobCredential\(groupId\)/);
  assert.match(androidJobManager, /deleteTemporaryJobCredential\(groupId\)/);
  assert.match(androidJobManager, /\.put\("size", group\.optString\("size"\)\)/);
  assert.match(androidJobManager, /\.put\("batchCount", group\.optInt\("batchCount", 1\)\)/);
  assert.match(androidJobManager, /\.put\("continuousGenerateTest", group\.optBoolean\("continuousGenerateTest", false\)\)/);
  assert.match(androidJobManager, /\.put\("concurrencyLimit", group\.optInt\("concurrencyLimit", 0\)\)/);
  assert.match(androidJobManager, /\.put\("promptChars", payload\.optString\("prompt"\)\.length\)/);
  assert.match(androidJobManager, /Log\.i\(logTag, "Job audit \$\{record\}"\)/);
  assert.doesNotMatch(submitAudit, /\.put\("apiKey"/);
  assert.doesNotMatch(submitAudit, /\.put\("prompt", payload\.optString\("prompt"\)\)/);
  assert.doesNotMatch(submitAudit, /\.put\("apiProfileName"/);
  assert.match(androidJobManager, /\.put\("hasRawPath", slot\.optString\("rawPath"\)\.isNotBlank\(\)\)/);
  assert.match(androidJobManager, /\.put\("errorMessageChars", errorMessage\.length\)/);
  assert.doesNotMatch(androidJobManager, /\.put\("errorMessage", if \(errorMessage\.isBlank\(\)/);
});

test("Android native background jobs auto-publish completed originals to gallery", () => {
  assert.match(androidJobManager, /val galleryUri = publishImageToGallery\(context, savedPath\)/);
  assert.match(androidJobManager, /current\.put\("galleryUri", galleryUri\)/);
  assert.match(androidJobManager, /private fun publishImageToGallery\(context: Context, savedPath: String\): String\?/);
  assert.match(androidJobManager, /MediaStore\.Images\.Media\.EXTERNAL_CONTENT_URI/);
  assert.match(androidJobManager, /MediaStore\.MediaColumns\.RELATIVE_PATH, Environment\.DIRECTORY_PICTURES \+ File\.separator \+ "ImageStudio"/);
  assert.match(androidJobManager, /FileInputStream\(source\)\.use \{ input -> input\.copyTo\(output\) \}/);
  assert.match(studioStore, /galleryUri: String\(slot\.galleryUri \|\| existing\?\.galleryUri \|\| ""\) \|\| undefined/);
});
