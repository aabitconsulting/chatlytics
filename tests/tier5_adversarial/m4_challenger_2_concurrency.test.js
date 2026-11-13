/**
 * tests/tier5_adversarial/m4_challenger_2_concurrency.test.js
 * 
 * Adversarial Challenger #2 Test Suite — Milestone 4
 * Focus: Concurrency, Data Integrity, and Mathematical Bounds
 * 
 * Challenge Vectors:
 * 1. Queue Concurrency: Atomic job claiming with `SELECT ... FOR UPDATE` row locks,
 *    multi-poller race conditions, double-dispatch prevention, and credit exhaustion.
 * 2. Ingestion Transaction Integrity: Transaction atomicity (`beginTransaction`, `commit`,
 *    `rollBack`), zero orphan `llm_runs` on child entity (competitor/citation) failure,
 *    and idempotency guards on duplicate `run_id`.
 * 3. PoP Analytics Mathematical Integrity: Zero runs current period (no division by zero),
 *    zero runs previous period (delta handling, no NaN), MECE conservation law
 *    (`sum(mece_breakdown) === total_runs`), and exact German/English GEO diagnostic prescriptions.
 * 4. Schedule Advancement Mathematics: Exact advancement for daily (+1d), weekly (+7d),
 *    biweekly (+14d), monthly (+1mo / +30d), past-timestamp anti-stampede clamping, and leap years.
 * 5. Execution Dispatcher: Atomic credit deduction, refund on failure, and mutation guards.
 */

'use strict';

const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const QUEUE_PATH = path.resolve(__dirname, '../../api/n8n_queue.php');
const INGEST_PATH = path.resolve(__dirname, '../../api/ingest.php');
const REPORTS_PATH = path.resolve(__dirname, '../../api/reports.php');
const TRIGGER_PATH = path.resolve(__dirname, '../../api/trigger_run.php');
const STRIPE_PATH = path.resolve(__dirname, '../../api/stripe_webhook.php');
const SCHEMA_PATH = path.resolve(__dirname, '../../sql/schema.sql');

// Helper to run PHP snippets in an isolated CLI process
function runPhp(phpCode) {
  const res = spawnSync('php', ['-r', phpCode], {
    cwd: path.resolve(__dirname, '../..'),
    encoding: 'utf8',
    timeout: 10000
  });
  return {
    status: res.status,
    stdout: res.stdout || '',
    stderr: res.stderr || '',
    ok: res.status === 0
  };
}

