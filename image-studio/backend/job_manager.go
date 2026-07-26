package backend

import (
	"context"
	"errors"
	"sync"
	"sync/atomic"
	"time"
)

const (
	maxConcurrentNetworkJobs  = 20
	maxConcurrentMediaEncodes = 4
	jobShutdownTimeout        = 5 * time.Second
)

type jobLifecycleState string

const (
	jobStateAccepted        jobLifecycleState = "accepted"
	jobStateRunning         jobLifecycleState = "running"
	jobStateCancelRequested jobLifecycleState = "cancelRequested"
	jobStateSucceeded       jobLifecycleState = "succeeded"
	jobStateFailed          jobLifecycleState = "failed"
	jobStateCancelled       jobLifecycleState = "cancelled"
	jobStateSettled         jobLifecycleState = "settled"
)

// JobEventMeta is emitted as the second Wails event argument. The first
// argument remains unchanged for compatibility with older frontends.
type JobEventMeta struct {
	Sequence uint64            `json:"sequence"`
	State    jobLifecycleState `json:"state"`
}

type managedJob struct {
	id             string
	ctx            context.Context
	cancel         context.CancelFunc
	done           chan struct{}
	concurrencyKey string
	options        GenerateOptions

	eventMu     sync.Mutex
	state       jobLifecycleState
	sequence    uint64
	eventQueue  []jobEventDelivery
	dispatching bool
	settleOnce  sync.Once
}

type jobEventDelivery struct {
	meta    JobEventMeta
	deliver func(JobEventMeta)
}

type jobManager struct {
	mu                      sync.Mutex
	jobs                    map[string]*managedJob
	runningByConcurrencyKey map[string]int
	networkSlots            chan struct{}
	shutdownCh              chan struct{}
	cancelDone              chan struct{}
	shutdownOnce            sync.Once
	shutdownStarted         atomic.Bool
	closed                  bool
	workerCount             int
	workersDone             chan struct{}
	workersDoneOnce         sync.Once
}

func newJobManager(networkLimit int) *jobManager {
	if networkLimit <= 0 {
		networkLimit = maxConcurrentNetworkJobs
	}
	return &jobManager{
		jobs:                    make(map[string]*managedJob),
		runningByConcurrencyKey: make(map[string]int),
		networkSlots:            make(chan struct{}, networkLimit),
		shutdownCh:              make(chan struct{}),
		cancelDone:              make(chan struct{}),
		workersDone:             make(chan struct{}),
	}
}

func (m *jobManager) accept(parent context.Context, jobID, concurrencyKey string, limit int, opts GenerateOptions) (*managedJob, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.closed {
		return nil, errJobManagerClosed
	}
	if _, exists := m.jobs[jobID]; exists {
		return nil, errJobIDExists
	}
	if limit > 0 && m.runningByConcurrencyKey[concurrencyKey] >= limit {
		return nil, errConcurrencyLimitReached
	}

	ctx, cancel := context.WithCancel(parent)
	j := &managedJob{
		id:             jobID,
		ctx:            ctx,
		cancel:         cancel,
		done:           make(chan struct{}),
		concurrencyKey: concurrencyKey,
		options:        cloneGenerateOptions(opts),
		state:          jobStateAccepted,
	}
	m.jobs[jobID] = j
	m.runningByConcurrencyKey[concurrencyKey]++
	m.workerCount++
	return j, nil
}

var (
	errConcurrencyLimitReached = errors.New("concurrency limit reached")
	errJobIDExists             = errors.New("job id already exists")
	errJobManagerClosed        = errors.New("job manager closed")
)

func cloneGenerateOptions(opts GenerateOptions) GenerateOptions {
	clone := opts
	clone.ImagePaths = append([]string(nil), opts.ImagePaths...)
	return clone
}

func (m *jobManager) lookup(jobID string) (*managedJob, bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	j, ok := m.jobs[jobID]
	return j, ok
}

func (m *jobManager) canStart(concurrencyKey string, limit int) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	return !m.closed && (limit <= 0 || m.runningByConcurrencyKey[concurrencyKey] < limit)
}

func (m *jobManager) acquireNetwork(ctx context.Context) (func(), error) {
	m.mu.Lock()
	closed := m.closed
	m.mu.Unlock()
	if closed {
		return nil, errJobManagerClosed
	}
	select {
	case m.networkSlots <- struct{}{}:
		if err := ctx.Err(); err != nil {
			<-m.networkSlots
			return nil, err
		}
		m.mu.Lock()
		closed = m.closed
		m.mu.Unlock()
		if closed {
			<-m.networkSlots
			return nil, errJobManagerClosed
		}
		return func() { <-m.networkSlots }, nil
	case <-ctx.Done():
		return nil, ctx.Err()
	case <-m.shutdownCh:
		return nil, errJobManagerClosed
	}
}

func (m *jobManager) markRunning(j *managedJob) bool {
	j.eventMu.Lock()
	defer j.eventMu.Unlock()
	if m.shutdownStarted.Load() || j.ctx.Err() != nil {
		if j.state == jobStateAccepted {
			j.state = jobStateCancelRequested
		}
		return false
	}
	if j.state != jobStateAccepted {
		return false
	}
	j.state = jobStateRunning
	return true
}

func (m *jobManager) cancel(jobID string) {
	j, ok := m.lookup(jobID)
	if !ok {
		return
	}

	j.eventMu.Lock()
	if j.state != jobStateAccepted && j.state != jobStateRunning {
		j.eventMu.Unlock()
		return
	}
	j.state = jobStateCancelRequested
	j.cancel()
	j.eventMu.Unlock()
}

