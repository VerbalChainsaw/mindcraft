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

    [string]$FixtureRoot = ''
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..\..'))
if ([string]::IsNullOrWhiteSpace($FixtureRoot)) {
    $FixtureRoot = $env:SCENARIO_LAB_FOLLOW_FIXTURE_ROOT
}
if ([string]::IsNullOrWhiteSpace($FixtureRoot)) {
    throw 'FixtureRoot or SCENARIO_LAB_FOLLOW_FIXTURE_ROOT must identify the frozen fixture directory.'
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
$directiveRouter = Join-Path $repo 'src\agent\player-directives.js'
$skills = Join-Path $repo 'src\agent\library\skills.js'
$baseUrl = 'http://localhost:8080'
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

function Write-ManagedDesiredState([string]$desiredState) {
    $configuration = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
    $configuration.desiredState = $desiredState
    $configuration.crossplay = $false
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
    $captureOutput = @(& $nodePath $captureScript $runDir $label 2>&1)
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
        $archive,
        $fixtureProfile,
        $fixtureMetadata,
        $configPath,
        $propertiesPath,
        $captureScript,
        $runner,
        $evidenceAdapter,
        $harness,
        $directiveRouter,
        $skills
    )) {
        if (-not (Test-Path -LiteralPath $required)) { throw "Missing required path: $required" }
    }

    $metadata = Get-Content -LiteralPath $fixtureMetadata -Raw | ConvertFrom-Json
    if ([string]$metadata.schema_version -ne 'scenario-lab.fixture.v1') {
        throw 'Unsupported follow fixture metadata schema.'
    }
    if ([string]$metadata.fixture_id -ne 'scenario-lab.doorway-corridor-follow.v1' -or [int]$metadata.fixture_version -ne 1) {
        throw 'Fixture metadata identifies the wrong scenario or version.'
    }
    $sourceWorldName = [string]$metadata.source.world_name
    $sourceSeed = [string]$metadata.source.seed
    $sourceExtractPath = Join-Path $extractRoot $sourceWorldName
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
    if ($dirty.Count -ne 0) {
        throw "Repository must be clean for a registered live replay: $($dirty -join '; ')"
    }

    $archiveHash = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant()
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

    if ($archiveHash -ne $ExpectedFixtureHash) { throw "Archived world hash mismatch: $archiveHash" }
    if ($metadataHash -ne $expectedMetadataHash) { throw 'Fixture metadata hash does not match the registered frozen contract.' }
    if ($profileHash -ne $expectedProfileHash) { throw 'Scenario profile hash does not match the registered frozen contract.' }
    if ($archiveHash -ne [string]$metadata.archive.sha256) { throw 'Archive hash does not match fixture metadata.' }
    if ($profileHash -ne [string]$metadata.profile.sha256) { throw 'Scenario profile hash does not match fixture metadata.' }
    if ([string]$metadata.course_contract.baseline_sha256 -ne $expectedBaselineHash) { throw 'Baseline course contract does not match the registered frozen contract.' }
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
        directive_router = [ordered]@{
            relative_path = 'src/agent/player-directives.js'
            path = $directiveRouter
        }
        gameplay_controller = [ordered]@{
            relative_path = 'src/agent/library/skills.js'
            path = $skills
        }
    }
    $blobChecks = [ordered]@{}
    foreach ($entry in $boundCandidateFiles.GetEnumerator()) {
        $relativePath = [string]$entry.Value.relative_path
        $absolutePath = [string]$entry.Value.path
        $candidateBlob = ((& git -C $repo rev-parse "${ExpectedCandidateCommit}:$relativePath" 2>&1 | Out-String).Trim())
        $currentBlob = ((& git -C $repo hash-object "--path=$relativePath" -- $absolutePath 2>&1 | Out-String).Trim())
        if ($candidateBlob -notmatch '^[a-f0-9]{40}$' -or $currentBlob -ne $candidateBlob) {
            throw "$($entry.Key) does not match the registered candidate commit."
        }
        $blobChecks[$entry.Key] = [ordered]@{
            relative_path = $relativePath
            candidate_blob = $candidateBlob
            current_blob = $currentBlob
            matched = $true
        }
    }
    $report.candidate_blob_checks = $blobChecks
    if ($skillsHash -ne [string]$metadata.candidate.gameplay_skills_sha256) { throw 'Gameplay controller drifted from the frozen fixture contract.' }
    $report.fixture_authorized = $true

    if (Test-Path -LiteralPath $worldPath) { throw "Replay world already exists: $worldPath" }
    if (Test-Path -LiteralPath $sourceExtractPath) { throw "Archive source world unexpectedly exists: $sourceExtractPath" }
    if (@(Get-Process -Name java,javaw -ErrorAction SilentlyContinue).Count -gt 0) {
        $report.conflict = $true
        throw 'Java is already running.'
    }
    foreach ($port in @(8080, 25579)) {
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

    $scenarioProfile = Get-Content -LiteralPath $fixtureProfile -Raw | ConvertFrom-Json
    if ([string]$scenarioProfile.name -ne 'MindcraftBot') {
        throw 'The Scenario Lab fixture profile is not MindcraftBot.'
    }
    if ($null -eq $scenarioProfile.runtime) {
        $scenarioProfile | Add-Member -NotePropertyName runtime -NotePropertyValue ([pscustomobject]@{ autonomy = 'command' }) -Force
    } else {
        $scenarioProfile.runtime | Add-Member -NotePropertyName autonomy -NotePropertyValue 'command' -Force
    }
    $scenarioProfileJson = ($scenarioProfile | ConvertTo-Json -Depth 30) + [Environment]::NewLine
    [IO.File]::WriteAllText($scenarioProfilePath, $scenarioProfileJson, [Text.UTF8Encoding]::new($false))
    $report.startup_isolation.profile_sha256 = (Get-FileHash -LiteralPath $scenarioProfilePath -Algorithm SHA256).Hash.ToLowerInvariant()
    $launchSettingsJson = ([ordered]@{
        auto_start = $true
        auto_open_ui = $false
        init_message = ''
        default_goal = ''
        load_memory = $false
        decision_trace = [ordered]@{
            enabled = ($InstrumentationMode -eq 'on')
            retention = 128
        }
    } | ConvertTo-Json -Compress)

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

    Save-Status 'restoring-archived-world'
    Expand-Archive -LiteralPath $archive -DestinationPath $extractRoot
    if (-not (Test-Path -LiteralPath $sourceExtractPath)) {
        throw "Archive did not restore expected world root: $sourceExtractPath"
    }
    $worldInstalled = $true
    Move-Item -LiteralPath $sourceExtractPath -Destination $worldPath

    Set-ServerProperty $propertiesPath 'level-name' $worldName
    Set-ServerProperty $propertiesPath 'level-seed' $sourceSeed
    Set-ServerProperty $propertiesPath 'difficulty' 'normal'
    Set-ServerProperty $propertiesPath 'gamemode' 'survival'
    Set-ServerProperty $propertiesPath 'online-mode' 'false'
    Set-ServerProperty $propertiesPath 'spawn-protection' '0'
    Write-ManagedDesiredState 'running'
    $configurationChanged = $true

    Save-Status 'starting-runtime'
    $previousSettingsJson = [Environment]::GetEnvironmentVariable('SETTINGS_JSON', [EnvironmentVariableTarget]::Process)
    try {
        [Environment]::SetEnvironmentVariable('SETTINGS_JSON', $launchSettingsJson, [EnvironmentVariableTarget]::Process)
        $mainProcess = Start-Process -FilePath $nodePath -ArgumentList @('main.js', '--profile', $scenarioProfilePath) -WorkingDirectory $repo -PassThru -WindowStyle Hidden -RedirectStandardOutput $stackStdout -RedirectStandardError $stackStderr
    } finally {
        [Environment]::SetEnvironmentVariable('SETTINGS_JSON', $previousSettingsJson, [EnvironmentVariableTarget]::Process)
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

    Save-Status 'placing-operator-hold'
    $hold = Invoke-JsonPost "$baseUrl/api/director/command" @{
        agent = 'MindcraftBot'
        message = '!stop'
    }
    if ($hold.success -ne $true) { throw 'Could not place the replay bot under operator hold.' }
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
        '--mode', 'follow',
        '--course', 'doorway-corridor',
        '--request-file', $requestPath,
        '--authorized-active-world'
    )
    if ($RequestForm -eq 'natural-language') { $harnessArgs += '--natural-language' }
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
    $harnessTimedOut = -not $harnessProcess.WaitForExit($TimeoutMs)
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
    $physicalEvidenceComplete = (
        $null -ne $attempt -and
        $attempt.passed -eq $true -and
        $attempt.physicalAcceptance.fixtureVerified -eq $true -and
        $attempt.physicalAcceptance.doorwayCrossed -eq $true -and
        $attempt.physicalAcceptance.corridorCompleted -eq $true -and
        $attempt.physicalAcceptance.finalWaypointReached -eq $true -and
        $attempt.stop.stableForTenSeconds -eq $true -and
        [double]$attempt.stop.quiescenceMs -le 2000
    )
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
        throw "Doorway/corridor follow did not pass: $($report.verdict | ConvertTo-Json -Compress)"
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
        managed_java_fallback_kills = @()
        configuration_restored = $false
        properties_restored = $false
        pre_run_memory_restored = $false
        replay_memory_preserved = $false
        replay_world_preserved = $false
        remaining_managed_java = @()
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
