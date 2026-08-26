[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('direct', 'natural-language')]
    [string]$RequestForm,

    [Parameter(Mandatory = $true)]
    [ValidateNotNullOrEmpty()]
    [string]$RequestMessage,

    [Parameter(Mandatory = $true)]
    [ValidateNotNullOrEmpty()]
    [string]$OutputDirectory,

    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[a-f0-9]{40}$')]
    [string]$ExpectedCandidateCommit,

    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[a-f0-9]{64}$')]
    [string]$ExpectedFixtureHash,

    [Parameter(Mandatory = $true)]
    [ValidatePattern('^-?\d+$')]
    [string]$ExpectedSeed,

    [Parameter(Mandatory = $true)]
    [ValidateSet('off', 'on')]
    [string]$InstrumentationMode,

    [ValidateRange(1000, 3600000)]
    [int]$TimeoutMs = 180000,

    # Certification mode (the default) aborts unless the working tree is clean
    # and every bound file is byte-identical to the registered candidate
    # commit, so a recorded result provably describes that exact code.
    # Regression mode keeps all of those hashes as evidence but does not abort,
    # so the same scenario can gate ordinary day-to-day development. Without
    # it this harness can only ever verify one commit, once.
    [switch]$RegressionMode,

    # Which physical course to lay. 'doorway-corridor' is the registered
    # scenario. 'obstruction-follow' spans the wall across the full course width
    # and plugs the doorway with a breakable block, so following the player
    # REQUIRES breaking it -- the case the registered course does not exercise.
    [ValidateSet('doorway-corridor', 'obstruction-follow', 'player-route-obstruction', 'pathfinding-finite-break-cost', 'player-route-best-reachable', 'deliver-item', 'orchestrate-charcoal', 'route-probe-inconclusive', 'interaction-stance-inconclusive', 'request-completion', 'terrain-swim-exit', 'terrain-workaround-chain')]
    [string]$Course = 'doorway-corridor',

    [string]$FixtureRoot = '',

    [string]$VarianceExecutionMode = '',

    [string]$VarianceCase = '',

    [string]$PreflightMode = ''
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..\..'))
# This repository is commonly checked out as a git worktree whose `.git` file
# points at a gitdir using a WSL-style path (/mnt/c/...). Plain `git -C $repo`
# then fails with "fatal: not a git repository: (NULL)" and every provenance
# probe below throws before any gameplay runs. Resolve the real gitdir once and
# export it so the ordinary git invocations work on this machine.
function Initialize-ScenarioGitEnvironment {
    param([Parameter(Mandatory = $true)][string]$RepoPath)
    $pointer = Join-Path $RepoPath '.git'
    if (-not (Test-Path -LiteralPath $pointer -PathType Leaf)) { return }
    $line = (Get-Content -LiteralPath $pointer -TotalCount 1).Trim()
    if ($line -notmatch '^gitdir:\s*(.+)$') { return }
    $gitDir = $Matches[1].Trim()
    if ($gitDir -match '^/mnt/([a-zA-Z])/(.*)$') {
        $gitDir = ($Matches[1].ToUpperInvariant() + ':/' + $Matches[2])
    }
    if (-not (Test-Path -LiteralPath $gitDir)) { return }
    $env:GIT_DIR = $gitDir
    $env:GIT_WORK_TREE = $RepoPath
}
Initialize-ScenarioGitEnvironment -RepoPath $repo
if ([string]::IsNullOrWhiteSpace($FixtureRoot)) {
    $FixtureRoot = $env:SCENARIO_LAB_FOLLOW_FIXTURE_ROOT
}
if ([string]::IsNullOrWhiteSpace($FixtureRoot)) {
    throw 'FixtureRoot or SCENARIO_LAB_FOLLOW_FIXTURE_ROOT must identify the frozen fixture directory.'
}
if ($Course -eq 'request-completion') {
    if ($RequestForm -ne 'natural-language') {
        throw 'The Phase 5 request-completion course must use controlled player chat.'
    }
    if ($VarianceExecutionMode -notin @('recorded-trace', 'frozen-model')) {
        throw 'VarianceExecutionMode must be recorded-trace or frozen-model.'
    }
    if ($VarianceCase -notmatch '^[a-z0-9][a-z0-9._:-]*$') {
        throw 'VarianceCase must be a lowercase Scenario Lab identifier.'
    }
    if ($PreflightMode -notin @('off', 'on')) {
        throw 'PreflightMode must be off or on.'
    }
} elseif (
    -not [string]::IsNullOrWhiteSpace($VarianceExecutionMode) -or
    -not [string]::IsNullOrWhiteSpace($VarianceCase) -or
    -not [string]::IsNullOrWhiteSpace($PreflightMode)
) {
    throw 'VarianceExecutionMode, VarianceCase, and PreflightMode belong only to request-completion.'
}

$archive = Join-Path $FixtureRoot 'follow-world.zip'
$fixtureProfile = Join-Path $FixtureRoot 'scenario-profile.json'
$fixtureMetadata = Join-Path $FixtureRoot 'fixture-metadata.json'
$managed = Join-Path $repo 'server_data\managed-java'
$configPath = Join-Path $managed 'mindcraft-server.json'
$propertiesPath = Join-Path $managed 'server.properties'
$botDir = Join-Path $repo 'bots\MindcraftBot'
$captureScript = Join-Path $PSScriptRoot 'capture-agent-state.mjs'
$runner = Join-Path $PSScriptRoot 'run-follow-field.mjs'
$evidenceAdapter = Join-Path $PSScriptRoot 'follow-field-evidence.mjs'
$harness = Join-Path $repo 'tools\verify-follow-field.mjs'
$varianceCases = Join-Path $repo 'tools\scenario-lab\variance-cases.mjs'
$varianceCoordinator = Join-Path $repo 'tools\scenario-lab\run-variance-matrix.mjs'
$recordedTraceProvider = Join-Path $PSScriptRoot 'recorded-trace-provider.mjs'
$directiveRouter = Join-Path $repo 'src\agent\player-directives.js'
$skills = Join-Path $repo 'src\agent\library\skills.js'
$behaviorConfig = Join-Path $repo 'src\agent\runtime\behavior-config.js'
# MindServer's port comes from launcher-config.json, not from this worker. It
# was 8080 when this scenario was frozen and is 8081 now, so the hardcoded URL
# silently polled a dead port and the run died in `waiting-for-world-ready`
# after burning its full three-minute budget. Derive it, and assert the derived
# port is free below so the isolation guarantee still holds.
$mindserverPort = 8080
try {
    $launcherConfigPath = Join-Path $repo 'launcher-config.json'
    if (Test-Path -LiteralPath $launcherConfigPath) {
        $launcherConfig = Get-Content -LiteralPath $launcherConfigPath -Raw | ConvertFrom-Json
        foreach ($candidate in @($launcherConfig.mindserver_port, $launcherConfig.port_scan_start)) {
            $parsed = 0
            if ([int]::TryParse([string]$candidate, [ref]$parsed) -and $parsed -ge 1 -and $parsed -le 65535) {
                $mindserverPort = $parsed
                break
            }
        }
    }
} catch { $mindserverPort = 8080 }
$baseUrl = "http://localhost:$mindserverPort"
$expectedMetadataHash = 'ddcc34aba25090cbc1e760c3a8dca2883ed47f35337f8d55ab3f1c235cc49a67'
$expectedProfileHash = 'e82b8f03e0411678073191db52b35c9ad74d6cfe8e36572db07c866f0817ae57'
$expectedBaselineHash = '850d7cd7abd6410be3a6a3becd87bc6f4914dac6cc0ac18c38a9cd700fe13a42'
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss-fff'
$worldName = "scenario-lab-follow-field-$RequestForm-$stamp"
$runDir = [IO.Path]::GetFullPath($OutputDirectory)
$scenarioProfilePath = Join-Path $runDir 'scenario-profile.json'
$requestPath = Join-Path $runDir 'request-message.txt'
$statusPath = Join-Path $runDir 'active-live-status.json'
$reportPath = Join-Path $runDir 'live-report.json'
$stackStdout = Join-Path $runDir 'stack-stdout.log'
$stackStderr = Join-Path $runDir 'stack-stderr.log'
$harnessStdout = Join-Path $runDir 'harness-stdout.log'
$harnessStderr = Join-Path $runDir 'harness-stderr.log'
$harnessEvidencePath = Join-Path $runDir 'follow-field-evidence.json'
$recordedTraceReadyPath = Join-Path $runDir 'recorded-trace-provider-ready.json'
$recordedTraceEvidencePath = Join-Path $runDir 'recorded-trace-provider-evidence.json'
$recordedTraceStdout = Join-Path $runDir 'recorded-trace-provider-stdout.log'
$recordedTraceStderr = Join-Path $runDir 'recorded-trace-provider-stderr.log'
$worldPath = Join-Path $managed $worldName
$extractRoot = Join-Path $runDir 'archive-extract'
$preMemory = Join-Path $runDir 'pre-run-bot-memory'
$postMemory = Join-Path $runDir 'post-run-bot-memory'
$postWorld = Join-Path $runDir 'post-run-world'
$configBackup = Join-Path $runDir 'pre-run-mindcraft-server.json'
$propertiesBackup = Join-Path $runDir 'pre-run-server.properties'
$markerPath = Join-Path $managed 'scenario-lab-managed-runtime.active'
$nodePath = $null
$mainProcess = $null
$harnessProcess = $null
$recordedTraceProcess = $null
$previousRecordedTraceKey = $null
$sourceWorldName = $null
$sourceSeed = $null
$sourceExtractPath = $null
$backedUp = $false
$memoryMoved = $false
$runtimeMemoryInstalled = $false
$worldInstalled = $false
$configurationChanged = $false
$lockAcquired = $false

