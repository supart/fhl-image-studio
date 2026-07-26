package backend

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/yuanhua/image-gptcodex/pkg/client"
)

type jobRunnerFunc func(context.Context, string, GenerateOptions) error

func (f jobRunnerFunc) Run(ctx context.Context, jobID string, opts GenerateOptions) error {
	return f(ctx, jobID, opts)
}

func newFakeRunnerService(runner JobRunner) *Service {
	svc := NewService()
	svc.jobRunner = runner
	svc.Startup(context.Background())
	svc.SetAutomationStatus(AutomationStatus{Enabled: true, E2EOnly: true})
	return svc
}

func waitFor(t *testing.T, condition func() bool, message string) {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if condition() {
			return
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatal(message)
}

func TestGenerateOptionsAPIProfileIDUsesExpectedJSONField(t *testing.T) {
	encoded, err := json.Marshal(GenerateOptions{APIProfileID: "profile-a"})
	if err != nil {
		t.Fatalf("marshal GenerateOptions: %v", err)
	}
	if !strings.Contains(string(encoded), `"apiProfileId":"profile-a"`) {
		t.Fatalf("api profile id JSON field missing from %s", encoded)
	}
}

func TestStartJobRejectsWhenSameProfileConcurrencyLimitReached(t *testing.T) {
	started := make(chan struct{}, 1)
	release := make(chan struct{})
	svc := newFakeRunnerService(jobRunnerFunc(func(context.Context, string, GenerateOptions) error {
		started <- struct{}{}
		<-release
		return nil
	}))

	first, err := svc.Generate(GenerateOptions{
		APIKey: "sk-test", Prompt: "first", APIMode: "images",
		APIProfileID: "profile-a", ConcurrencyLimit: 1,
	})
	if err != nil {
		t.Fatalf("start first job: %v", err)
	}
	<-started
	_, err = svc.Generate(GenerateOptions{
		APIKey: "sk-test", Prompt: "second", APIMode: "responses",
		APIProfileID: "profile-a", ConcurrencyLimit: 1,
	})
	if err == nil || !strings.Contains(err.Error(), "并发限制 1") {
		t.Fatalf("expected shared profile limit error, got %v", err)
	}
	close(release)
	waitFor(t, func() bool { _, ok := svc.jobManager.state(first.JobID); return !ok }, "first job did not settle")
}

func TestConcurrencyBucketSharesConfiguredProfileAcrossAPIModes(t *testing.T) {
	imagesKey := concurrencyBucketKey("images", "profile-a")
	responsesKey := concurrencyBucketKey("responses", "profile-a")
	if imagesKey != responsesKey {
		t.Fatalf("same profile should share Images and Responses capacity: %q != %q", imagesKey, responsesKey)
	}
	if imagesKey == concurrencyBucketKey("images", "profile-b") {
		t.Fatal("different profiles should use independent capacity buckets")
	}
}

func TestStartJobConcurrencyLimitAllowsDifferentImagesProfiles(t *testing.T) {
	started := make(chan string, 2)
	release := make(chan struct{})
	svc := newFakeRunnerService(jobRunnerFunc(func(_ context.Context, jobID string, _ GenerateOptions) error {
		started <- jobID
		<-release
		return nil
	}))

	for _, profileID := range []string{"profile-a", "profile-b"} {
		if _, err := svc.Generate(GenerateOptions{
			APIKey: "sk-test", Prompt: profileID, APIMode: "images",
			APIProfileID: profileID, ConcurrencyLimit: 1,
		}); err != nil {
			t.Fatalf("start %s: %v", profileID, err)
		}
	}
	waitFor(t, func() bool { return len(started) == 2 }, "different profiles did not run concurrently")
	close(release)
	waitFor(t, func() bool {
		return svc.jobManager.running(concurrencyBucketKey("images", "profile-a")) == 0 &&
			svc.jobManager.running(concurrencyBucketKey("images", "profile-b")) == 0
	}, "profile capacity was not released")
}

func TestStartJobEmptyProfileIDUsesLegacyAPIModeBucket(t *testing.T) {
	started := make(chan struct{}, 1)
	release := make(chan struct{})
	svc := newFakeRunnerService(jobRunnerFunc(func(context.Context, string, GenerateOptions) error {
		started <- struct{}{}
		<-release
		return nil
	}))

	if _, err := svc.Generate(GenerateOptions{
		APIKey: "sk-test", Prompt: "first", APIMode: "images", ConcurrencyLimit: 1,
	}); err != nil {
		t.Fatalf("start first legacy job: %v", err)
	}
	<-started
	_, err := svc.Generate(GenerateOptions{
		APIKey: "sk-test", Prompt: "second", APIMode: "images", ConcurrencyLimit: 1,
	})
	if err == nil {
		t.Fatal("expected legacy Images bucket to enforce its concurrency limit")
	}
	close(release)
}

func TestStartJobConcurrencyLimitZeroIsUnlimited(t *testing.T) {
	started := make(chan struct{}, 2)
	release := make(chan struct{})
	svc := newFakeRunnerService(jobRunnerFunc(func(context.Context, string, GenerateOptions) error {
		started <- struct{}{}
		<-release
		return nil
	}))
	for i := 0; i < 2; i++ {
		if _, err := svc.Generate(GenerateOptions{
			APIKey: "sk-test", Prompt: "unlimited", APIMode: "responses",
			APIProfileID: "profile-a", ConcurrencyLimit: 0,
		}); err != nil {
			t.Fatalf("start unlimited job %d: %v", i, err)
		}
	}
	waitFor(t, func() bool { return len(started) == 2 }, "zero limit did not allow concurrent work")
	close(release)
}

func TestConfiguredProfileResponsesNeverFallsBackToImages(t *testing.T) {
	if shouldFallbackResponsesToImagesInService(
		client.APIModeResponses, client.ModeGenerate, errors.New("idle timeout"), "", "fhl-slot-1",
	) {
		t.Fatal("configured FHL profile must keep its selected Responses transport")
	}
	if !shouldFallbackResponsesToImagesInService(
		client.APIModeResponses, client.ModeGenerate, errors.New("idle timeout"), "", "",
	) {
		t.Fatal("legacy calls without apiProfileId should retain their fallback behavior")
	}
}

func TestAcceptedJobUsesImmutableOptionsSnapshot(t *testing.T) {
	captured := make(chan GenerateOptions, 1)
	svc := newFakeRunnerService(jobRunnerFunc(func(_ context.Context, _ string, opts GenerateOptions) error {
		captured <- opts
		return nil
	}))
	for i := 0; i < cap(svc.jobManager.networkSlots); i++ {
		svc.jobManager.networkSlots <- struct{}{}
	}

	paths := []string{"original.png"}
	started, err := svc.Generate(GenerateOptions{
		APIKey: "sk-test", Prompt: "snapshot", APIMode: "images",
		APIProfileID: "profile-a", ImagePaths: paths,
	})
	if err != nil {
		t.Fatalf("start snapshot job: %v", err)
	}
	paths[0] = "mutated.png"
	<-svc.jobManager.networkSlots
	got := <-captured
	if len(got.ImagePaths) != 1 || got.ImagePaths[0] != "original.png" {
		t.Fatalf("runner observed mutable caller slice: %v", got.ImagePaths)
	}
	waitFor(t, func() bool { _, ok := svc.jobManager.state(started.JobID); return !ok }, "snapshot job did not settle")
	for len(svc.jobManager.networkSlots) > 0 {
		<-svc.jobManager.networkSlots
	}
}

func TestJobEventsAreSequencedAndSettledAfterCapacityRelease(t *testing.T) {
	started := make(chan struct{}, 1)
	release := make(chan struct{})
	svc := newFakeRunnerService(jobRunnerFunc(func(context.Context, string, GenerateOptions) error {
		started <- struct{}{}
		<-release
		return nil
	}))

	type recordedEvent struct {
		name string
		args []any
	}
	var mu sync.Mutex
	var events []recordedEvent
	settled := make(chan struct{}, 1)
	svc.SetEventSink(func(eventName string, args ...any) {
		mu.Lock()
		events = append(events, recordedEvent{name: eventName, args: append([]any(nil), args...)})
		mu.Unlock()
		if strings.HasPrefix(eventName, "settled:") {
			settled <- struct{}{}
		}
	})

	jobID := "sequence-test"
	if _, err := svc.Generate(GenerateOptions{
		APIKey: "sk-test", Prompt: "sequence", APIMode: "images",
		APIProfileID: "profile-a", ConcurrencyLimit: 1, RequestedJobID: jobID,
	}); err != nil {
		t.Fatalf("start job: %v", err)
	}
	<-started
	if !svc.emitJobEventUnlessCancelled(jobID, "progress:"+jobID, ProgressPayload{Stage: "request"}) {
		t.Fatal("progress event was rejected")
	}
	if !svc.emitJobEventUnlessCancelled(jobID, "log:"+jobID, "working") {
		t.Fatal("log event was rejected")
	}
	if !svc.emitJobEventUnlessCancelled(jobID, "preview:"+jobID, PreviewPayload{}) {
		t.Fatal("preview event was rejected")
	}
	if !svc.emitJobEventUnlessCancelled(jobID, "result:"+jobID, ResultPayload{}) {
		t.Fatal("result event was rejected")
	}
	if svc.emitJobEventUnlessCancelled(jobID, "error:"+jobID, ErrorPayload{Message: "late"}) {
		t.Fatal("terminal error was accepted after result")
	}
	close(release)
	select {
	case <-settled:
	case <-time.After(2 * time.Second):
		t.Fatal("job did not settle")
	}
	if svc.jobManager.running(concurrencyBucketKey("images", "profile-a")) != 0 {
		t.Fatal("settled was emitted before profile capacity release")
	}

	mu.Lock()
	defer mu.Unlock()
	if len(events) != 5 {
		t.Fatalf("unexpected events: %#v", events)
	}
	states := []jobLifecycleState{jobStateRunning, jobStateRunning, jobStateRunning, jobStateSucceeded, jobStateSettled}
	for i, event := range events {
		if len(event.args) != 2 {
			t.Fatalf("event %s args = %#v, want payload + metadata", event.name, event.args)
		}
		meta, ok := event.args[1].(JobEventMeta)
		if !ok {
			t.Fatalf("event %s metadata type = %T", event.name, event.args[1])
		}
		if meta.Sequence != uint64(i+1) || meta.State != states[i] {
			t.Fatalf("event %s metadata = %#v", event.name, meta)
		}
	}
	if events[len(events)-1].args[0] != nil {
		t.Fatal("settled first argument must remain nil for compatibility")
	}
}

func TestEventSinkCanReenterSameJobAndCancel(t *testing.T) {
	started := make(chan struct{}, 1)
	release := make(chan struct{})
	svc := newFakeRunnerService(jobRunnerFunc(func(context.Context, string, GenerateOptions) error {
		started <- struct{}{}
		<-release
		return nil
	}))
	jobID := "reentrant-events"
	events := make(chan string, 3)
	svc.SetEventSink(func(name string, _ ...any) {
		events <- name
		switch name {
		case "progress:" + jobID:
			if !svc.emitJobEventUnlessCancelled(jobID, "log:"+jobID, "nested") {
				t.Error("reentrant log event was rejected")
			}
		case "log:" + jobID:
			if err := svc.Cancel(jobID); err != nil {
				t.Errorf("reentrant cancel: %v", err)
			}
		}
	})
	if _, err := svc.Generate(GenerateOptions{
		APIKey: "sk-test", Prompt: "reentrant", APIMode: "images", RequestedJobID: jobID,
	}); err != nil {
		t.Fatalf("start job: %v", err)
	}
	<-started
	delivered := make(chan bool, 1)
	go func() {
		delivered <- svc.emitJobEventUnlessCancelled(jobID, "progress:"+jobID, ProgressPayload{})
	}()
	select {
	case ok := <-delivered:
		if !ok {
			t.Fatal("progress event was rejected")
		}
	case <-time.After(time.Second):
		t.Fatal("reentrant event sink deadlocked")
	}
	if first, second := <-events, <-events; first != "progress:"+jobID || second != "log:"+jobID {
		t.Fatalf("reentrant event order = %q, %q", first, second)
	}
	state, ok := svc.jobManager.state(jobID)
	if !ok || state != jobStateCancelRequested {
		t.Fatalf("state after reentrant cancel = %q, exists=%v", state, ok)
	}
	close(release)
	waitFor(t, func() bool { _, exists := svc.jobManager.state(jobID); return !exists }, "reentrant job did not settle")
}

func TestShutdownWaitsForSettledEventDelivery(t *testing.T) {
	svc := newFakeRunnerService(jobRunnerFunc(func(context.Context, string, GenerateOptions) error {
		return nil
	}))
	settledEntered := make(chan struct{}, 1)
	releaseSettled := make(chan struct{})
	svc.SetEventSink(func(name string, _ ...any) {
		if strings.HasPrefix(name, "settled:") {
			settledEntered <- struct{}{}
			<-releaseSettled
		}
	})
	if _, err := svc.Generate(GenerateOptions{APIKey: "sk-test", Prompt: "settled wait", APIMode: "images"}); err != nil {
		t.Fatalf("start job: %v", err)
	}
	select {
	case <-settledEntered:
	case <-time.After(time.Second):
		t.Fatal("settled event was not delivered")
	}
	shutdownReturned := make(chan struct{})
	go func() {
		svc.Shutdown(context.Background())
		close(shutdownReturned)
	}()
	select {
	case <-shutdownReturned:
		t.Fatal("Shutdown returned while settled delivery was blocked")
	case <-time.After(30 * time.Millisecond):
	}
	close(releaseSettled)
	select {
	case <-shutdownReturned:
	case <-time.After(time.Second):
		t.Fatal("Shutdown did not return after settled delivery completed")
	}
}

func TestCancelSuppressesLateEventsAndHoldsCapacityUntilSettled(t *testing.T) {
	started := make(chan struct{}, 1)
	release := make(chan struct{})
	svc := newFakeRunnerService(jobRunnerFunc(func(context.Context, string, GenerateOptions) error {
		started <- struct{}{}
		<-release // Deliberately ignore cancellation until the fake worker exits.
		return nil
	}))
	jobID := "cancelled-job"
	settled := make(chan struct{}, 1)
	var eventNames []string
	var mu sync.Mutex
	svc.SetEventSink(func(eventName string, _ ...any) {
		mu.Lock()
		eventNames = append(eventNames, eventName)
		mu.Unlock()
		if eventName == "settled:"+jobID {
			settled <- struct{}{}
		}
	})

	if _, err := svc.Generate(GenerateOptions{
		APIKey: "sk-test", Prompt: "cancel", APIMode: "images",
		APIProfileID: "profile-a", ConcurrencyLimit: 1, RequestedJobID: jobID,
	}); err != nil {
		t.Fatalf("start job: %v", err)
	}
	<-started
	if err := svc.Cancel(jobID); err != nil {
		t.Fatalf("cancel job: %v", err)
	}
	if svc.emitJobEventUnlessCancelled(jobID, "preview:"+jobID, PreviewPayload{}) {
		t.Fatal("late preview event should be suppressed")
	}
	svc.emitError(jobID, errors.New("late error"))
	if _, err := svc.Generate(GenerateOptions{
		APIKey: "sk-test", Prompt: "blocked", APIMode: "responses",
		APIProfileID: "profile-a", ConcurrencyLimit: 1,
	}); err == nil {
		t.Fatal("cancel released capacity before the worker settled")
	}
	close(release)
	select {
	case <-settled:
	case <-time.After(2 * time.Second):
		t.Fatal("cancelled job did not settle")
	}
	if _, err := svc.Generate(GenerateOptions{
		APIKey: "sk-test", Prompt: "replacement", APIMode: "images",
		APIProfileID: "profile-a", ConcurrencyLimit: 1,
	}); err != nil {
		t.Fatalf("capacity was not restored after settle: %v", err)
	}
	waitFor(t, func() bool { return svc.jobManager.running(concurrencyBucketKey("images", "profile-a")) == 0 }, "replacement did not settle")

	mu.Lock()
	defer mu.Unlock()
	for _, name := range eventNames {
		if strings.HasPrefix(name, "preview:") || strings.HasPrefix(name, "result:") || strings.HasPrefix(name, "error:") {
			t.Fatalf("cancelled job emitted terminal/media event: %v", eventNames)
		}
	}
}

func TestGlobalNetworkLimitQueuesBeyondTwenty(t *testing.T) {
	started := make(chan struct{}, 25)
	release := make(chan struct{})
	var active atomic.Int32
	var maximum atomic.Int32
	var completed atomic.Int32
	svc := newFakeRunnerService(jobRunnerFunc(func(context.Context, string, GenerateOptions) error {
		current := active.Add(1)
		for {
			previous := maximum.Load()
			if current <= previous || maximum.CompareAndSwap(previous, current) {
				break
			}
		}
		started <- struct{}{}
		<-release
		active.Add(-1)
		completed.Add(1)
		return nil
	}))

	for i := 0; i < 25; i++ {
		if _, err := svc.Generate(GenerateOptions{
			APIKey: "sk-test", Prompt: "network limit", APIMode: "images",
			APIProfileID: string(rune('a' + i)), ConcurrencyLimit: 1,
		}); err != nil {
			t.Fatalf("accept job %d: %v", i, err)
		}
	}
	waitFor(t, func() bool { return len(started) == maxConcurrentNetworkJobs }, "first twenty jobs did not start")
	time.Sleep(50 * time.Millisecond)
	if got := len(started); got != maxConcurrentNetworkJobs {
		t.Fatalf("network runner started %d jobs before capacity release", got)
	}
	close(release)
	waitFor(t, func() bool { return completed.Load() == 25 }, "network jobs did not drain")
	if got := maximum.Load(); got > maxConcurrentNetworkJobs {
		t.Fatalf("maximum network concurrency = %d, want <= %d", got, maxConcurrentNetworkJobs)
	}
}

func TestMediaEncodingLimitQueuesFifthOperation(t *testing.T) {
	svc := NewService()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	releases := make([]func(), 0, maxConcurrentMediaEncodes)
	for i := 0; i < maxConcurrentMediaEncodes; i++ {
		release, err := svc.acquireMediaSlot(ctx)
		if err != nil {
			t.Fatalf("acquire media slot %d: %v", i, err)
		}
		releases = append(releases, release)
	}

	fifth := make(chan func(), 1)
	go func() {
		release, err := svc.acquireMediaSlot(ctx)
		if err == nil {
			fifth <- release
		}
	}()
	select {
	case release := <-fifth:
		release()
		t.Fatal("fifth media operation started before capacity was released")
	case <-time.After(30 * time.Millisecond):
	}
	releases[0]()
	select {
	case release := <-fifth:
		release()
	case <-time.After(time.Second):
		t.Fatal("queued media operation did not start after capacity release")
	}
	for _, release := range releases[1:] {
		release()
	}
}

func TestWithMediaSlotReleasesCapacityAfterPanic(t *testing.T) {
	svc := NewService()
	func() {
		defer func() {
			if recover() == nil {
				t.Error("media work did not panic")
			}
		}()
		_ = svc.withMediaSlot(context.Background(), func() error {
			panic("encode panic")
		})
	}()
	if got := len(svc.mediaSlots); got != 0 {
		t.Fatalf("media slots retained after panic: %d", got)
	}
	releases := make([]func(), 0, maxConcurrentMediaEncodes)
	for i := 0; i < maxConcurrentMediaEncodes; i++ {
		release, err := svc.acquireMediaSlot(context.Background())
		if err != nil {
			t.Fatalf("acquire media slot after panic %d: %v", i, err)
		}
		releases = append(releases, release)
	}
	for _, release := range releases {
		release()
	}
}

func TestShutdownCancelsAndWaitsForSynchronousOperation(t *testing.T) {
	svc := NewService()
	operationCtx, finishOperation, err := svc.beginOperation(false)
	if err != nil {
		t.Fatalf("begin operation: %v", err)
	}
	operationDone := make(chan struct{})
	go func() {
		defer finishOperation()
		<-operationCtx.Done()
		close(operationDone)
	}()
	svc.Shutdown(context.Background())
	select {
	case <-operationDone:
	default:
		t.Fatal("Shutdown returned before synchronous operation stopped")
	}
	if _, _, err := svc.beginOperation(false); err == nil {
		t.Fatal("service accepted an operation after Shutdown")
	}
}

func TestShutdownWakesQueuedMediaOperationWithoutRunningIt(t *testing.T) {
	svc := NewService()
	holderReleases := make([]func(), 0, maxConcurrentMediaEncodes)
	for i := 0; i < maxConcurrentMediaEncodes; i++ {
		release, err := svc.acquireMediaSlot(context.Background())
		if err != nil {
			t.Fatalf("fill media slot %d: %v", i, err)
		}
		holderReleases = append(holderReleases, release)
	}
	operationCtx, finishOperation, err := svc.beginOperation(false)
	if err != nil {
		t.Fatalf("begin queued operation: %v", err)
	}
	workRan := atomic.Bool{}
	waiterDone := make(chan error, 1)
	go func() {
		defer finishOperation()
		waiterDone <- svc.withMediaSlot(operationCtx, func() error {
			workRan.Store(true)
			return nil
		})
	}()
	svc.Shutdown(context.Background())
	if err := <-waiterDone; !errors.Is(err, context.Canceled) {
		t.Fatalf("queued media shutdown error = %v", err)
	}
	if workRan.Load() {
		t.Fatal("queued media work ran after shutdown cancellation")
	}
	for _, release := range holderReleases {
		release()
	}
}

func TestRunnerFailureEmitsErrorThenSettlesAndReleasesCapacity(t *testing.T) {
	svc := newFakeRunnerService(jobRunnerFunc(func(context.Context, string, GenerateOptions) error {
		return errors.New("fake upstream failure")
	}))
	type event struct {
		name string
		args []any
	}
	events := make(chan event, 2)
	svc.SetEventSink(func(name string, args ...any) {
		if strings.HasPrefix(name, "error:") || strings.HasPrefix(name, "settled:") {
			events <- event{name: name, args: args}
		}
	})
	jobID := "failure-test"
	if _, err := svc.Generate(GenerateOptions{
		APIKey: "sk-test", Prompt: "failure", APIMode: "images",
		APIProfileID: "profile-a", ConcurrencyLimit: 1, RequestedJobID: jobID,
	}); err != nil {
		t.Fatalf("start job: %v", err)
	}
	first := <-events
	second := <-events
	if first.name != "error:"+jobID || second.name != "settled:"+jobID {
		t.Fatalf("terminal event order = %s, %s", first.name, second.name)
	}
	firstMeta, ok := first.args[1].(JobEventMeta)
	if !ok || firstMeta.State != jobStateFailed {
		t.Fatalf("error metadata = %#v", first.args)
	}
	secondMeta, ok := second.args[1].(JobEventMeta)
	if !ok || secondMeta.State != jobStateSettled || secondMeta.Sequence <= firstMeta.Sequence {
		t.Fatalf("settled metadata = %#v", second.args)
	}
	if got := svc.jobManager.running(concurrencyBucketKey("images", "profile-a")); got != 0 {
		t.Fatalf("failure retained profile capacity: %d", got)
	}
}

func TestJobManagerSettlesExactlyOnce(t *testing.T) {
	manager := newJobManager(1)
	j, err := manager.accept(context.Background(), "once", "images", 1, GenerateOptions{})
	if err != nil {
		t.Fatalf("accept job: %v", err)
	}
	manager.complete(j, nil)
	settledCount := 0
	deliver := func(JobEventMeta) { settledCount++ }
	manager.settle(j, deliver)
	manager.settle(j, deliver)
	if settledCount != 1 {
		t.Fatalf("settled delivered %d times", settledCount)
	}
	if manager.running("images") != 0 {
		t.Fatal("settle-once did not release capacity")
	}
}

func TestShutdownCancelsWorkersWaitsAndRejectsNewJobs(t *testing.T) {
	started := make(chan struct{}, 1)
	svc := newFakeRunnerService(jobRunnerFunc(func(ctx context.Context, _ string, _ GenerateOptions) error {
		started <- struct{}{}
		<-ctx.Done()
		return ctx.Err()
	}))
	if _, err := svc.Generate(GenerateOptions{APIKey: "sk-test", Prompt: "shutdown", APIMode: "images"}); err != nil {
		t.Fatalf("start job: %v", err)
	}
	<-started
	svc.Shutdown(context.Background())
	if _, err := svc.Generate(GenerateOptions{APIKey: "sk-test", Prompt: "late", APIMode: "images"}); err == nil {
		t.Fatal("shutdown service accepted new work")
	}
}

func TestContextCancellationCompletesManagedJobAsCancelled(t *testing.T) {
	for name, runErr := range map[string]error{
		"context error": context.Canceled,
		"nil result":    nil,
		"custom error":  errors.New("runner stopped after cancellation"),
	} {
		t.Run(name, func(t *testing.T) {
			manager := newJobManager(1)
			parent, cancel := context.WithCancel(context.Background())
			j, err := manager.accept(parent, "cancel-reason", "images", 1, GenerateOptions{})
			if err != nil {
				t.Fatalf("accept job: %v", err)
			}
			if !manager.markRunning(j) {
				t.Fatal("mark job running")
			}
			cancel()
			if manager.emit(j.id, jobStateSucceeded, func(JobEventMeta) {}) {
				t.Fatal("result was accepted after context cancellation")
			}
			manager.complete(j, runErr)
			j.eventMu.Lock()
			state := j.state
			j.eventMu.Unlock()
			if state != jobStateCancelled {
				t.Fatalf("cancelled context completed as %q", state)
			}
			manager.settle(j, func(JobEventMeta) {})
		})
	}
}

func TestConcurrentStartAndShutdownLeavesNoAcceptedJobs(t *testing.T) {
	for iteration := 0; iteration < 20; iteration++ {
		svc := newFakeRunnerService(jobRunnerFunc(func(ctx context.Context, _ string, _ GenerateOptions) error {
			<-ctx.Done()
			return ctx.Err()
		}))
		startDone := make(chan struct{})
		go func() {
			_, _ = svc.Generate(GenerateOptions{APIKey: "sk-test", Prompt: "race", APIMode: "images"})
			close(startDone)
		}()
		shutdownDone := make(chan struct{})
		go func() {
			svc.Shutdown(context.Background())
			close(shutdownDone)
		}()
		select {
		case <-startDone:
		case <-time.After(time.Second):
			t.Fatal("concurrent start did not return")
		}
		select {
		case <-shutdownDone:
		case <-time.After(time.Second):
			t.Fatal("concurrent shutdown did not return")
		}
		svc.jobManager.mu.Lock()
		remaining := len(svc.jobManager.jobs)
		svc.jobManager.mu.Unlock()
		if remaining != 0 {
			t.Fatalf("iteration %d retained %d jobs", iteration, remaining)
		}
	}
}

func TestJobManagerShutdownIsBoundedWhenRunnerDoesNotSettle(t *testing.T) {
	manager := newJobManager(1)
	j, err := manager.accept(context.Background(), "stuck", "images", 1, GenerateOptions{})
	if err != nil {
		t.Fatalf("accept job: %v", err)
	}
	started := time.Now()
	if manager.shutdown(20 * time.Millisecond) {
		t.Fatal("shutdown reported success for an unsettled job")
	}
	if elapsed := time.Since(started); elapsed > 500*time.Millisecond {
		t.Fatalf("bounded shutdown took %s", elapsed)
	}
	manager.complete(j, context.Canceled)
	manager.settle(j, func(JobEventMeta) {})
}

func TestEmitInE2EOnlyUsesEventSinkWithoutWailsRuntime(t *testing.T) {
	svc := NewService()
	svc.Startup(context.Background())
	svc.SetAutomationStatus(AutomationStatus{Enabled: true, E2EOnly: true})

	called := false
	svc.SetEventSink(func(eventName string, args ...any) {
		called = eventName == "result:test" && len(args) == 1 && args[0] == "ok"
	})
	svc.emit("result:test", "ok")
	if !called {
		t.Fatal("expected e2e event sink to receive event")
	}
}