func (m *jobManager) emit(jobID string, nextState jobLifecycleState, deliver func(JobEventMeta)) bool {
	if m.shutdownStarted.Load() {
		return false
	}
	j, ok := m.lookup(jobID)
	if !ok {
		return false
	}

	j.eventMu.Lock()
	if m.shutdownStarted.Load() || j.ctx.Err() != nil {
		if j.state == jobStateAccepted || j.state == jobStateRunning {
			j.state = jobStateCancelRequested
		}
		j.eventMu.Unlock()
		return false
	}
	if j.state == jobStateCancelRequested || j.state == jobStateCancelled || j.state == jobStateSettled ||
		j.state == jobStateSucceeded || j.state == jobStateFailed {
		j.eventMu.Unlock()
		return false
	}
	if nextState != "" {
		j.state = nextState
	}
	j.sequence++
	meta := JobEventMeta{Sequence: j.sequence, State: j.state}
	j.eventQueue = append(j.eventQueue, jobEventDelivery{meta: meta, deliver: deliver})
	startDispatch := !j.dispatching
	if startDispatch {
		j.dispatching = true
	}
	j.eventMu.Unlock()
	if startDispatch {
		dispatchJobEvents(j)
	}
	return true
}

func dispatchJobEvents(j *managedJob) {
	for {
		j.eventMu.Lock()
		if len(j.eventQueue) == 0 {
			j.dispatching = false
			j.eventMu.Unlock()
			return
		}
		next := j.eventQueue[0]
		j.eventQueue = j.eventQueue[1:]
		j.eventMu.Unlock()
		func() {
			defer func() { _ = recover() }()
			next.deliver(next.meta)
		}()
	}
}

func (m *jobManager) complete(j *managedJob, runErr error) {
	j.eventMu.Lock()
	defer j.eventMu.Unlock()
	switch j.state {
	case jobStateCancelRequested:
		j.state = jobStateCancelled
	case jobStateSucceeded, jobStateFailed:
		return
	case jobStateAccepted, jobStateRunning:
		if m.shutdownStarted.Load() || errors.Is(runErr, errJobManagerClosed) || j.ctx.Err() != nil {
			j.state = jobStateCancelled
		} else if runErr != nil {
			j.state = jobStateFailed
		} else {
			j.state = jobStateSucceeded
		}
	}
}

func (m *jobManager) settle(j *managedJob, deliver func(JobEventMeta)) {
	j.settleOnce.Do(func() {
		j.eventMu.Lock()
		if j.state == jobStateCancelRequested {
			j.state = jobStateCancelled
		}
		j.state = jobStateSettled
		j.sequence++
		meta := JobEventMeta{Sequence: j.sequence, State: j.state}
		j.eventQueue = append(j.eventQueue, jobEventDelivery{meta: meta, deliver: deliver})
		startDispatch := !j.dispatching
		if startDispatch {
			j.dispatching = true
		}
		j.eventMu.Unlock()

		m.mu.Lock()
		if current, exists := m.jobs[j.id]; exists && current == j {
			if m.runningByConcurrencyKey[j.concurrencyKey] > 1 {
				m.runningByConcurrencyKey[j.concurrencyKey]--
			} else {
				delete(m.runningByConcurrencyKey, j.concurrencyKey)
			}
			delete(m.jobs, j.id)
		}
		m.mu.Unlock()

		close(j.done)
		defer m.workerFinished()
		if startDispatch {
			dispatchJobEvents(j)
		}
	})
}

func (m *jobManager) workerFinished() {
	m.mu.Lock()
	if m.workerCount > 0 {
		m.workerCount--
	}
	finished := m.closed && m.workerCount == 0
	m.mu.Unlock()
	if finished {
		m.workersDoneOnce.Do(func() { close(m.workersDone) })
	}
}

func (m *jobManager) beginShutdown() {
	if !m.shutdownStarted.CompareAndSwap(false, true) {
		return
	}
	m.mu.Lock()
	m.closed = true
	jobs := make([]*managedJob, 0, len(m.jobs))
	for _, j := range m.jobs {
		jobs = append(jobs, j)
	}
	noWorkers := m.workerCount == 0
	m.mu.Unlock()
	if noWorkers {
		m.workersDoneOnce.Do(func() { close(m.workersDone) })
	}

	m.shutdownOnce.Do(func() { close(m.shutdownCh) })
	go func() {
		defer close(m.cancelDone)
		for _, j := range jobs {
			m.cancel(j.id)
		}
	}()
}

func (m *jobManager) waitForShutdown(timeout time.Duration) bool {
	if timeout <= 0 {
		timeout = jobShutdownTimeout
	}
	timer := time.NewTimer(timeout)
	defer timer.Stop()

	workersDone := m.workersDone
	cancelDone := m.cancelDone
	workersSettled := false
	cancellationSettled := false
	for !workersSettled || !cancellationSettled {
		select {
		case <-workersDone:
			workersSettled = true
			workersDone = nil
		case <-cancelDone:
			cancellationSettled = true
			cancelDone = nil
		case <-timer.C:
			return false
		}
	}
	return true
}

func (m *jobManager) shutdownSignals() (<-chan struct{}, <-chan struct{}) {
	return m.workersDone, m.cancelDone
}

func (m *jobManager) shutdown(timeout time.Duration) bool {
	m.beginShutdown()
	return m.waitForShutdown(timeout)
}

func (m *jobManager) state(jobID string) (jobLifecycleState, bool) {
	j, ok := m.lookup(jobID)
	if !ok {
		return "", false
	}
	j.eventMu.Lock()
	defer j.eventMu.Unlock()
	return j.state, true
}

func (m *jobManager) running(concurrencyKey string) int {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.runningByConcurrencyKey[concurrencyKey]
}
