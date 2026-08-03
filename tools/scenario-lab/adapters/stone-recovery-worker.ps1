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

    [ValidateRange(1000, 3600000)]
    [int]$TimeoutMs = 600000,

    [string]$FixtureRoot = ''
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..\..'))
if ([string]::IsNullOrWhiteSpace($FixtureRoot)) {
    $FixtureRoot = if (-not [string]::IsNullOrWhiteSpace($env:SCENARIO_LAB_STONE_FIXTURE_ROOT)) {
        $env:SCENARIO_LAB_STONE_FIXTURE_ROOT
    } else {
        'C:\Users\zerop\Development\JordanWorkspace\artifacts\minecraft-viability\autonomy-unseen-02-20260802-164450'
    }
}
$archive = Join-Path $FixtureRoot 'trial-world.zip'
$archivedMemory = Join-Path $FixtureRoot 'trial-bot-memory'
$managed = Join-Path $repo 'server_data\managed-java'
$configPath = Join-Path $managed 'mindcraft-server.json'
$propertiesPath = Join-Path $managed 'server.properties'
$botDir = Join-Path $repo 'bots\MindcraftBot'
$profilePath = Join-Path $archivedMemory 'last_profile.json'
$captureScript = Join-Path $PSScriptRoot 'capture-agent-state.mjs'
$baseUrl = 'http://localhost:8080'
$expectedSkillsHash = 'CC524C4CEAFCCB4B850B7F3E65BB705E5E843E2268F94AFA3D11052E4D3A21A5'
$expectedArchiveHash = $ExpectedFixtureHash.ToUpperInvariant()
$sourceWorldName = 'viability-unseen-02-20260802-164450'
$sourceSeed = '8781215452871762684'
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss-fff'
$worldName = "scenario-lab-stone-recovery-$RequestForm-$stamp"
$runDir = [IO.Path]::GetFullPath($OutputDirectory)
$scenarioProfilePath = Join-Path $runDir 'scenario-profile.json'
$statusPath = Join-Path $runDir 'active-live-status.json'
$reportPath = Join-Path $runDir 'live-report.json'
$stackStdout = Join-Path $runDir 'stack-stdout.log'
$stackStderr = Join-Path $runDir 'stack-stderr.log'
$worldPath = Join-Path $managed $worldName
$extractRoot = Join-Path $runDir 'archive-extract'
$sourceExtractPath = Join-Path $extractRoot $sourceWorldName
$preMemory = Join-Path $runDir 'pre-run-bot-memory'
$postMemory = Join-Path $runDir 'post-run-bot-memory'
$postWorld = Join-Path $runDir 'post-run-world'
$configBackup = Join-Path $runDir 'pre-run-mindcraft-server.json'
$propertiesBackup = Join-Path $runDir 'pre-run-server.properties'
$markerPath = Join-Path $managed 'scenario-lab-stone-recovery.active'
$nodePath = $null
$mainProcess = $null
$backedUp = $false
$memoryMoved = $false
$runtimeMemoryInstalled = $false
$worldInstalled = $false
$configurationChanged = $false
$lockAcquired = $false

$report = [ordered]@{
    schema_version = 2
    status = 'running'
    phase = 'preflight'
    started_utc = [DateTime]::UtcNow.ToString('o')
    updated_utc = [DateTime]::UtcNow.ToString('o')
    request_form = $RequestForm
    request_message = $RequestMessage
    candidate_commit = $ExpectedCandidateCommit
    fixture_authorized = $false
    conflict = $false
    branch = $null
    current_head = $null
    gameplay_file = 'src/agent/library/skills.js'
    candidate_sha256 = $null
    source_trial = 'autonomy-unseen-02-20260802-164450'
    source_seed = $sourceSeed
    source_archive_sha256 = $null
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
        pre_command_last_result = $null
    }
    health = $null
    before = $null
    command = $null
    observations = @()
    final = $null
    verdict = $null
    cleanup = $null
    error = $null
}

function Save-Status([string]$phase) {
    $report.phase = $phase
    $report.updated_utc = [DateTime]::UtcNow.ToString('o')
    $json = $report | ConvertTo-Json -Depth 24
    [IO.File]::WriteAllText($statusPath, $json + [Environment]::NewLine, [Text.UTF8Encoding]::new($false))
}

function Invoke-JsonPost([string]$uri, [hashtable]$body, [int]$timeoutSeconds = 30) {
    Invoke-RestMethod -Method Post -Uri $uri -ContentType 'application/json' -Body ($body | ConvertTo-Json -Depth 10 -Compress) -TimeoutSec $timeoutSeconds
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
        main_hand = $state.body.mainHand
        inventory = $state.inventory.counts
        action_current = $state.action.current
        action_idle = $state.action.isIdle
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
    $summary = Summarize-State $state
    $report.observations += $summary
    $report.current_observation = $summary
    Save-Status "observing-$label"
    return $state
}