$report = [ordered]@{
    schema_version = 1
    status = 'running'
    phase = 'preflight'
    started_utc = [DateTime]::UtcNow.ToString('o')
    updated_utc = [DateTime]::UtcNow.ToString('o')
    request_form = $RequestForm
    request_message = $RequestMessage
    variance = if ($Course -eq 'request-completion') {
        [ordered]@{
            case_id = $VarianceCase
            execution_mode = $VarianceExecutionMode
            preflight_mode = $PreflightMode
        }
    } else { $null }
    recorded_trace_profile = $null
    recorded_trace = $null
    frozen_model_profile = $null
    candidate_commit = $ExpectedCandidateCommit
    instrumentation = [ordered]@{
        requested_mode = $InstrumentationMode
        decision_trace_enabled = ($InstrumentationMode -eq 'on')
        observed_decision_trace_present = $null
        observed_schema_version = $null
        verified = $false
    }
    fixture_authorized = $false
    endpoints_local_only = $true
    conflict = $false
    branch = $null
    current_head = $null
    source_world = $null
    source_seed = $null
    source_archive_sha256 = $null
    fixture_metadata_sha256 = $null
    fixture_profile_sha256 = $null
    baseline_contract_sha256 = $null
    measurement_harness_sha256 = $null
    gameplay_skills_sha256 = $null
    candidate_blob_checks = $null
    replay_world = $worldName
    run_dir = $runDir
    main_pid = $null
    startup_isolation = [ordered]@{
        profile = 'scenario-profile.json'
        autonomy = 'command'
        init_message_disabled = $true
        default_goal_disabled = $true
        load_memory_disabled = $true
        profile_sha256 = $null
        pre_harness_last_result = $null
    }
    health = $null
    before = $null
    harness_process = $null
    harness_evidence = $null
    verdict = $null
    cleanup = $null
    error = $null
}

function Save-Status([string]$phase) {
    $report.phase = $phase
    $report.updated_utc = [DateTime]::UtcNow.ToString('o')
    $json = $report | ConvertTo-Json -Depth 50
    [IO.File]::WriteAllText($statusPath, $json + [Environment]::NewLine, [Text.UTF8Encoding]::new($false))
}

function Invoke-JsonPost([string]$uri, [hashtable]$body, [int]$timeoutSeconds = 30) {
    Invoke-RestMethod -Method Post -Uri $uri -ContentType 'application/json' -Body ($body | ConvertTo-Json -Depth 10 -Compress) -TimeoutSec $timeoutSeconds
}