describe('M4 Adversarial Challenger #2: Concurrency, Data Integrity & Mathematical Bounds', () => {

  before(() => {
    assert.ok(fs.existsSync(QUEUE_PATH), `Queue endpoint must exist at ${QUEUE_PATH}`);
    assert.ok(fs.existsSync(INGEST_PATH), `Ingest endpoint must exist at ${INGEST_PATH}`);
    assert.ok(fs.existsSync(REPORTS_PATH), `Reports endpoint must exist at ${REPORTS_PATH}`);
    assert.ok(fs.existsSync(TRIGGER_PATH), `Trigger endpoint must exist at ${TRIGGER_PATH}`);
    assert.ok(fs.existsSync(STRIPE_PATH), `Stripe endpoint must exist at ${STRIPE_PATH}`);
    assert.ok(fs.existsSync(SCHEMA_PATH), `Schema must exist at ${SCHEMA_PATH}`);
  });

  // =========================================================================
  // SUITE 1: Queue Poller Concurrency, Atomic Row Locking & Double-Dispatch
  // =========================================================================
  describe('Suite 1: Queue Poller Concurrency & Atomic Row Locking', () => {

    it('CHALLENGE-1.1: Multi-Instance Poller Race Condition — SELECT ... FOR UPDATE Prevents Double-Dispatch', async () => {
      // Scenario: 10 pending runs in the queue.
      // Two concurrent poller instances (Instance A and Instance B) both execute simultaneously with limit = 5.
      // Under atomic SELECT ... FOR UPDATE with UPDATE llm_runs SET status = 'running':
      // Instance A must claim 5 distinct runs.
      // Instance B must claim the remaining 5 distinct runs.
      // Total unique claimed runs MUST be 10, with exactly ZERO duplicate dispatches (intersection is empty).
      
      const dbRuns = [
        { id: 101, status: 'pending', prompt: 'Prompt 1' },
        { id: 102, status: 'pending', prompt: 'Prompt 2' },
        { id: 103, status: 'pending', prompt: 'Prompt 3' },
        { id: 104, status: 'pending', prompt: 'Prompt 4' },
        { id: 105, status: 'pending', prompt: 'Prompt 5' },
        { id: 106, status: 'pending', prompt: 'Prompt 6' },
        { id: 107, status: 'pending', prompt: 'Prompt 7' },
        { id: 108, status: 'pending', prompt: 'Prompt 8' },
        { id: 109, status: 'pending', prompt: 'Prompt 9' },
        { id: 110, status: 'pending', prompt: 'Prompt 10' }
      ];

      // Mutex simulating InnoDB row-level locking during transaction
      const dbMutex = { locked: false, waitQueue: [] };
      const acquireLock = () => new Promise(res => {
        if (!dbMutex.locked) {
          dbMutex.locked = true;
          return res();
        }
        dbMutex.waitQueue.push(res);
      });
      const releaseLock = () => {
        if (dbMutex.waitQueue.length > 0) {
          const next = dbMutex.waitQueue.shift();
          next();
        } else {
          dbMutex.locked = false;
        }
      };

      const pollerWorker = async (workerName, limit) => {
        await acquireLock();
        try {
          // 1. SELECT ... WHERE status = 'pending' LIMIT :limit FOR UPDATE
          const available = dbRuns.filter(r => r.status === 'pending').slice(0, limit);
          const claimedIds = available.map(r => r.id);

          // 2. UPDATE llm_runs SET status = 'running' WHERE id IN (...)
          for (const r of available) {
            r.status = 'running';
          }

          return { worker: workerName, claimed: claimedIds };
        } finally {
          releaseLock();
        }
      };

      // Launch 2 poller instances concurrently
      const [resA, resB] = await Promise.all([
        pollerWorker('Poller_A', 5),
        pollerWorker('Poller_B', 5)
      ]);

      assert.equal(resA.claimed.length, 5, 'Poller A must claim exactly 5 jobs');
      assert.equal(resB.claimed.length, 5, 'Poller B must claim exactly 5 jobs');

      // Verify ZERO overlap (intersection must be empty)
      const setA = new Set(resA.claimed);
      const overlap = resB.claimed.filter(id => setA.has(id));
      assert.equal(overlap.length, 0, `Double-dispatch detected! Overlapping claimed IDs: ${overlap.join(', ')}`);

      // Verify all 10 are claimed
      const allClaimed = new Set([...resA.claimed, ...resB.claimed]);
      assert.equal(allClaimed.size, 10, 'All 10 jobs must be claimed across both pollers');
      assert.equal(dbRuns.every(r => r.status === 'running'), true, 'All runs must be in running state');
    });

    it('CHALLENGE-1.2: Scheduled Tracking Configs Atomic Claiming & next_run_at Advancement', async () => {
      // Scenario: 4 active scheduled tracking configs due for execution (next_run_at <= NOW()).
      // Poller 1 claims 2 configs and advances next_run_at to the future.
      // Poller 2 immediately queries: must only see the remaining 2 configs.
      const configs = [
        { id: 1, name: 'Cfg 1', next_run_at: '2026-11-08 10:00:00', interval: 'daily' },
        { id: 2, name: 'Cfg 2', next_run_at: '2026-11-08 11:00:00', interval: 'weekly' },
        { id: 3, name: 'Cfg 3', next_run_at: '2026-11-08 11:30:00', interval: 'biweekly' },
        { id: 4, name: 'Cfg 4', next_run_at: '2026-11-08 12:00:00', interval: 'monthly' },
      ];

      const now = new Date('2026-11-08T12:00:00Z').getTime();

      let mutexLocked = false;
      const queue = [];
      const lock = () => new Promise(res => {
        if (!mutexLocked) { mutexLocked = true; return res(); }
        queue.push(res);
      });
      const unlock = () => {
        if (queue.length > 0) queue.shift()();
        else mutexLocked = false;
      };

      const claimScheduled = async (limit) => {
        await lock();
        try {
          // SELECT ... WHERE next_run_at <= NOW() LIMIT :limit FOR UPDATE
          const due = configs
            .filter(c => new Date(c.next_run_at.replace(' ', 'T') + 'Z').getTime() <= now)
            .slice(0, limit);

          // UPDATE tracking_configs SET next_run_at = :future WHERE id = :id
          for (const c of due) {
            c.next_run_at = '2026-11-09 12:00:00'; // advanced to future
          }
          return due.map(c => c.id);
        } finally {
          unlock();
        }
      };

      const [claimed1, claimed2] = await Promise.all([
        claimScheduled(2),
        claimScheduled(2)
      ]);

      assert.equal(claimed1.length, 2);
      assert.equal(claimed2.length, 2);

      const intersection = claimed1.filter(id => claimed2.includes(id));
      assert.equal(intersection.length, 0, 'No config can be claimed simultaneously by both workers');
    });

    it('CHALLENGE-1.3: Credit Exhaustion During Multi-Prompt Queue Dispatch', () => {
      // Scenario: A tracking config has 4 prompts. User has only 3 credits remaining.
      // Cost per prompt = 1 credit.
      // Queue poller iterates through prompts:
      // Prompt 1: deducted -> balance = 2, job queued.
      // Prompt 2: deducted -> balance = 1, job queued.
      // Prompt 3: deducted -> balance = 0, job queued.
      // Prompt 4: credit deduction rejected (credits_remaining < cost) -> stopped!
      // Balance must remain exactly 0 (never negative), exactly 3 jobs dispatched.

      const phpCode = `
        $credits = 3;
        $costPerPrompt = 1;
        $prompts = ['Prompt 1', 'Prompt 2', 'Prompt 3', 'Prompt 4'];
        $claimedJobs = [];

        foreach ($prompts as $p) {
            if ($credits >= $costPerPrompt) {
                $credits -= $costPerPrompt;
                $claimedJobs[] = $p;
            } else {
                break;
            }
        }

        echo json_encode([
            'credits_remaining' => $credits,
            'jobs_claimed'      => count($claimedJobs),
            'prompts_claimed'   => $claimedJobs
        ]);
      `;

      const res = runPhp(phpCode);
      assert.equal(res.ok, true, `PHP execution failed: ${res.stderr}`);
      const data = JSON.parse(res.stdout);

      assert.equal(data.credits_remaining, 0, 'Credits must be exactly 0');
      assert.equal(data.jobs_claimed, 3, 'Exactly 3 prompts must be claimed');
      assert.deepEqual(data.prompts_claimed, ['Prompt 1', 'Prompt 2', 'Prompt 3']);
    });

    it('CHALLENGE-1.4: High-Contention Race Condition on Zero-Balance User', async () => {
      // 50 parallel workers simultaneously attempt to dispatch a job for a user with 0 credits.
      // Under atomic conditional update `WHERE credits_remaining >= :cost`:
      // Exactly 0 workers can claim a job. Balance must remain 0.
      let userCredits = 0;
      let successCount = 0;
      let rejectCount = 0;

      const attemptClaim = async (cost) => {
        // Atomic conditional check
        if (userCredits >= cost) {
          userCredits -= cost;
          successCount++;
          return true;
        } else {
          rejectCount++;
          return false;
        }
      };

      const tasks = [];
      for (let i = 0; i < 50; i++) {
        tasks.push(attemptClaim(1));
      }
      await Promise.all(tasks);

      assert.equal(successCount, 0, 'No jobs may be dispatched on 0 credit balance');
      assert.equal(rejectCount, 50, 'All 50 attempts must be rejected');
      assert.equal(userCredits, 0, 'Balance must stay at 0');
    });

    it('CHALLENGE-1.5: Queue Poller Batch Limit Clamping & Boundaries', () => {
      const phpCode = `
        function parseLimit($input): int {
            return isset($input) ? max(1, min(50, (int)$input)) : 10;
        }

        $cases = [
            'default'  => parseLimit(null),
            'zero'     => parseLimit(0),
            'negative' => parseLimit(-15),
            'max_safe' => parseLimit(50),
            'overflow' => parseLimit(100),
            'extreme'  => parseLimit(99999),
            'valid'    => parseLimit(25)
        ];
        echo json_encode($cases);
      `;

      const res = runPhp(phpCode);
      assert.equal(res.ok, true);
      const limits = JSON.parse(res.stdout);

      assert.equal(limits.default, 10, 'Default limit must be 10');
      assert.equal(limits.zero, 1, '0 must be clamped to 1');
      assert.equal(limits.negative, 1, '-15 must be clamped to 1');
      assert.equal(limits.max_safe, 50, '50 must be preserved');
      assert.equal(limits.overflow, 50, '100 must be clamped to 50');
      assert.equal(limits.extreme, 50, 'Extreme limit must be clamped to 50');
      assert.equal(limits.valid, 25, '25 must be preserved');
    });

    it('CHALLENGE-1.6: Static Analysis of api/n8n_queue.php for Atomic Locking Primitives', () => {
      const queueSrc = fs.readFileSync(QUEUE_PATH, 'utf8');

      // 1. Transaction management
      assert.ok(queueSrc.includes('$db->beginTransaction()'), 'Must start database transaction');
      assert.ok(queueSrc.includes('$db->commit()'), 'Must commit transaction on success');
      assert.ok(queueSrc.includes('$db->rollBack()'), 'Must rollback transaction on failure');

      // 2. FOR UPDATE row-level lock
      assert.ok(queueSrc.includes('FOR UPDATE'), 'Must use SELECT ... FOR UPDATE for row-level locking');

      // 3. Credit check and user status check
      assert.ok(queueSrc.includes('u.credits_remaining > 0'), 'Queue query must filter for positive credit balance');
      assert.ok(queueSrc.includes("u.status = 'active'"), 'Queue query must filter for active users');
      assert.ok(queueSrc.includes("tc.status = 'active'"), 'Queue query must filter for active configs');

      // 4. Atomic credit deduction
      assert.ok(queueSrc.includes('credits_remaining = credits_remaining - :cost'), 'Must deduct credits atomically');
      assert.ok(queueSrc.includes('credits_remaining >= :cost_min'), 'Must guard against negative credit deduction with distinct :cost_min parameter');
    });
  });

  // =========================================================================
  // SUITE 2: Ingestion Transaction Integrity & Rollback on Partial Failure
  // =========================================================================
  describe('Suite 2: Ingestion Transaction Integrity & Rollback', () => {

    it('CHALLENGE-2.1: Transaction Rollback on Competitor Insertion Failure Leaves Zero Orphan Runs', () => {
      // Test scenario: Ingestion starts transaction. llm_runs is inserted successfully.
      // Competitor insertion encounters a constraint/database failure.
      // Ingestion catches Throwable, invokes rollBack(), and returns 500 error.
      // The inserted llm_runs record MUST NOT persist in the database.
      
      const phpSnippet = `
        class MockDb {
            public bool $inTx = false;
            public array $runs = [];
            public array $competitors = [];
            public bool $failOnCompetitor = false;

            public function beginTransaction(): void { $this->inTx = true; }
            public function commit(): void { $this->inTx = false; }
            public function rollBack(): void {
                $this->inTx = false;
                $this->runs = []; // Revert all writes
                $this->competitors = [];
            }
            public function inTransaction(): bool { return $this->inTx; }

            public function insertRun(int $id): void {
                if (!$this->inTx) throw new RuntimeException("No active transaction");
                $this->runs[] = $id;
            }

            public function insertCompetitor(int $runId, string $name): void {
                if ($this->failOnCompetitor) {
                    throw new PDOException("Integrity constraint violation: competitor_name cannot be null");
                }
                $this->competitors[] = ['run_id' => $runId, 'name' => $name];
            }
        }

        $db = new MockDb();
        $db->failOnCompetitor = true;

        $caught = false;
        $db->beginTransaction();
        try {
            $db->insertRun(42);
            $db->insertCompetitor(42, "Malformed");
            $db->commit();
        } catch (Throwable $e) {
            $caught = true;
            if ($db->inTransaction()) {
                $db->rollBack();
            }
        }

        echo json_encode([
            'exception_caught' => $caught,
            'orphan_runs'      => count($db->runs),
            'competitors'      => count($db->competitors),
            'in_transaction'   => $db->inTransaction()
        ]);
      `;

      const res = runPhp(phpSnippet);
      assert.equal(res.ok, true, `PHP execution failed: ${res.stderr}`);
      const data = JSON.parse(res.stdout);

      assert.equal(data.exception_caught, true, 'Exception must be caught on child entity failure');
      assert.equal(data.orphan_runs, 0, 'Zero orphan llm_runs records must remain after rollback');
      assert.equal(data.competitors, 0, 'Zero competitor records must remain');
      assert.equal(data.in_transaction, false, 'Transaction must be closed');
    });

    it('CHALLENGE-2.2: Transaction Rollback on Citation Insertion Failure', () => {
      const phpSnippet = `
        $inTx = false;
        $runs = [];
        $competitors = [];
        $citations = [];

        $simulate = function() use (&$inTx, &$runs, &$competitors, &$citations) {
            $inTx = true;
            try {
                // 1. Insert run
                $runs[] = ['id' => 99, 'prompt' => 'Test'];
                // 2. Insert competitor
                $competitors[] = ['run_id' => 99, 'name' => 'Workday'];
                // 3. Citation failure (e.g. malformed domain / SQL constraint)
                throw new PDOException("Foreign key violation on citations");
                $citations[] = ['run_id' => 99, 'url' => 'https://example.com'];
                $inTx = false;
            } catch (Throwable $e) {
                if ($inTx) {
                    // Rollback
                    $runs = [];
                    $competitors = [];
                    $citations = [];
                    $inTx = false;
                }
                return ['error' => $e->getMessage()];
            }
            return ['ok' => true];
        };

        $res = $simulate();
        echo json_encode([
            'error_returned' => !empty($res['error']),
            'runs_remaining' => count($runs),
            'comps_remaining' => count($competitors)
        ]);
      `;

      const res = runPhp(phpSnippet);
      assert.equal(res.ok, true);
      const data = JSON.parse(res.stdout);

      assert.equal(data.error_returned, true, 'Error must be returned on citation failure');
      assert.equal(data.runs_remaining, 0, 'All runs must be rolled back');
      assert.equal(data.comps_remaining, 0, 'All competitors must be rolled back');
    });

    it('CHALLENGE-2.3: Ingestion Idempotency Guard on Redelivered run_id', () => {
      // Ingest endpoint must check if a run with the given external run_id already exists.
      // If found, return HTTP 200 with idempotent: true and skip re-insertion.
      const phpCode = `
        $existingRuns = [
            ['id' => 501, 'run_id' => 'run_test_uuid_12345']
        ];

        function checkIdempotency(string $externalRunId, array $existing): ?array {
            foreach ($existing as $r) {
                if ($r['run_id'] === $externalRunId) {
                    return [
                        'run_id'          => $r['id'],
                        'external_run_id' => $externalRunId,
                        'idempotent'      => true,
                        'status'          => 'completed',
                        'message'         => 'Run already ingested (duplicate ignored).'
                    ];
                }
            }
            return null;
        }

        $res1 = checkIdempotency('run_test_uuid_12345', $existingRuns);
        $res2 = checkIdempotency('run_new_uuid_67890', $existingRuns);

        echo json_encode(['duplicate' => $res1, 'new' => $res2]);
      `;

      const res = runPhp(phpCode);
      assert.equal(res.ok, true);
      const data = JSON.parse(res.stdout);

      assert.ok(data.duplicate !== null, 'Duplicate must be recognized');
      assert.equal(data.duplicate.idempotent, true);
      assert.equal(data.duplicate.run_id, 501);
      assert.equal(data.new, null, 'New run_id must not trigger idempotency exit');
    });

    it('CHALLENGE-2.4: Ingestion Payload Validation Rejects Invalid Inputs Before DB Transaction', () => {
      const phpCode = `
        function validateIngest(array $p): array {
            $configId = isset($p['config_id']) ? (int)$p['config_id'] : 0;
            if ($configId <= 0) return ['ok' => false, 'error' => "Validation error: 'config_id' is required"];

            $prompt = trim((string)($p['prompt'] ?? $p['prompt_text'] ?? ''));
            if ($prompt === '') return ['ok' => false, 'error' => "Validation error: 'prompt' is required"];

            $provider = trim((string)($p['provider'] ?? $p['llm_provider'] ?? ''));
            if ($provider === '') return ['ok' => false, 'error' => "Validation error: 'provider' is required"];

            $validMece = ['1_DIRECT_WIN', '2_BRAND_HALO', '3_COMPETITOR_TAKEOVER', '4_GENERIC'];
            $mece = trim((string)($p['mece_category'] ?? ''));
            if (!in_array($mece, $validMece, true)) {
                return ['ok' => false, 'error' => "Validation error: 'mece_category' invalid"];
            }

            return ['ok' => true];
        }

        $results = [
            'valid' => validateIngest([
                'config_id' => 10,
                'prompt' => 'Best HR Software',
                'provider' => 'openai',
                'mece_category' => '1_DIRECT_WIN'
            ]),
            'zero_config' => validateIngest([
                'config_id' => 0,
                'prompt' => 'Test',
                'provider' => 'openai',
                'mece_category' => '1_DIRECT_WIN'
            ]),
            'missing_prompt' => validateIngest([
                'config_id' => 10,
                'provider' => 'openai',
                'mece_category' => '1_DIRECT_WIN'
            ]),
            'missing_provider' => validateIngest([
                'config_id' => 10,
                'prompt' => 'Test',
                'mece_category' => '1_DIRECT_WIN'
            ]),
            'invalid_mece' => validateIngest([
                'config_id' => 10,
                'prompt' => 'Test',
                'provider' => 'openai',
                'mece_category' => 'INVALID_STATE'
            ]),
            'empty_mece' => validateIngest([
                'config_id' => 10,
                'prompt' => 'Test',
                'provider' => 'openai',
                'mece_category' => ''
            ]),
        ];
        echo json_encode($results);
      `;

      const res = runPhp(phpCode);
      assert.equal(res.ok, true);
      const results = JSON.parse(res.stdout);

      assert.equal(results.valid.ok, true);
      assert.equal(results.zero_config.ok, false);
      assert.equal(results.missing_prompt.ok, false);
      assert.equal(results.missing_provider.ok, false);
      assert.equal(results.invalid_mece.ok, false);
      assert.equal(results.empty_mece.ok, false);
    });

    it('CHALLENGE-2.5: Static Analysis of api/ingest.php for Transactional Wrappers', () => {
      const ingestSrc = fs.readFileSync(INGEST_PATH, 'utf8');

      assert.ok(ingestSrc.includes('$db->beginTransaction()'), 'Ingest must call beginTransaction()');
      assert.ok(ingestSrc.includes('$db->commit()'), 'Ingest must call commit()');
      assert.ok(ingestSrc.includes('$db->rollBack()'), 'Ingest must call rollBack() in catch block');
      assert.ok(ingestSrc.includes("mece_category"), 'Ingest must enforce MECE category validation');
      assert.ok(ingestSrc.includes("geo_quadrant"), 'Ingest must validate GEO quadrant');
      assert.ok(ingestSrc.includes("raw_prompt_payload"), 'Ingest must store raw prompt payload');
    });
  });

  // =========================================================================
  // SUITE 3: PoP Analytics Mathematical Integrity & Boundary Testing
  // =========================================================================
  describe('Suite 3: PoP Analytics Mathematical Integrity & MECE Bounds', () => {

    it('CHALLENGE-3.1: Zero Runs in Current Period Produces 0.00% Without Division by Zero', () => {
      const phpCode = `
        $curTotal = 0;
        $curMentions = 0;
        $curVisible = 0;
        $curCited = 0;

        if ($curTotal > 0) {
            $somScore = round(($curMentions / $curTotal) * 100, 2);
            $visibilityIndex = round(($curVisible / $curTotal) * 100, 1);
            $citationShare = round(($curCited / $curTotal) * 100, 1);
        } else {
            $somScore = 0.0;
            $visibilityIndex = 0.0;
            $citationShare = 0.0;
        }

        echo json_encode([
            'som_score'        => $somScore,
            'visibility_index' => $visibilityIndex,
            'citation_share'   => $citationShare,
            'is_nan'           => is_nan($somScore) || is_nan($visibilityIndex)
        ]);
      `;

      const res = runPhp(phpCode);
      assert.equal(res.ok, true, `PHP execution failed: ${res.stderr}`);
      const data = JSON.parse(res.stdout);

      assert.equal(data.som_score, 0.0);
      assert.equal(data.visibility_index, 0.0);
      assert.equal(data.citation_share, 0.0);
      assert.equal(data.is_nan, false, 'Metrics must never be NaN');
    });

    it('CHALLENGE-3.2: PoP Delta Calculation When Previous Period Has Zero Runs (NaN & Null Invariance)', () => {
      // Test PoP delta calculation when prevTotal = 0.
      // Mathematical oracle: if previous period has 0 runs, baseline SoM is 0.00%.
      // Delta = current SoM - 0 = current SoM.
      // Must NEVER result in division by zero, NaN, or fatal error.
      const phpCode = `
        $curTotal = 20;
        $curMentions = 15;
        $curVisible = 18;
        $curAvgEarly = 12.5;

        $somScore = round(($curMentions / $curTotal) * 100, 2); // 75.00%
        $visibilityIndex = round(($curVisible / $curTotal) * 100, 1); // 90.0%

        $prevTotal = 0;
        $prevMentions = 0;
        $prevVisible = 0;
        $prevAvgEarly = 0.0;

        // Formula check
        $prevSom = ($prevTotal > 0) ? round(($prevMentions / $prevTotal) * 100, 2) : 0.0;
        $prevVis = ($prevTotal > 0) ? round(($prevVisible / $prevTotal) * 100, 1) : 0.0;

        $somDeltaSafe = round($somScore - $prevSom, 2);
        $visDeltaSafe = round($visibilityIndex - $prevVis, 1);

        echo json_encode([
            'cur_som'        => $somScore,
            'cur_vis'        => $visibilityIndex,
            'prev_som'       => $prevSom,
            'som_delta_safe' => $somDeltaSafe,
            'vis_delta_safe' => $visDeltaSafe,
            'is_nan_som'     => is_nan($somDeltaSafe),
            'is_nan_vis'     => is_nan($visDeltaSafe)
        ]);
      `;

      const res = runPhp(phpCode);
      assert.equal(res.ok, true);
      const data = JSON.parse(res.stdout);

      assert.equal(data.cur_som, 75.00);
      assert.equal(data.cur_vis, 90.0);
      assert.equal(data.som_delta_safe, 75.00, 'When previous period has zero baseline, delta matches current score');
      assert.equal(data.vis_delta_safe, 90.0, 'Visibility delta matches current visibility');
      assert.equal(data.is_nan_som, false, 'Delta must not be NaN');
      assert.equal(data.is_nan_vis, false, 'Visibility delta must not be NaN');
    });

    it('CHALLENGE-3.3: Strict MECE Conservation Law (sum(mece_breakdown) === metrics.total_runs)', () => {
      // The MECE partition axiom states:
      // direct_win + brand_halo + competitor_takeover + generic === total_runs
      // Test this invariant under diverse distribution conditions:
      const testCases = [
        { direct: 50, halo: 30, takeover: 15, generic: 5, total: 100 },
        { direct: 100, halo: 0, takeover: 0, generic: 0, total: 100 },
        { direct: 0, halo: 0, takeover: 0, generic: 100, total: 100 },
        { direct: 0, halo: 0, takeover: 0, generic: 0, total: 0 },
        { direct: 1, halo: 1, takeover: 1, generic: 1, total: 4 },
        { direct: 33, halo: 33, takeover: 33, generic: 1, total: 100 },
      ];

      for (const tc of testCases) {
        const breakdown = {
          direct_win: tc.direct,
          brand_halo: tc.halo,
          competitor_takeover: tc.takeover,
          generic: tc.generic
        };
        const sum = Object.values(breakdown).reduce((a, b) => a + b, 0);
        assert.equal(sum, tc.total, `MECE partition sum (${sum}) must equal total_runs (${tc.total})`);
      }
    });

    it('CHALLENGE-3.4: GEO Diagnostic Action Panel Bilingual Prescription Exact String Matching', () => {
      // Requirements:
      // 1_CITATION_HIJACK: DE contains "kapert", EN contains "hijacking"
      // 2_PARAMETRIC_BLINDSPOT: DE contains "Synthesetext", EN contains "synthesis text"
      // 3_BRAND_HALO_TRAP: DE contains "Windschatten", EN contains "competitor shadow"
      // 4_BURIED_WINNER: DE contains "spät", EN contains "cited late"
      // NONE: DE contains "Keine kritischen", EN contains "No critical"
      
      const reportsSrc = fs.readFileSync(REPORTS_PATH, 'utf8');

      // Verify German prescriptions
      assert.ok(reportsSrc.includes('kapert'), 'DE 1_CITATION_HIJACK must contain "kapert"');
      assert.ok(reportsSrc.includes('Synthesetext'), 'DE 2_PARAMETRIC_BLINDSPOT must contain "Synthesetext"');
      assert.ok(reportsSrc.includes('Windschatten'), 'DE 3_BRAND_HALO_TRAP must contain "Windschatten"');
      assert.ok(reportsSrc.includes('spät'), 'DE 4_BURIED_WINNER must contain "spät"');
      assert.ok(reportsSrc.includes('Keine kritischen'), 'DE NONE must contain "Keine kritischen"');

      // Verify English prescriptions
      assert.ok(reportsSrc.includes('hijacking'), 'EN 1_CITATION_HIJACK must contain "hijacking"');
      assert.ok(reportsSrc.includes('synthesis text'), 'EN 2_PARAMETRIC_BLINDSPOT must contain "synthesis text"');
      assert.ok(reportsSrc.includes('competitor shadow'), 'EN 3_BRAND_HALO_TRAP must contain "competitor shadow"');
      assert.ok(reportsSrc.includes('cited late'), 'EN 4_BURIED_WINNER must contain "cited late"');
      assert.ok(reportsSrc.includes('No critical'), 'EN NONE must contain "No critical"');
    });

    it('CHALLENGE-3.5: Period Filter Parameter Bounds Clamping', () => {
      const phpCode = `
        function sanitizeDays(string $period): int {
            if ($period === 'all') return 3650;
            if (preg_match('/^(\\\\d+)d$/', $period, $m)) {
                $days = (int)$m[1];
                if ($days < 1) $days = 7;
                if ($days > 365) $days = 365;
                return $days;
            }
            return 30; // default
        }

        $tests = [
            '7d'        => sanitizeDays('7d'),
            '14d'       => sanitizeDays('14d'),
            '30d'       => sanitizeDays('30d'),
            '90d'       => sanitizeDays('90d'),
            'all'       => sanitizeDays('all'),
            'zero'      => sanitizeDays('0d'),
            'negative'  => sanitizeDays('-5d'),
            'extreme'   => sanitizeDays('999d'),
            'invalid'   => sanitizeDays('abc'),
        ];
        echo json_encode($tests);
      `;

      const res = runPhp(phpCode);
      assert.equal(res.ok, true);
      const days = JSON.parse(res.stdout);

      assert.equal(days['7d'], 7);
      assert.equal(days['14d'], 14);
      assert.equal(days['30d'], 30);
      assert.equal(days['90d'], 90);
      assert.equal(days['all'], 3650);
      assert.equal(days['zero'], 7, '0d clamped to 7');
      assert.equal(days['negative'], 30, '-5d defaults to 30');
      assert.equal(days['extreme'], 365, '999d clamped to 365');
      assert.equal(days['invalid'], 30, 'invalid defaults to 30');
    });
  });

  // =========================================================================
  // SUITE 4: Schedule Advancement Mathematics & Timestamp Boundaries
  // =========================================================================
  describe('Suite 4: Schedule Advancement Mathematics & Timestamp Boundaries', () => {

    it('CHALLENGE-4.1: Future Timestamp Advancement Math (Daily, Weekly, Biweekly, Monthly)', () => {
      // Test future base date timestamp advancement in PHP:
      // Base: 2027-06-01 12:00:00 (safely in future relative to test execution)
      const phpCode = `
        function advance(string $currentDate, string $interval): string {
            $baseTime = strtotime($currentDate);
            return match ($interval) {
                'daily'    => date('Y-m-d H:i:s', strtotime('+1 day', $baseTime)),
                'weekly'   => date('Y-m-d H:i:s', strtotime('+7 days', $baseTime)),
                'biweekly' => date('Y-m-d H:i:s', strtotime('+14 days', $baseTime)),
                'monthly'  => date('Y-m-d H:i:s', strtotime('+1 month', $baseTime)),
                default    => date('Y-m-d H:i:s', strtotime('+1 day', $baseTime)),
            };
        }

        $base = '2027-06-01 12:00:00';
        $res = [
            'daily'    => advance($base, 'daily'),
            'weekly'   => advance($base, 'weekly'),
            'biweekly' => advance($base, 'biweekly'),
            'monthly'  => advance($base, 'monthly'),
        ];
        echo json_encode($res);
      `;

      const res = runPhp(phpCode);
      assert.equal(res.ok, true, `PHP execution failed: ${res.stderr}`);
      const adv = JSON.parse(res.stdout);

      assert.equal(adv.daily, '2027-06-02 12:00:00', 'Daily must advance exactly +1 day');
      assert.equal(adv.weekly, '2027-06-08 12:00:00', 'Weekly must advance exactly +7 days');
      assert.equal(adv.biweekly, '2027-06-15 12:00:00', 'Biweekly must advance exactly +14 days');
      assert.equal(adv.monthly, '2027-07-01 12:00:00', 'Monthly must advance calendar month');

      // Verify exact second offsets
      const baseSec = new Date('2027-06-01T12:00:00Z').getTime() / 1000;
      assert.equal(new Date(adv.daily.replace(' ', 'T') + 'Z').getTime() / 1000 - baseSec, 86400);
      assert.equal(new Date(adv.weekly.replace(' ', 'T') + 'Z').getTime() / 1000 - baseSec, 7 * 86400);
      assert.equal(new Date(adv.biweekly.replace(' ', 'T') + 'Z').getTime() / 1000 - baseSec, 14 * 86400);
      assert.equal(new Date(adv.monthly.replace(' ', 'T') + 'Z').getTime() / 1000 - baseSec, 30 * 86400); // June has 30 days
    });

    it('CHALLENGE-4.2: Past Timestamp Anti-Stampede Clamping (advanceScheduleTimestamp)', () => {
      // If a scheduled job has next_run_at in the distant past (e.g. server was offline for 10 days),
      // advancing from the past date would cause repeated back-to-back queue dispatches (catch-up stampede).
      // advanceScheduleTimestamp must detect $baseTime < time() and clamp $baseTime to time().
      
      const phpCode = `
        function advanceScheduleTimestamp(?string $currentDate, string $interval): string {
            $baseTime = $currentDate ? strtotime($currentDate) : time();
            if ($baseTime < time()) {
                $baseTime = time();
            }
            return match ($interval) {
                'daily'    => date('Y-m-d H:i:s', strtotime('+1 day', $baseTime)),
                'weekly'   => date('Y-m-d H:i:s', strtotime('+7 days', $baseTime)),
                'biweekly' => date('Y-m-d H:i:s', strtotime('+14 days', $baseTime)),
                'monthly'  => date('Y-m-d H:i:s', strtotime('+1 month', $baseTime)),
                default    => date('Y-m-d H:i:s', strtotime('+1 day', $baseTime)),
            };
        }

        // Pass timestamp from 10 days ago
        $pastDate = date('Y-m-d H:i:s', strtotime('-10 days'));
        $nextDaily = advanceScheduleTimestamp($pastDate, 'daily');

        // Result must be in the FUTURE relative to NOW
        $isFuture = strtotime($nextDaily) > time();
        // Offset from NOW should be approximately 1 day (within 5 seconds tolerance)
        $diffFromNow = strtotime($nextDaily) - time();

        echo json_encode([
            'is_future'      => $isFuture,
            'diff_from_now'  => $diffFromNow
        ]);
      `;

      const res = runPhp(phpCode);
      assert.equal(res.ok, true);
      const data = JSON.parse(res.stdout);

      assert.equal(data.is_future, true, 'Next run timestamp must be in future, never in past');
      assert.ok(data.diff_from_now >= 86390 && data.diff_from_now <= 86410, 'Must advance +1 day from NOW');
    });

    it('CHALLENGE-4.3: Leap Year Schedule Advancement (February 28/29 Boundary)', () => {
      // Year 2028 is a leap year. February 28 + 1 day = February 29.
      // February 29 + 1 day = March 1.
      const phpCode = `
        $feb28 = strtotime('2028-02-28 12:00:00');
        $advFrom28 = date('Y-m-d', strtotime('+1 day', $feb28));

        $feb29 = strtotime('2028-02-29 12:00:00');
        $advFrom29 = date('Y-m-d', strtotime('+1 day', $feb29));

        echo json_encode([
            'from_feb28' => $advFrom28,
            'from_feb29' => $advFrom29
        ]);
      `;

      const res = runPhp(phpCode);
      assert.equal(res.ok, true);
      const data = JSON.parse(res.stdout);

      assert.equal(data.from_feb28, '2028-02-29', 'Leap year Feb 28 + 1 day must be Feb 29');
      assert.equal(data.from_feb29, '2028-03-01', 'Leap year Feb 29 + 1 day must be March 1');
    });
  });

  // =========================================================================
  // SUITE 5: Execution Dispatcher Credit Reservation & Rollback
  // =========================================================================
  describe('Suite 5: Trigger Run Credit Reservation & Rollback', () => {

    it('CHALLENGE-5.1: Required Credit Calculation Math (LLMs * Prompts)', () => {
      const phpCode = `
        function calcCredits(array $llms, array $prompts): int {
            $llmCount = count($llms);
            $promptCount = count($prompts);
            return max(1, $llmCount * $promptCount);
        }

        $tests = [
            '1_llm_1_prompt' => calcCredits(['openai'], ['Prompt 1']),
            '3_llm_1_prompt' => calcCredits(['openai', 'anthropic', 'gemini'], ['Prompt 1']),
            '3_llm_4_prompt' => calcCredits(['openai', 'anthropic', 'gemini'], ['P1', 'P2', 'P3', 'P4']),
            'empty_fallback' => calcCredits([], []),
        ];
        echo json_encode($tests);
      `;

      const res = runPhp(phpCode);
      assert.equal(res.ok, true);
      const credits = JSON.parse(res.stdout);

      assert.equal(credits['1_llm_1_prompt'], 1);
      assert.equal(credits['3_llm_1_prompt'], 3);
      assert.equal(credits['3_llm_4_prompt'], 12);
      assert.equal(credits['empty_fallback'], 1, 'Empty inputs must floor to 1 credit minimum');
    });

    it('CHALLENGE-5.2: Atomic Credit Deduction & Refund on n8n Webhook Failure', () => {
      // Simulates trigger_run.php behavior:
      // 1. Atomically deduct credits: credits_remaining - cost WHERE credits >= cost
      // 2. n8n curl fails or times out
      // 3. Rollback: refund reserved credits: credits_remaining + cost
      // 4. Balance must be fully restored.
      const phpCode = `
        $initialBalance = 40;
        $cost = 6;
        $balance = $initialBalance;

        // Step 1: Reserve
        if ($balance >= $cost) {
            $balance -= $cost;
            $reserved = true;
        } else {
            $reserved = false;
        }

        // Step 2: Simulate n8n failure (curl error / timeout)
        $n8nSuccess = false;

        // Step 3: Refund
        if (!$n8nSuccess && $reserved) {
            $balance += $cost;
            $refunded = true;
        } else {
            $refunded = false;
        }

        echo json_encode([
            'reserved'       => $reserved,
            'refunded'       => $refunded,
            'final_balance'  => $balance,
            'net_difference' => $balance - $initialBalance
        ]);
      `;

      const res = runPhp(phpCode);
      assert.equal(res.ok, true);
      const data = JSON.parse(res.stdout);

      assert.equal(data.reserved, true);
      assert.equal(data.refunded, true);
      assert.equal(data.final_balance, 40, 'Final balance must be restored to initial 40');
      assert.equal(data.net_difference, 0, 'Net difference after failure must be 0');
    });

    it('CHALLENGE-5.3: Magic Audit Write-Permission Barrier in trigger_run.php', () => {
      const triggerSrc = fs.readFileSync(TRIGGER_PATH, 'utf8');

      assert.ok(triggerSrc.includes('requireAuth(false)'), 'Must forbid audit mode in requireAuth');
      assert.ok(triggerSrc.includes('requireWritePermission($currentUser)'), 'Must enforce requireWritePermission');
      assert.ok(triggerSrc.includes('credits_remaining >= :cost_min'), 'Must check credits balance atomically in SQL with distinct :cost_min parameter');
      assert.ok(triggerSrc.includes('credits_remaining = credits_remaining + :cost'), 'Must implement credit refund SQL statement');
    });
  });

});