if (Test-Path -LiteralPath $runDir) {
    throw "Output directory already exists: $runDir"
}
New-Item -ItemType Directory -Path $runDir | Out-Null
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
        throw 'Another stone-recovery Scenario Lab invocation owns the managed runtime.'
    }

    foreach ($required in @($repo, $archive, $archivedMemory, $configPath, $propertiesPath, $profilePath, $captureScript)) {
        if (-not (Test-Path -LiteralPath $required)) { throw "Missing required path: $required" }
    }
    $branch = ((& git -C $repo branch --show-current 2>&1 | Out-String).Trim())
    $head = ((& git -C $repo rev-parse HEAD 2>&1 | Out-String).Trim())
    & git -C $repo merge-base --is-ancestor $ExpectedCandidateCommit HEAD 2>$null
    if ($LASTEXITCODE -ne 0) {
        throw "Candidate commit $ExpectedCandidateCommit is not an ancestor of current HEAD $head."
    }
    $dirty = @(& git -C $repo status --porcelain=v1 --untracked-files=all)
    $unexpectedDirty = @($dirty | Where-Object {
        $dirtyPath = if ($_.Length -gt 3) { $_.Substring(3).Trim() } else { '' }
        $dirtyPath -notmatch '^(tools/scenario-lab\.mjs$|tools/scenario-lab(?:/|$)|tests/control-plane/scenario-lab\.test\.js$|docs/architecture/machine-brain-v2/(?:SCENARIO-LAB|A0-IMPLEMENTATION-STATUS)\.md$|package\.json$)'
    })
    $skillsHash = (Get-FileHash -LiteralPath (Join-Path $repo 'src\agent\library\skills.js') -Algorithm SHA256).Hash
    $archiveHash = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash
    $report.branch = $branch
    $report.current_head = $head
    $report.candidate_sha256 = $skillsHash.ToLowerInvariant()
    $report.source_archive_sha256 = $archiveHash.ToLowerInvariant()
    if ($unexpectedDirty.Count -gt 0) {
        throw "Unexpected non-lab worktree changes: $($unexpectedDirty -join '; ')"
    }
    if ($skillsHash -ne $expectedSkillsHash) { throw "Unexpected skills.js hash: $skillsHash" }
    if ($archiveHash -ne $expectedArchiveHash) { throw "Archived world hash mismatch: $archiveHash" }
    $report.fixture_authorized = $true
    if (Test-Path -LiteralPath $worldPath) { throw "Replay world already exists: $worldPath" }
    if (Test-Path -LiteralPath $sourceExtractPath) { throw "Archive source world unexpectedly exists: $sourceExtractPath" }
    if (@(Get-Process -Name java -ErrorAction SilentlyContinue).Count -gt 0) {
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

    $scenarioProfile = Get-Content -LiteralPath $profilePath -Raw | ConvertFrom-Json
    if ([string]$scenarioProfile.name -ne 'MindcraftBot') {
        throw 'The Scenario Lab source profile is not MindcraftBot.'
    }
    if ($null -eq $scenarioProfile.runtime) {
        $scenarioProfile | Add-Member -NotePropertyName runtime -NotePropertyValue ([pscustomobject]@{ autonomy = 'command' }) -Force
    } else {
        $scenarioProfile.runtime | Add-Member -NotePropertyName autonomy -NotePropertyValue 'command' -Force
    }
    $scenarioProfileJson = ($scenarioProfile | ConvertTo-Json -Depth 24) + [Environment]::NewLine
    [IO.File]::WriteAllText($scenarioProfilePath, $scenarioProfileJson, [Text.UTF8Encoding]::new($false))
    $report.startup_isolation.profile_sha256 = (Get-FileHash -LiteralPath $scenarioProfilePath -Algorithm SHA256).Hash.ToLowerInvariant()
    $launchSettingsJson = ([ordered]@{
        auto_start = $true
        auto_open_ui = $false
        init_message = ''
        default_goal = ''
        load_memory = $false
    } | ConvertTo-Json -Compress)

    Save-Status 'backing-up-runtime'
    Copy-Item -LiteralPath $configPath -Destination $configBackup
    Copy-Item -LiteralPath $propertiesPath -Destination $propertiesBackup
    $backedUp = $true

    if (Test-Path -LiteralPath $botDir) {
        Move-Item -LiteralPath $botDir -Destination $preMemory
        $memoryMoved = $true
    }
    $runtimeMemoryInstalled = $true
    Copy-Item -LiteralPath $archivedMemory -Destination $botDir -Recurse

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

    $beforeState = Capture-State 'before-command'
    $beforeSummary = Summarize-State $beforeState
    $report.before = $beforeSummary
    $report.startup_isolation.pre_command_last_result = $beforeState.action.lastResult
    if ($null -ne $beforeState.action.lastResult -and [string]$beforeState.action.lastResult.label -eq 'action:prepareTool') {
        throw 'Startup isolation failed: prepareTool ran before the measured request.'
    }
    $beforeCounts = $beforeState.inventory.counts
    $beforePosition = $beforeState.gameplay.position
    if ([int]($beforeCounts.wooden_pickaxe) -lt 1) { throw 'Archived replay did not restore the wooden pickaxe precondition.' }
    if ([int]($beforeCounts.stone_pickaxe) -gt 0) { throw 'Archived replay already contains a stone pickaxe.' }
    if ([int]($beforeCounts.cobblestone) -gt 0) { throw 'Archived replay no longer begins at the zero-cobblestone failure state.' }
    if ([Math]::Abs([double]$beforePosition.x - 503.33) -gt 2 -or [Math]::Abs([double]$beforePosition.y - 77) -gt 2 -or [Math]::Abs([double]$beforePosition.z - 604.55) -gt 2) {
        throw "Archived replay position drifted from the recorded failure: $($beforePosition | ConvertTo-Json -Compress)"
    }

    Save-Status 'dispatching-stone-pickaxe'
    $commandStartedAt = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
    $commandResponse = Invoke-JsonPost "$baseUrl/api/director/command" @{
        agent = 'MindcraftBot'
        message = $RequestMessage
    }
    $report.command = [ordered]@{
        form = $RequestForm
        message = $RequestMessage
        started_at_unix_ms = $commandStartedAt
        response = $commandResponse
    }
    if ($commandResponse.success -ne $true) { throw 'Stone-pickaxe command was not accepted.' }

    $deadline = [DateTime]::UtcNow.AddMilliseconds($TimeoutMs)
    $passed = $false
    $terminalFailure = $null
    $sampleIndex = 0
    $finalState = $null
    while ([DateTime]::UtcNow -lt $deadline) {
        Start-Sleep -Seconds 2
        $sampleIndex += 1
        $state = Capture-State ("after-command-{0:d2}" -f $sampleIndex)
        $finalState = $state
        $counts = $state.inventory.counts
        $lastResult = $state.action.lastResult
        $hasStonePickaxe = [int]($counts.stone_pickaxe) -ge 1
        $stoneInHand = [string]$state.body.mainHand -eq 'stone_pickaxe'
        $matchingResult = (
            $null -ne $lastResult -and
            [string]$lastResult.label -eq 'action:prepareTool' -and
            [double]$lastResult.startedAt -ge ($commandStartedAt - 5000)
        )
        if ($hasStonePickaxe -and $stoneInHand -and $matchingResult -and [string]$lastResult.phase -eq 'succeeded') {
            $passed = $true
            break
        }
        if ($matchingResult -and [string]$lastResult.phase -eq 'failed') {
            $terminalFailure = $lastResult
            break
        }
    }
    if ($null -eq $finalState) { $finalState = Capture-State 'after-command-timeout' }

    $finalSummary = Summarize-State $finalState
    $report.final = $finalSummary
    $dx = [double]$finalState.gameplay.position.x - [double]$beforePosition.x
    $dy = [double]$finalState.gameplay.position.y - [double]$beforePosition.y
    $dz = [double]$finalState.gameplay.position.z - [double]$beforePosition.z
    $movement = [Math]::Sqrt(($dx * $dx) + ($dy * $dy) + ($dz * $dz))
    $report.verdict = [ordered]@{
        passed = $passed
        stone_pickaxe_count = [int]($finalState.inventory.counts.stone_pickaxe)
        main_hand = [string]$finalState.body.mainHand
        displacement_blocks = [Math]::Round($movement, 3)
        health = $finalState.gameplay.health
        hunger = $finalState.gameplay.hunger
        terminal_result = $finalState.action.lastResult
        terminal_failure = $terminalFailure
        duration_ms = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() - $commandStartedAt
        external_retry_count = 0
        false_success_observed = (
            [string]$finalState.action.lastResult.phase -eq 'succeeded' -and
            [int]($finalState.inventory.counts.stone_pickaxe) -lt 1
        )
    }
    if (-not $passed) {
        throw "Exact-world stone recovery did not pass: $($report.verdict | ConvertTo-Json -Depth 10 -Compress)"
    }
    if ($report.verdict.false_success_observed) { throw 'A false success was observed.' }

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
        } elseif (Test-Path -LiteralPath $sourceExtractPath) {
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
    $finalJson = $report | ConvertTo-Json -Depth 24
    [IO.File]::WriteAllText($reportPath, $finalJson + [Environment]::NewLine, [Text.UTF8Encoding]::new($false))
    [IO.File]::WriteAllText($statusPath, $finalJson + [Environment]::NewLine, [Text.UTF8Encoding]::new($false))
}
if ($report.status -ne 'passed') { exit 1 }