function ConvertTo-ProcessArgument([string]$argument) {
    if ($null -eq $argument -or $argument.Length -eq 0) { return '""' }
    if ($argument -notmatch '[\s"]') { return $argument }

    $builder = New-Object Text.StringBuilder
    [void]$builder.Append('"')
    $backslashes = 0
    foreach ($character in $argument.ToCharArray()) {
        if ($character -eq '\') {
            $backslashes++
            continue
        }
        if ($character -eq '"') {
            [void]$builder.Append(('\' * (($backslashes * 2) + 1)))
            [void]$builder.Append('"')
            $backslashes = 0
            continue
        }
        if ($backslashes -gt 0) {
            [void]$builder.Append(('\' * $backslashes))
            $backslashes = 0
        }
        [void]$builder.Append($character)
    }
    if ($backslashes -gt 0) {
        [void]$builder.Append(('\' * ($backslashes * 2)))
    }
    [void]$builder.Append('"')
    return $builder.ToString()
}

function Set-ServerProperty([string]$path, [string]$name, [string]$value) {
    $lines = @(Get-Content -LiteralPath $path)
    $pattern = '^\s*' + [Regex]::Escape($name) + '='
    $found = $false
    $next = foreach ($line in $lines) {
        if ($line -match $pattern) {
            if (-not $found) {
                "$name=$value"
                $found = $true
            }
        } else {
            $line
        }
    }
    if (-not $found) { $next += "$name=$value" }
    [IO.File]::WriteAllLines($path, [string[]]$next, [Text.UTF8Encoding]::new($false))
}

function Write-ManagedDesiredState([string]$desiredState, [string]$difficulty = '') {
    $configuration = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
    $configuration.desiredState = $desiredState
    $configuration.crossplay = $false
    if (-not [string]::IsNullOrWhiteSpace($difficulty)) {
        $configuration.difficulty = $difficulty
    }
    $json = ($configuration | ConvertTo-Json -Depth 12) + [Environment]::NewLine
    [IO.File]::WriteAllText($configPath, $json, [Text.UTF8Encoding]::new($false))
}

function Summarize-State($state) {
    [ordered]@{
        observed_utc = $state.observed_utc
        position = $state.gameplay.position
        health = $state.gameplay.health
        hunger = $state.gameplay.hunger
        action_current = $state.action.current
        action_idle = $state.action.isIdle
        action_held = $state.action.held
        pathfinding = $state.action.pathfinding
        last_result = $state.action.lastResult
    }
}

function Capture-State([string]$label) {
    $captureOutput = @(& $nodePath $captureScript $runDir $label $baseUrl 2>&1)
    $captureExit = $LASTEXITCODE
    if ($captureExit -ne 0) {
        throw "State capture failed ($captureExit): $($captureOutput -join ' ')"
    }
    $state = Get-Content -LiteralPath (Join-Path $runDir 'latest-state.json') -Raw | ConvertFrom-Json
    return $state
}

if (Test-Path -LiteralPath $runDir) {
    throw "Output directory already exists: $runDir"
}
New-Item -ItemType Directory -Path $runDir | Out-Null
[IO.File]::WriteAllText($requestPath, $RequestMessage, [Text.UTF8Encoding]::new($false))
Save-Status 'preflight'

try {
    try {
        $lock = [IO.File]::Open($markerPath, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
        try {
            $bytes = [Text.UTF8Encoding]::new($false).GetBytes($runDir)
            $lock.Write($bytes, 0, $bytes.Length)
        } finally {
            $lock.Dispose()
        }
        $lockAcquired = $true
    } catch [IO.IOException] {
        $report.conflict = $true
        throw 'Another Scenario Lab invocation owns the managed runtime.'
    }

    foreach ($required in @(
        $repo,
        $fixtureProfile,
        $fixtureMetadata,
        $configPath,
        $propertiesPath,
        $captureScript,
        $runner,
        $evidenceAdapter,
        $harness,
        $varianceCases,
        $varianceCoordinator,
        $recordedTraceProvider,
        $directiveRouter,
        $skills,
        $behaviorConfig
    )) {
        if (-not (Test-Path -LiteralPath $required)) { throw "Missing required path: $required" }
    }

    $metadata = Get-Content -LiteralPath $fixtureMetadata -Raw | ConvertFrom-Json
    if ([string]$metadata.schema_version -ne 'scenario-lab.fixture.v1') {
        throw 'Unsupported follow fixture metadata schema.'
    }
    # Two fixture kinds. 'archive' restores a captured world from follow-world.zip.
    # 'generated' hands Paper a flat-layer recipe and lets it build the world at
    # boot, so there is no binary to lose and no hash to re-freeze. The deliver
    # course needs the second kind: acquisition relocates 32 blocks to search, and
    # the captured follow world is an island, so that relocation lands in open
    # ocean and self-preservation interrupts the goal. See ARCHITECTURE.md and the
    # fixture's own why[] block.
    $fixtureKind = [string]$metadata.kind
    if ([string]::IsNullOrWhiteSpace($fixtureKind)) { $fixtureKind = 'archive' }
    if ($fixtureKind -notin @('archive', 'generated')) {
        throw "Unsupported fixture kind '$fixtureKind'."
    }
    $expectedFixtureIds = if ($fixtureKind -eq 'generated') {
        @('scenario-lab.deliver-item-flat.v1', 'scenario-lab.orchestration-forest.v1')
    } else {
        @('scenario-lab.doorway-corridor-follow.v1')
    }
    if ([string]$metadata.fixture_id -notin $expectedFixtureIds -or [int]$metadata.fixture_version -ne 1) {
        throw 'Fixture metadata identifies the wrong scenario or version.'
    }
    if ($fixtureKind -eq 'archive' -and -not (Test-Path -LiteralPath $archive)) {
        throw "Missing required path: $archive"
    }
    $sourceWorldName = [string]$metadata.source.world_name
    $sourceSeed = [string]$metadata.source.seed
    $sourceExtractPath = if ($fixtureKind -eq 'archive') { Join-Path $extractRoot $sourceWorldName } else { $null }
    if ([string]::IsNullOrWhiteSpace($sourceWorldName) -or $sourceSeed -notmatch '^-?\d+$') {
        throw 'Fixture metadata has an invalid source world or seed.'
    }
    if ($sourceSeed -ne $ExpectedSeed) {
        throw "Fixture seed mismatch: expected $ExpectedSeed but metadata declares $sourceSeed."
    }

    $branch = ((& git -C $repo branch --show-current 2>&1 | Out-String).Trim())
    $head = ((& git -C $repo rev-parse HEAD 2>&1 | Out-String).Trim())
    & git -C $repo merge-base --is-ancestor $ExpectedCandidateCommit HEAD 2>$null
    if ($LASTEXITCODE -ne 0) {
        throw "Candidate commit $ExpectedCandidateCommit is not an ancestor of current HEAD $head."
    }
    $dirty = @(& git -C $repo status --porcelain=v1 --untracked-files=all)
    $report.regression_mode = [bool]$RegressionMode
    $report.working_tree_dirty_count = $dirty.Count
    $report.working_tree_dirty = @($dirty | Select-Object -First 200)
    if ($dirty.Count -ne 0 -and -not $RegressionMode) {
        throw "Repository must be clean for a registered live replay: $($dirty -join '; ')"
    }

    $archiveHash = if ($fixtureKind -eq 'archive') {
        (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant()
    } else {
        $null
    }
    $profileHash = (Get-FileHash -LiteralPath $fixtureProfile -Algorithm SHA256).Hash.ToLowerInvariant()
    $metadataHash = (Get-FileHash -LiteralPath $fixtureMetadata -Algorithm SHA256).Hash.ToLowerInvariant()
    $harnessHash = (Get-FileHash -LiteralPath $harness -Algorithm SHA256).Hash.ToLowerInvariant()
    $skillsHash = (Get-FileHash -LiteralPath $skills -Algorithm SHA256).Hash.ToLowerInvariant()
    $report.branch = $branch
    $report.current_head = $head
    $report.source_world = $sourceWorldName
    $report.source_seed = $sourceSeed
    $report.source_archive_sha256 = $archiveHash
    $report.fixture_metadata_sha256 = $metadataHash
    $report.fixture_profile_sha256 = $profileHash
    $report.baseline_contract_sha256 = [string]$metadata.course_contract.baseline_sha256
    $report.measurement_harness_sha256 = $harnessHash
    $report.gameplay_skills_sha256 = $skillsHash

    if ($fixtureKind -eq 'archive') {
        if ($archiveHash -ne $ExpectedFixtureHash) { throw "Archived world hash mismatch: $archiveHash" }
        if ($metadataHash -ne $expectedMetadataHash) { throw 'Fixture metadata hash does not match the registered frozen contract.' }
        if ($profileHash -ne $expectedProfileHash) { throw 'Scenario profile hash does not match the registered frozen contract.' }
        if ($archiveHash -ne [string]$metadata.archive.sha256) { throw 'Archive hash does not match fixture metadata.' }
        if ($profileHash -ne [string]$metadata.profile.sha256) { throw 'Scenario profile hash does not match fixture metadata.' }
        if ([string]$metadata.course_contract.baseline_sha256 -ne $expectedBaselineHash) { throw 'Baseline course contract does not match the registered frozen contract.' }
    } else {
        # A generated fixture has no archive, so the metadata file IS the world:
        # change a layer and you change the terrain. Pinning it to the manifest's
        # fixtureHash keeps exactly the guarantee the archive hash gave -- the run
        # provably describes the world the manifest registered -- without a binary.
        if ($metadataHash -ne $ExpectedFixtureHash) {
            throw "Generated fixture recipe hash mismatch: expected $ExpectedFixtureHash but the recipe hashes to $metadataHash."
        }
        if (
            $null -ne $metadata.profile -and
            -not [string]::IsNullOrWhiteSpace([string]$metadata.profile.sha256) -and
            $profileHash -ne [string]$metadata.profile.sha256
        ) {
            throw 'Generated fixture profile hash does not match its registered metadata.'
        }
    }
    $boundCandidateFiles = [ordered]@{
        follow_worker = [ordered]@{
            relative_path = 'tools/scenario-lab/adapters/follow-field-worker.ps1'
            path = $PSCommandPath
        }
        follow_runner = [ordered]@{
            relative_path = 'tools/scenario-lab/adapters/run-follow-field.mjs'
            path = $runner
        }
        evidence_adapter = [ordered]@{
            relative_path = 'tools/scenario-lab/adapters/follow-field-evidence.mjs'
            path = $evidenceAdapter
        }
        capture_helper = [ordered]@{
            relative_path = 'tools/scenario-lab/adapters/capture-agent-state.mjs'
            path = $captureScript
        }
        measurement_harness = [ordered]@{
            relative_path = 'tools/verify-follow-field.mjs'
            path = $harness
        }
        variance_cases = [ordered]@{
            relative_path = 'tools/scenario-lab/variance-cases.mjs'
            path = $varianceCases
        }
        variance_coordinator = [ordered]@{
            relative_path = 'tools/scenario-lab/run-variance-matrix.mjs'
            path = $varianceCoordinator
        }
        recorded_trace_provider = [ordered]@{
            relative_path = 'tools/scenario-lab/adapters/recorded-trace-provider.mjs'
            path = $recordedTraceProvider
        }
        directive_router = [ordered]@{
            relative_path = 'src/agent/player-directives.js'
            path = $directiveRouter
        }
        gameplay_controller = [ordered]@{
            relative_path = 'src/agent/library/skills.js'
            path = $skills
        }
        behavior_config = [ordered]@{
            relative_path = 'src/agent/runtime/behavior-config.js'
            path = $behaviorConfig
        }
    }
    $blobChecks = [ordered]@{}
    foreach ($entry in $boundCandidateFiles.GetEnumerator()) {
        $relativePath = [string]$entry.Value.relative_path
        $absolutePath = [string]$entry.Value.path
        # `rev-parse <commit>:<path>` writes a fatal error when a required
        # regression source is new in the working tree. With the worker's
        # ErrorActionPreference that aborts before RegressionMode can record the
        # expected mismatch. `ls-tree` represents an absent path as an empty,
        # successful lookup, so provenance remains complete without weakening
        # certification mode.
        $candidateTreeEntry = ((& git -C $repo ls-tree $ExpectedCandidateCommit -- $relativePath 2>&1 | Out-String).Trim())
        $candidateBlob = if ($candidateTreeEntry -match '^[0-9]{6}\s+blob\s+([a-f0-9]{40})\s') {
            $Matches[1]
        } else {
            $null
        }
        $currentBlob = ((& git -C $repo hash-object "--path=$relativePath" -- $absolutePath 2>&1 | Out-String).Trim())
        $blobMatched = ($candidateBlob -match '^[a-f0-9]{40}$') -and ($currentBlob -eq $candidateBlob)
        if (-not $blobMatched -and -not $RegressionMode) {
            throw "$($entry.Key) does not match the registered candidate commit."
        }
        $blobChecks[$entry.Key] = [ordered]@{
            relative_path = $relativePath
            candidate_blob = $candidateBlob
            candidate_present = ($null -ne $candidateBlob)
            current_blob = $currentBlob
            matched = $blobMatched
        }
    }
    $report.candidate_blob_checks = $blobChecks
    # The fixture records the gameplay controller hash it was frozen against.
    # In certification mode any drift aborts, which is correct for a result that
    # claims to describe that exact code -- and is also why this scenario could
    # only ever verify one commit. In regression mode the drift is recorded and
    # the run proceeds, because the whole point is to test the code as it is now.
    # A generated fixture pins terrain, not code, so it records no gameplay
    # controller hash. Requiring one would make this course a one-shot notary the
    # way the follow scenario was -- re-frozen on every skills.js edit.
    $skillsDrifted = ($fixtureKind -eq 'archive') -and
        ($skillsHash -ne [string]$metadata.candidate.gameplay_skills_sha256)
    $report.gameplay_skills_drifted = $skillsDrifted
    $report.fixture_gameplay_skills_sha256 = [string]$metadata.candidate.gameplay_skills_sha256
    if ($skillsDrifted -and -not $RegressionMode) { throw 'Gameplay controller drifted from the frozen fixture contract.' }
    $report.fixture_authorized = $true

    if (Test-Path -LiteralPath $worldPath) { throw "Replay world already exists: $worldPath" }
    if ($sourceExtractPath -and (Test-Path -LiteralPath $sourceExtractPath)) { throw "Archive source world unexpectedly exists: $sourceExtractPath" }
    # Only OUR managed server counts as a conflict. This used to abort on any
    # java.exe or javaw.exe at all, which meant the Director playing Minecraft --
    # the launcher ships its own bundled javaw -- blocked every scenario with
    # "Java is already running", while scenario:doctor reported ready because it
    # never looked. The cleanup path below already matches on the managed jar;
    # this is the same test.
    $managedJarPath = [IO.Path]::GetFullPath((Join-Path $managed 'server.jar'))
    $conflictingJava = @(Get-CimInstance Win32_Process | Where-Object {
        ($_.Name -in @('java.exe', 'javaw.exe')) -and $_.CommandLine -like ('*' + $managedJarPath + '*')
    })
    if ($conflictingJava.Count -gt 0) {
        $report.conflict = $true
        throw "The managed Paper server is already running (pid $($conflictingJava[0].ProcessId))."
    }
    foreach ($port in @($mindserverPort, 25579)) {
        if (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue) {
            $report.conflict = $true
            throw "Port $port is already listening."
        }
    }

    $nodePath = (Get-Command node.exe -ErrorAction Stop).Source
    & $nodePath --check $captureScript
    if ($LASTEXITCODE -ne 0) { throw 'Capture script syntax check failed.' }
    & $nodePath --check $harness
    if ($LASTEXITCODE -ne 0) { throw 'Follow harness syntax check failed.' }
    & $nodePath --check $varianceCases
    if ($LASTEXITCODE -ne 0) { throw 'Variance case contract syntax check failed.' }
    & $nodePath --check $recordedTraceProvider
    if ($LASTEXITCODE -ne 0) { throw 'Recorded trace provider syntax check failed.' }

    $scenarioProfile = Get-Content -LiteralPath $fixtureProfile -Raw | ConvertFrom-Json
    if ([string]$scenarioProfile.name -ne 'MindcraftBot') {
        throw 'The Scenario Lab fixture profile is not MindcraftBot.'
    }
    if ($null -eq $scenarioProfile.runtime) {
        $scenarioProfile | Add-Member -NotePropertyName runtime -NotePropertyValue ([pscustomobject]@{ autonomy = 'command' }) -Force
    } else {
        $scenarioProfile.runtime | Add-Member -NotePropertyName autonomy -NotePropertyValue 'command' -Force
    }
    if ($Course -eq 'request-completion') {
        $preflightPolicy = if ($PreflightMode -eq 'on') {
            [pscustomobject]@{ collectionRoute = 'strict'; interactionStance = 'strict' }
        } else {
            [pscustomobject]@{ collectionRoute = 'advisory'; interactionStance = 'advisory' }
        }
        $scenarioProfile.runtime | Add-Member -NotePropertyName preflight -NotePropertyValue $preflightPolicy -Force
    }
    if ($Course -eq 'request-completion' -and $VarianceExecutionMode -eq 'frozen-model') {
        $configuredConversationModels = @($scenarioProfile.model)
        if ($configuredConversationModels.Count -lt 1 -or $null -eq $configuredConversationModels[0]) {
            throw 'The Phase 5 frozen-model arm has no configured conversation model.'
        }
        # The variance axis must name one fixed model route. Leaving the fixture's
        # ordinary fallback list active would let one cell silently change models
        # after a provider failure and would no longer be a frozen-model sample.
        $scenarioProfile.model = $configuredConversationModels[0]
        $report.frozen_model_profile = [ordered]@{
            api = [string]$scenarioProfile.model.api
            model = [string]$scenarioProfile.model.model
            url = if ($null -ne $scenarioProfile.model.url) { [string]$scenarioProfile.model.url } else { $null }
            route_count = 1
        }
    }
    if ($Course -eq 'request-completion' -and $VarianceExecutionMode -eq 'recorded-trace') {
        $recordedTraceProcess = Start-Process -FilePath $nodePath -ArgumentList @(
            $recordedTraceProvider,
            '--case', $VarianceCase,
            '--ready-file', $recordedTraceReadyPath,
            '--evidence-file', $recordedTraceEvidencePath
        ) -WorkingDirectory $repo -PassThru -WindowStyle Hidden -RedirectStandardOutput $recordedTraceStdout -RedirectStandardError $recordedTraceStderr
        $recordedReadyDeadline = [DateTime]::UtcNow.AddSeconds(15)
        while ([DateTime]::UtcNow -lt $recordedReadyDeadline -and -not (Test-Path -LiteralPath $recordedTraceReadyPath)) {
            $recordedTraceProcess.Refresh()
            if ($recordedTraceProcess.HasExited) {
                throw "Recorded trace provider exited during startup with code $($recordedTraceProcess.ExitCode)."
            }
            Start-Sleep -Milliseconds 100
        }
        if (-not (Test-Path -LiteralPath $recordedTraceReadyPath)) {
            throw 'Recorded trace provider did not publish its loopback endpoint within 15 seconds.'
        }
        $recordedReady = Get-Content -LiteralPath $recordedTraceReadyPath -Raw | ConvertFrom-Json
        if (
            [string]$recordedReady.caseId -ne $VarianceCase -or
            [string]$recordedReady.host -ne '127.0.0.1' -or
            [string]$recordedReady.driverFingerprint -notmatch '^[a-f0-9]{64}$'
        ) {
            throw 'Recorded trace provider readiness evidence is invalid.'
        }
        $recordedModel = [pscustomobject]@{
            api = 'openai_compatible'
            model = [string]$recordedReady.model
            url = [string]$recordedReady.baseUrl
            params = [pscustomobject]@{
                api_key_env = 'OPENAI_COMPATIBLE_API_KEY'
                timeout = 15
                max_retries = 0
            }
        }
        $scenarioProfile.model = $recordedModel
        $scenarioProfile.reasoning_model = $recordedModel
        $scenarioProfile.autonomy_model = $recordedModel
        $scenarioProfile.memory_model = $recordedModel
        $report.recorded_trace_profile = [ordered]@{
            api = 'openai_compatible'
            model = [string]$recordedReady.model
            url = [string]$recordedReady.baseUrl
            driverFingerprint = [string]$recordedReady.driverFingerprint
        }
    }
    $maxPromptTurns = if ($Course -eq 'request-completion') {
        [int]$scenarioProfile.runtime.limits.maxPromptTurns
    } else { 0 }
    if ($Course -eq 'request-completion' -and $maxPromptTurns -lt 1) {
        throw 'The Phase 5 request-completion profile must declare a positive maxPromptTurns boundary.'
    }
    $scenarioProfileJson = ($scenarioProfile | ConvertTo-Json -Depth 30) + [Environment]::NewLine
    [IO.File]::WriteAllText($scenarioProfilePath, $scenarioProfileJson, [Text.UTF8Encoding]::new($false))
    $report.startup_isolation.profile_sha256 = (Get-FileHash -LiteralPath $scenarioProfilePath -Algorithm SHA256).Hash.ToLowerInvariant()
    # A fixture may name the command surface the bot is allowed. Everything not
    # named is blocked, in the prompt and in the command map. This is how a course
    # asks whether the LLM can orchestrate primitives rather than route to a
    # pre-written procedure; see the orchestration block in the fixture metadata.
    $allowedCommands = @()
    if ($null -ne $metadata.orchestration -and $null -ne $metadata.orchestration.allowed_commands) {
        $allowedCommands = @($metadata.orchestration.allowed_commands)
    }
    $launchSettings = [ordered]@{
        auto_start = $true
        auto_open_ui = $false
        init_message = ''
        default_goal = ''
        load_memory = $false
        decision_trace = [ordered]@{
            enabled = ($InstrumentationMode -eq 'on')
            retention = 128
        }
    }
    if ($allowedCommands.Count -gt 0) {
        $launchSettings['allowed_commands'] = $allowedCommands
        $report.allowed_commands = $allowedCommands
    }
    # Step 6 as a fixture switch: stand the deterministic pre-LLM interceptors
    # down so the model chooses. Without it a plain-language chain is parsed and
    # queued before command selection ever happens.
    if ($null -ne $metadata.orchestration -and $metadata.orchestration.llm_sequencing -eq $true) {
        $launchSettings['llm_sequencing'] = $true
        $report.llm_sequencing = $true
    }
    if ($null -ne $metadata.orchestration -and $metadata.orchestration.charcoal_mission_mode -in @('active', 'shadow', 'off')) {
        $launchSettings['charcoal_mission_mode'] = [string]$metadata.orchestration.charcoal_mission_mode
        $report.charcoal_mission_mode = [string]$metadata.orchestration.charcoal_mission_mode
    }
    $launchSettingsJson = ($launchSettings | ConvertTo-Json -Compress -Depth 6)

    Save-Status 'backing-up-runtime'
    Copy-Item -LiteralPath $configPath -Destination $configBackup
    Copy-Item -LiteralPath $propertiesPath -Destination $propertiesBackup
    $backedUp = $true

    if (Test-Path -LiteralPath $botDir) {
        Move-Item -LiteralPath $botDir -Destination $preMemory
        $memoryMoved = $true
    }
    New-Item -ItemType Directory -Path $botDir | Out-Null
    $runtimeMemoryInstalled = $true

    if ($fixtureKind -eq 'archive') {
        Save-Status 'restoring-archived-world'
        Expand-Archive -LiteralPath $archive -DestinationPath $extractRoot
        if (-not (Test-Path -LiteralPath $sourceExtractPath)) {
            throw "Archive did not restore expected world root: $sourceExtractPath"
        }
        $worldInstalled = $true
        Move-Item -LiteralPath $sourceExtractPath -Destination $worldPath
    } else {
        # Nothing to restore -- Paper builds the world from the recipe on first
        # boot. $worldInstalled still gates cleanup, which moves the generated
        # world out of the managed directory exactly as it does a restored one.
        Save-Status 'generating-world-from-recipe'
        $generatorSettings = ($metadata.generation.generator_settings | ConvertTo-Json -Compress -Depth 10)
        $generateStructures = if ([bool]$metadata.generation.generate_structures) { 'true' } else { 'false' }
        $worldInstalled = $true
        Set-ServerProperty $propertiesPath 'level-type' ([string]$metadata.generation.level_type)
        Set-ServerProperty $propertiesPath 'generator-settings' $generatorSettings
        Set-ServerProperty $propertiesPath 'generate-structures' $generateStructures
        $report.world_recipe = [ordered]@{
            level_type = [string]$metadata.generation.level_type
            generator_settings = $generatorSettings
            generate_structures = $generateStructures
            expected_top_block = [string]$metadata.generation.surface.top_block
            expected_top_y = [int]$metadata.generation.surface.top_y
            expected_stand_y = [int]$metadata.generation.surface.stand_y
        }
    }

    Set-ServerProperty $propertiesPath 'level-name' $worldName
    Set-ServerProperty $propertiesPath 'level-seed' $sourceSeed
    # Hostile isolation must exist before Kevin joins. Applying peaceful only
    # after world-ready allowed a drowned to damage him during boot, leaving a
    # live survival incident that later preempted the measured player command.
    # The outer worker restores the complete original properties file.
    Set-ServerProperty $propertiesPath 'difficulty' 'peaceful'
    Set-ServerProperty $propertiesPath 'gamemode' 'survival'
    Set-ServerProperty $propertiesPath 'online-mode' 'false'
    Set-ServerProperty $propertiesPath 'spawn-protection' '0'
    Write-ManagedDesiredState 'running' 'peaceful'
    $configurationChanged = $true

    Save-Status 'starting-runtime'
    $previousSettingsJson = [Environment]::GetEnvironmentVariable('SETTINGS_JSON', [EnvironmentVariableTarget]::Process)
    $previousRecordedTraceKey = [Environment]::GetEnvironmentVariable('OPENAI_COMPATIBLE_API_KEY', [EnvironmentVariableTarget]::Process)
    try {
        [Environment]::SetEnvironmentVariable('SETTINGS_JSON', $launchSettingsJson, [EnvironmentVariableTarget]::Process)
        if ($Course -eq 'request-completion' -and $VarianceExecutionMode -eq 'recorded-trace') {
            [Environment]::SetEnvironmentVariable('OPENAI_COMPATIBLE_API_KEY', 'scenario-local-recorded-trace', [EnvironmentVariableTarget]::Process)
        }
        # Keep the held replay bot loaded. The harness requires an Operator Hold
        # (waitForHeld), and a held bot with no human online otherwise unloads
        # after a 10s grace -- which raced the measurement and killed roughly a
        # third of invocations mid-run. This suppresses only the process unload;
        # the Operator Hold itself is untouched.
        $env:MINDCRAFT_HELD_UNLOAD_GRACE_MS = '-1'
        $mainProcess = Start-Process -FilePath $nodePath -ArgumentList @('main.js', '--profile', $scenarioProfilePath) -WorkingDirectory $repo -PassThru -WindowStyle Hidden -RedirectStandardOutput $stackStdout -RedirectStandardError $stackStderr
    } finally {
        [Environment]::SetEnvironmentVariable('SETTINGS_JSON', $previousSettingsJson, [EnvironmentVariableTarget]::Process)
        [Environment]::SetEnvironmentVariable('OPENAI_COMPATIBLE_API_KEY', $previousRecordedTraceKey, [EnvironmentVariableTarget]::Process)
    }
    if ($null -eq $mainProcess) { throw 'The isolated launcher process was not created.' }
    $report.main_pid = $mainProcess.Id
    Save-Status 'waiting-for-world-ready'

    $readyDeadline = [DateTime]::UtcNow.AddMinutes(3)
    $ready = $false
    while ([DateTime]::UtcNow -lt $readyDeadline) {
        $mainProcess.Refresh()
        if ($mainProcess.HasExited) { throw "Main process exited during boot with code $($mainProcess.ExitCode)." }
        try {
            $health = Invoke-RestMethod -Uri "$baseUrl/api/health" -Method Get -TimeoutSec 5
            $agents = Invoke-RestMethod -Uri "$baseUrl/api/agents" -Method Get -TimeoutSec 5
            $bot = @($agents.agents | Where-Object { $_.name -eq 'MindcraftBot' }) | Select-Object -First 1
            $report.health = [ordered]@{
                minecraft_reachable = $health.checks.minecraftReachable
                problems = @($health.problems)
                bot_state = $bot.state
                bot_in_game = $bot.in_game
                bot_socket_connected = $bot.socket_connected
            }
            Save-Status 'waiting-for-world-ready'
            if ($health.checks.minecraftReachable -eq $true -and $bot.state -eq 'running' -and $bot.in_game -eq $true -and $bot.socket_connected -eq $true) {
                $ready = $true
                break
            }
        } catch {
            $report.health = [ordered]@{ transient_error = $_.Exception.Message }
        }
        Start-Sleep -Seconds 2
    }
    if (-not $ready) { throw 'Runtime did not become world-ready within three minutes.' }

    # The measurement harness REQUIRES this hold: verify-follow-field.mjs calls
    # waitForHeld() and will not begin until the bot reports held + idle +
    # not-pathfinding + actuator-quiescent. That quiescent baseline is what makes
    # the follow measurement meaningful, so the hold is a precondition, not an
    # obstacle. An earlier attempt to skip it here (on a misdiagnosis that it
    # triggered the zero-human unload) simply timed the harness out.
    Save-Status 'placing-operator-hold'
    $hold = Invoke-JsonPost "$baseUrl/api/director/command" @{
        agent = 'MindcraftBot'
        message = '!stop'
    }
    if ($hold.success -ne $true) { throw 'Could not place the replay bot under operator hold.' }
    $report.startup_isolation.operator_hold_placed = $true
    Start-Sleep -Seconds 3

    $beforeState = Capture-State 'before-harness'
    $report.before = Summarize-State $beforeState
    $decisionTrace = $beforeState.action.behaviorArbiter.decisionTrace
    $tracePresent = $null -ne $decisionTrace
    $observedSchemaVersion = if ($tracePresent) { $decisionTrace.schemaVersion } else { $null }
    $instrumentationVerified = if ($InstrumentationMode -eq 'on') {
        $tracePresent -and $observedSchemaVersion -eq 1
    } else {
        -not $tracePresent
    }
    $report.instrumentation.observed_decision_trace_present = $tracePresent
    $report.instrumentation.observed_schema_version = $observedSchemaVersion
    $report.instrumentation.verified = $instrumentationVerified
    if (-not $instrumentationVerified) {
        throw "Instrumentation mode '$InstrumentationMode' was not observed in the runtime state."
    }
    $report.startup_isolation.pre_harness_last_result = $beforeState.action.lastResult
    if (
        $null -ne $beforeState.action.lastResult -and
        [string]$beforeState.action.lastResult.label -eq 'action:followPlayer'
    ) {
        throw 'Startup isolation failed: followPlayer ran before the measured request.'
    }

    Save-Status 'running-follow-field-harness'
    $harnessArgs = @(
        $harness,
        '--url', $baseUrl,
        '--bot', 'MindcraftBot',
        '--attempts', '1',
        '--evidence', $harnessEvidencePath,
        '--operation-timeout-ms', [string]$TimeoutMs,
        # Every delivering course measures in deliver mode. Keyed to one course
        # name, orchestrate-charcoal silently ran in follow mode and timed out
        # waiting for follow ownership that a charcoal task never produces.
        '--mode', $(if ($Course -eq 'request-completion') {
            'request-completion'
        } elseif ($Course -in @('deliver-item', 'orchestrate-charcoal')) {
            'deliver'
        } elseif ($Course -eq 'route-probe-inconclusive') {
            'route-probe'
        } elseif ($Course -eq 'interaction-stance-inconclusive') {
            'interaction-stance'
        } elseif ($Course -in @('terrain-swim-exit', 'terrain-workaround-chain')) {
            'terrain'
        } elseif ($Course -in @('player-route-obstruction', 'pathfinding-finite-break-cost', 'player-route-best-reachable')) {
            'player-route'
        } else {
            'follow'
        }),
        '--course', $Course,
        '--request-file', $requestPath,
        '--authorized-active-world'
    )
    if ($RequestForm -eq 'natural-language') { $harnessArgs += '--natural-language' }
    if ($Course -eq 'request-completion') {
        $harnessArgs += @(
            '--variance-case', $VarianceCase,
            '--preflight-mode', $PreflightMode,
            '--max-prompt-turns', [string]$maxPromptTurns
        )
    }
    $harnessStartedAt = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
    $harnessStartInfo = New-Object System.Diagnostics.ProcessStartInfo
    $harnessStartInfo.FileName = $nodePath
    $harnessStartInfo.Arguments = (($harnessArgs | ForEach-Object { ConvertTo-ProcessArgument ([string]$_) }) -join ' ')
    $harnessStartInfo.WorkingDirectory = $repo
    $harnessStartInfo.UseShellExecute = $false
    $harnessStartInfo.CreateNoWindow = $true
    $harnessStartInfo.RedirectStandardOutput = $true
    $harnessStartInfo.RedirectStandardError = $true
    $harnessProcess = New-Object System.Diagnostics.Process
    $harnessProcess.StartInfo = $harnessStartInfo
    if (-not $harnessProcess.Start()) { throw 'Follow field harness process was not created.' }
    $harnessStdoutTask = $harnessProcess.StandardOutput.ReadToEndAsync()
    $harnessStderrTask = $harnessProcess.StandardError.ReadToEndAsync()
    # Request-completion owns bounded waits inside the verifier for the exact
    # outcome, correlated result, halt, and settlement. A second outer clock
    # would add those stages together incorrectly and kill valid late outcomes.
    if ($Course -eq 'request-completion') {
        $harnessProcess.WaitForExit()
        $harnessTimedOut = $false
    } else {
        $harnessTimedOut = -not $harnessProcess.WaitForExit($TimeoutMs)
    }
    if ($harnessTimedOut) {
        Stop-Process -Id $harnessProcess.Id -Force -ErrorAction SilentlyContinue
        if (-not $harnessProcess.WaitForExit(5000)) {
            throw 'Follow field harness process did not terminate after timeout.'
        }
    }
    $harnessProcess.WaitForExit()
    $harnessExitCode = $harnessProcess.ExitCode
    $harnessStdoutText = $harnessStdoutTask.GetAwaiter().GetResult()
    $harnessStderrText = $harnessStderrTask.GetAwaiter().GetResult()
    [IO.File]::WriteAllText($harnessStdout, $harnessStdoutText, [Text.UTF8Encoding]::new($false))
    [IO.File]::WriteAllText($harnessStderr, $harnessStderrText, [Text.UTF8Encoding]::new($false))
    $report.harness_process = [ordered]@{
        pid = $harnessProcess.Id
        exit_code = $harnessExitCode
        timed_out = $harnessTimedOut
        started_at_unix_ms = $harnessStartedAt
        duration_ms = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() - $harnessStartedAt
        stdout = $harnessStdoutText.Trim()
        stderr = $harnessStderrText.Trim()
    }
    if (-not (Test-Path -LiteralPath $harnessEvidencePath)) {
        throw 'Follow field harness did not produce an evidence file.'
    }

    $harnessEvidence = Get-Content -LiteralPath $harnessEvidencePath -Raw | ConvertFrom-Json
    $report.harness_evidence = $harnessEvidence
    $attempts = @($harnessEvidence.attempts)
    $attempt = if ($attempts.Count -eq 1) { $attempts[0] } else { $null }
    if ($Course -eq 'request-completion' -and $VarianceExecutionMode -eq 'recorded-trace') {
        if (-not (Test-Path -LiteralPath $recordedTraceEvidencePath)) {
            throw 'Recorded trace provider did not produce evidence.'
        }
        $recordedTraceEvidence = Get-Content -LiteralPath $recordedTraceEvidencePath -Raw | ConvertFrom-Json
        $completeMeasurements = @($attempt.modelMeasurements | Where-Object {
            [string]$_.modelConfigFingerprint -match '^[a-f0-9]{64}$' -and
            [string]$_.inputFingerprint -match '^[a-f0-9]{64}$' -and
            [string]$_.outputFingerprint -match '^[a-f0-9]{64}$' -and
            [string]$_.modelRouteFingerprint -match '^[a-f0-9]{64}$'
        })
        $modelMeasurement = if ($completeMeasurements.Count -gt 0) { $completeMeasurements[-1] } else { $null }
        if ($null -eq $modelMeasurement) {
            throw 'Recorded trace provider ran without one complete runtime model measurement.'
        }
        $recordedTraceEvidence | Add-Member -NotePropertyName modelConfigFingerprint -NotePropertyValue ([string]$modelMeasurement.modelConfigFingerprint) -Force
        $recordedTraceEvidence | Add-Member -NotePropertyName modelRouteFingerprint -NotePropertyValue ([string]$modelMeasurement.modelRouteFingerprint) -Force
        $report.recorded_trace = $recordedTraceEvidence
    }
    # What counts as complete physical evidence depends on the course. Doorway,
    # corridor and final-waypoint are follow criteria: the deliver course's
    # recipient never moves, so requiring them would reject a delivery that
    # demonstrably happened. The deliver clause is not weaker -- it additionally
    # requires that the item physically changed hands and that the world could
    # have supported the acquisition at all.
    $physicalEvidenceComplete = if ($Course -eq 'request-completion') {
        (
            $null -ne $attempt -and
            $attempt.passed -eq $true -and
            $attempt.physicalAcceptance.caseId -eq $VarianceCase -and
            $attempt.physicalAcceptance.t0Verified -eq $true -and
            [string]$attempt.physicalAcceptance.t0Fingerprint -match '^[a-f0-9]{64}$' -and
            $attempt.physicalAcceptance.outcomesVerified -eq $true -and
            $attempt.physicalAcceptance.fixtureVerified -eq $true -and
            $attempt.physicalAcceptance.preflightMode -eq $PreflightMode -and
            $attempt.stop.stableForTenSeconds -eq $true -and
            [double]$attempt.stop.quiescenceMs -le 2000
        )
    } elseif ($Course -eq 'terrain-swim-exit') {
        (
            $null -ne $attempt -and
            $attempt.passed -eq $true -and
            $attempt.terminal.label -eq 'action:goToCoordinates' -and
            $attempt.terminal.phase -eq 'succeeded' -and
            $attempt.terminal.code -eq 'skill_arrived' -and
            $attempt.physicalAcceptance.terrainStartSubmerged -eq $true -and
            $attempt.physicalAcceptance.terrainAscentObserved -eq $true -and
            $attempt.physicalAcceptance.terrainDrySettlement -eq $true -and
            $attempt.physicalAcceptance.terrainPathfinderObserved -eq $true -and
            $attempt.physicalAcceptance.terrainTraversalPolicy -eq 'full' -and
            $attempt.physicalAcceptance.terrainTerminalVerified -eq $true -and
            $attempt.physicalAcceptance.terrainIntact -eq $true -and
            $attempt.physicalAcceptance.terrainScaffoldAccountingVerified -eq $true -and
            $attempt.physicalAcceptance.fixtureVerified -eq $true -and
            $attempt.stop.stableForTenSeconds -eq $true -and
            [double]$attempt.stop.quiescenceMs -le 2000
        )
    } elseif ($Course -eq 'terrain-workaround-chain') {
        (
            $null -ne $attempt -and
            $attempt.passed -eq $true -and
            $attempt.terminal.label -eq 'action:goToCoordinates' -and
            $attempt.terminal.phase -eq 'succeeded' -and
            $attempt.terminal.code -eq 'skill_arrived' -and
            $attempt.physicalAcceptance.terrainChainDigVerified -eq $true -and
            $attempt.physicalAcceptance.terrainChainParkourVerified -eq $true -and
            $attempt.physicalAcceptance.terrainChainBridgeVerified -eq $true -and
            $attempt.physicalAcceptance.terrainChainTowerVerified -eq $true -and
            $attempt.physicalAcceptance.terrainChainStairTunnelVerified -eq $true -and
            $attempt.physicalAcceptance.terrainChainDescentVerified -eq $true -and
            $attempt.physicalAcceptance.terrainChainSwimExitVerified -eq $true -and
            $attempt.physicalAcceptance.terrainChainScaffoldAccountingVerified -eq $true -and
            $attempt.physicalAcceptance.terrainChainPathfinderObserved -eq $true -and
            $attempt.physicalAcceptance.terrainChainTraversalPolicy -eq 'full' -and
            $attempt.physicalAcceptance.terrainChainTerminalVerified -eq $true -and
            $attempt.physicalAcceptance.terrainChainFixtureVerified -eq $true -and
            $attempt.physicalAcceptance.terrainChainCheckpoints.complete -eq $true -and
            $attempt.stop.stableForTenSeconds -eq $true -and
            [double]$attempt.stop.quiescenceMs -le 2000
        )
    } elseif ($Course -eq 'player-route-best-reachable') {
        (
            $null -ne $attempt -and
            $attempt.passed -eq $true -and
            $attempt.terminal.label -eq 'action:goToPlayer' -and
            $attempt.terminal.phase -eq 'failed' -and
            $attempt.terminal.code -in @('skill_closest_reachable', 'skill_closest_explored') -and
            $attempt.physicalAcceptance.playerRoutePathfinderObserved -eq $true -and
            $attempt.physicalAcceptance.playerRouteBestPositionVerified -eq $true -and
            $attempt.physicalAcceptance.unbreakableObstructionPreserved -eq $true -and
            $attempt.physicalAcceptance.fixtureVerified -eq $true -and
            $attempt.stop.stableForTenSeconds -eq $true -and
            [double]$attempt.stop.quiescenceMs -le 2000
        )
    } elseif ($Course -in @('player-route-obstruction', 'pathfinding-finite-break-cost')) {
        (
            $null -ne $attempt -and
            $attempt.passed -eq $true -and
            $attempt.terminal.label -eq 'action:goToPlayer' -and
            $attempt.terminal.phase -eq 'succeeded' -and
            $attempt.terminal.code -eq 'skill_arrived' -and
            $attempt.physicalAcceptance.playerRoutePathfinderObserved -eq $true -and
            $attempt.physicalAcceptance.playerRouteArrivalVerified -eq $true -and
            $attempt.physicalAcceptance.obstructionDugThrough -eq $true -and
            $attempt.physicalAcceptance.doorwayCrossed -eq $true -and
            ($Course -ne 'pathfinding-finite-break-cost' -or $attempt.physicalAcceptance.finiteBreakCostVerified -eq $true) -and
            $attempt.physicalAcceptance.fixtureVerified -eq $true -and
            $attempt.stop.stableForTenSeconds -eq $true -and
            [double]$attempt.stop.quiescenceMs -le 2000
        )
    } elseif ($Course -eq 'interaction-stance-inconclusive') {
        (
            $null -ne $attempt -and
            $attempt.passed -eq $true -and
            $attempt.terminal.phase -eq 'succeeded' -and
            $attempt.physicalAcceptance.producerStatus -in @('partial', 'timeout') -and
            $attempt.physicalAcceptance.producerConclusive -eq $false -and
            $attempt.physicalAcceptance.helperStatus -eq 'ready' -and
            $attempt.physicalAcceptance.originalGoalReached -eq $true -and
            $attempt.physicalAcceptance.pathfinderSettled -eq $true -and
            $attempt.physicalAcceptance.laterInteractionAttempted -eq $false -and
            $attempt.physicalAcceptance.inventoryIntact -eq $true -and
            $attempt.physicalAcceptance.terrainIntact -eq $true -and
            $attempt.physicalAcceptance.fixtureVerified -eq $true
        )
    } elseif ($Course -eq 'route-probe-inconclusive') {
        (
            $null -ne $attempt -and
            $attempt.passed -eq $true -and
            $attempt.terminal.phase -eq 'failed' -and
            $attempt.terminal.code -eq 'skill_route_unproven' -and
            $attempt.terminal.retryable -eq $true -and
            $attempt.physicalAcceptance.fixtureVerified -eq $true -and
            $attempt.physicalAcceptance.routeProbeConclusive -eq $false -and
            $attempt.physicalAcceptance.routeProbeStatus -in @('partial', 'timeout') -and
            $attempt.physicalAcceptance.routeMovementAttempted -eq $false -and
            $attempt.physicalAcceptance.routeTerrainIntact -eq $true -and
            $attempt.stop.stableForTenSeconds -eq $true -and
            [double]$attempt.stop.quiescenceMs -le 2000
        )
    } elseif ($Course -eq 'deliver-item' -or $Course -eq 'orchestrate-charcoal') {
        (
            $null -ne $attempt -and
            $attempt.passed -eq $true -and
            $attempt.physicalAcceptance.fixtureVerified -eq $true -and
            $attempt.physicalAcceptance.deliveryVerified -eq $true -and
            ($Course -ne 'deliver-item' -or $attempt.physicalAcceptance.deliverySourcePresent -eq $true) -and
            $attempt.physicalAcceptance.deliveryGroundPresent -eq $true -and
            $attempt.physicalAcceptance.deliveryDryLandVerified -eq $true -and
            $attempt.stop.stableForTenSeconds -eq $true -and
            [double]$attempt.stop.quiescenceMs -le 2000
        )
    } else {
        (
            $null -ne $attempt -and
            $attempt.passed -eq $true -and
            $attempt.physicalAcceptance.fixtureVerified -eq $true -and
            $attempt.physicalAcceptance.doorwayCrossed -eq $true -and
            $attempt.physicalAcceptance.corridorCompleted -eq $true -and
            $attempt.physicalAcceptance.finalWaypointReached -eq $true -and
            $attempt.stop.stableForTenSeconds -eq $true -and
            [double]$attempt.stop.quiescenceMs -le 2000
        )
    }
    $falseSuccess = $harnessEvidence.passed -eq $true -and -not $physicalEvidenceComplete
    $report.verdict = [ordered]@{
        passed = (
            -not $harnessTimedOut -and
            $harnessExitCode -eq 0 -and
            $harnessEvidence.passed -eq $true -and
            $physicalEvidenceComplete
        )
        duration_ms = [int64]$harnessEvidence.durationMs
        external_retry_count = 0
        false_success_observed = $falseSuccess
    }
    if ($harnessTimedOut) { throw 'Follow field harness exceeded the scenario timeout.' }
    if ($falseSuccess) { throw 'The follow harness claimed success without complete physical evidence.' }
    if ($harnessExitCode -ne 0 -or $harnessEvidence.passed -ne $true -or -not $physicalEvidenceComplete) {
        throw "Scenario course '$Course' did not pass: $($report.verdict | ConvertTo-Json -Compress)"
    }

    $report.status = 'passed'
    Save-Status 'cleaning-up-after-pass'
}
catch {
    $report.status = 'failed'
    $report.error = $_.Exception.Message
    Save-Status 'cleaning-up-after-failure'
}
finally {
    $cleanup = [ordered]@{
        hold_requested = $false
        api_stop_succeeded = $false
        main_forced = $false
        harness_forced = $false
        recorded_trace_forced = $false
        managed_java_fallback_kills = @()
        configuration_restored = $false
        properties_restored = $false
        pre_run_memory_restored = $false
        replay_memory_preserved = $false
        replay_world_preserved = $false
        remaining_managed_java = @()
        remaining_recorded_trace_process = $false
        v2_status = $null
        errors = @()
    }
    try {
        if ($harnessProcess) {
            try {
                $harnessProcess.Refresh()
                if (-not $harnessProcess.HasExited) {
                    Stop-Process -Id $harnessProcess.Id -Force -ErrorAction Stop
                    $cleanup.harness_forced = $true
                }
            } catch {
                $cleanup.errors += "harness stop: $($_.Exception.Message)"
            }
        }
        if ($recordedTraceProcess) {
            try {
                $recordedTraceProcess.Refresh()
                if (-not $recordedTraceProcess.HasExited) {
                    Stop-Process -Id $recordedTraceProcess.Id -Force -ErrorAction Stop
                    $cleanup.recorded_trace_forced = $true
                }
            } catch {
                $cleanup.errors += "recorded trace provider stop: $($_.Exception.Message)"
            }
        }
        try {
            $cleanupHold = Invoke-JsonPost "$baseUrl/api/director/command" @{ agent = 'MindcraftBot'; message = '!stop' } 10
            $cleanup.hold_requested = $cleanupHold.success -eq $true
        } catch {}
        try {
            $stopResult = Invoke-JsonPost "$baseUrl/api/system/stop" @{} 120
            $cleanup.api_stop_succeeded = $stopResult.success -eq $true
            $cleanup.api_stop_result = $stopResult
        } catch {
            $cleanup.api_stop_error = $_.Exception.Message
        }
        Start-Sleep -Seconds 5

        if ($mainProcess) {
            try {
                $mainProcess.Refresh()
                if (-not $mainProcess.HasExited) {
                    Stop-Process -Id $mainProcess.Id -Force -ErrorAction Stop
                    $cleanup.main_forced = $true
                }
            } catch {
                $cleanup.errors += "main stop: $($_.Exception.Message)"
            }
        }

        $managedJar = [IO.Path]::GetFullPath((Join-Path $managed 'server.jar'))
        $managedJava = @(Get-CimInstance Win32_Process | Where-Object {
            ($_.Name -in @('java.exe', 'javaw.exe')) -and $_.CommandLine -like ('*' + $managedJar + '*')
        })
        foreach ($process in $managedJava) {
            try {
                Stop-Process -Id $process.ProcessId -Force -ErrorAction Stop
                $cleanup.managed_java_fallback_kills += $process.ProcessId
            } catch {
                $cleanup.errors += "managed Java stop $($process.ProcessId): $($_.Exception.Message)"
            }
        }
        Start-Sleep -Seconds 2

        if ($runtimeMemoryInstalled -and (Test-Path -LiteralPath $botDir)) {
            Move-Item -LiteralPath $botDir -Destination $postMemory
            $cleanup.replay_memory_preserved = $true
        }
        if ($memoryMoved -and (Test-Path -LiteralPath $preMemory)) {
            Move-Item -LiteralPath $preMemory -Destination $botDir
            $cleanup.pre_run_memory_restored = $true
        } elseif (-not $memoryMoved) {
            $cleanup.pre_run_memory_restored = -not (Test-Path -LiteralPath $botDir)
        }

        if ($backedUp) {
            Copy-Item -LiteralPath $configBackup -Destination $configPath -Force
            Copy-Item -LiteralPath $propertiesBackup -Destination $propertiesPath -Force
            $cleanup.configuration_restored = (
                (Get-FileHash -LiteralPath $configBackup -Algorithm SHA256).Hash -eq
                (Get-FileHash -LiteralPath $configPath -Algorithm SHA256).Hash
            )
            $cleanup.properties_restored = (
                (Get-FileHash -LiteralPath $propertiesBackup -Algorithm SHA256).Hash -eq
                (Get-FileHash -LiteralPath $propertiesPath -Algorithm SHA256).Hash
            )
        }

        if ($worldInstalled -and (Test-Path -LiteralPath $worldPath)) {
            Move-Item -LiteralPath $worldPath -Destination $postWorld
            $cleanup.replay_world_preserved = $true
        } elseif ($sourceExtractPath -and (Test-Path -LiteralPath $sourceExtractPath)) {
            Move-Item -LiteralPath $sourceExtractPath -Destination (Join-Path $runDir 'partial-extracted-world')
            $cleanup.replay_world_preserved = $true
        }
        foreach ($suffix in @('_nether', '_the_end')) {
            $sibling = Join-Path $managed ($worldName + $suffix)
            if (Test-Path -LiteralPath $sibling) {
                Move-Item -LiteralPath $sibling -Destination (Join-Path $runDir ('post-run-world' + $suffix))
            }
        }

        $remainingManaged = @(Get-CimInstance Win32_Process | Where-Object {
            ($_.Name -in @('java.exe', 'javaw.exe')) -and $_.CommandLine -like ('*' + $managedJar + '*')
        } | ForEach-Object { $_.ProcessId })
        $cleanup.remaining_managed_java = $remainingManaged
        if ($recordedTraceProcess) {
            try {
                $recordedTraceProcess.Refresh()
                $cleanup.remaining_recorded_trace_process = -not $recordedTraceProcess.HasExited
            } catch {
                $cleanup.remaining_recorded_trace_process = $false
            }
        }
        $cleanup.v2_status = @(& git -C $repo status --porcelain=v1 --untracked-files=all)
    } catch {
        $cleanup.errors += $_.Exception.Message
    }

    if ($lockAcquired) {
        try { Remove-Item -LiteralPath $markerPath -Force -ErrorAction SilentlyContinue } catch {}
    }
    $report.cleanup = $cleanup
    $report.finished_utc = [DateTime]::UtcNow.ToString('o')
    $report.updated_utc = $report.finished_utc
    $report.phase = 'finished'
    $finalJson = $report | ConvertTo-Json -Depth 50
    [IO.File]::WriteAllText($reportPath, $finalJson + [Environment]::NewLine, [Text.UTF8Encoding]::new($false))
    [IO.File]::WriteAllText($statusPath, $finalJson + [Environment]::NewLine, [Text.UTF8Encoding]::new($false))
}
if ($report.status -ne 'passed') { exit 1 }
