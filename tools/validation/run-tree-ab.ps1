[CmdletBinding()]
param(
    [string]$FixtureRoot = $env:MINECRAFT_VALIDATION_FIXTURE_ROOT,
    [string]$OutputRoot = $env:MINECRAFT_VALIDATION_OUTPUT_ROOT,
    [ValidateRange(1000, 3600000)]
    [int]$ActionTimeoutMs = 120000
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$workspace = 'C:\Users\zerop\Development\JordanWorkspace'
if ([string]::IsNullOrWhiteSpace($FixtureRoot)) {
    $FixtureRoot = Join-Path $workspace 'artifacts\minecraft-validation\fixtures\doorway-corridor-follow-v1'
}
if ([string]::IsNullOrWhiteSpace($OutputRoot)) {
    $OutputRoot = Join-Path $workspace 'artifacts\minecraft-validation\results'
}
$fixtureRoot = [IO.Path]::GetFullPath($FixtureRoot)
$outputRoot = [IO.Path]::GetFullPath($OutputRoot)
$archive = Join-Path $fixtureRoot 'follow-world.zip'
$fixtureProfile = Join-Path $fixtureRoot 'scenario-profile.json'
$managed = Join-Path $repo 'server_data\managed-java'
$configPath = Join-Path $managed 'mindcraft-server.json'
$propertiesPath = Join-Path $managed 'server.properties'
$botDir = Join-Path $repo 'bots\MindcraftBot'
$runner = Join-Path $PSScriptRoot 'tree-ab-runner.mjs'
$baseUrl = 'http://localhost:8080'
$sourceWorldName = 'viability-pilot-disposable'
$sourceSeed = '3579780610592225162'
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss-fff'
$runDir = Join-Path $outputRoot ("tree-ab-$stamp")
$worldName = "practical-tree-ab-$stamp"
$worldPath = Join-Path $managed $worldName
$extractRoot = Join-Path $runDir 'archive-extract'
$sourceExtractPath = Join-Path $extractRoot $sourceWorldName
$scenarioProfilePath = Join-Path $runDir 'scenario-profile.json'
$resultPath = Join-Path $runDir 'tree-ab-result.json'
$wrapperReportPath = Join-Path $runDir 'wrapper-report.json'
$stackStdout = Join-Path $runDir 'stack-stdout.log'
$stackStderr = Join-Path $runDir 'stack-stderr.log'
$runnerStdout = Join-Path $runDir 'runner-stdout.log'
$runnerStderr = Join-Path $runDir 'runner-stderr.log'
$configBackup = Join-Path $runDir 'pre-run-mindcraft-server.json'
$propertiesBackup = Join-Path $runDir 'pre-run-server.properties'
$preMemory = Join-Path $runDir 'pre-run-bot-memory'
$mainProcess = $null
$nodePath = $null
$backedUp = $false
$memoryMoved = $false
$runtimeMemoryInstalled = $false
$worldInstalled = $false
$configurationChanged = $false
$runnerExitCode = $null
$runError = $null

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

function Invoke-JsonPost([string]$uri, [hashtable]$body, [int]$timeoutSeconds = 30) {
    Invoke-RestMethod -Method Post -Uri $uri -ContentType 'application/json' -Body ($body | ConvertTo-Json -Depth 12 -Compress) -TimeoutSec $timeoutSeconds
}

function Write-Json([string]$path, $value) {
    $json = ($value | ConvertTo-Json -Depth 50) + [Environment]::NewLine
    [IO.File]::WriteAllText($path, $json, [Text.UTF8Encoding]::new($false))
}

function Get-HarnessOwnedNodeProcesses {
    @(Get-CimInstance Win32_Process | Where-Object {
        $_.Name -eq 'node.exe' -and
        $_.CommandLine -like '*main.js*--profile*JordanWorkspace*artifacts*minecraft-validation*results*tree-ab-*scenario-profile.json*'
    })
}

New-Item -ItemType Directory -Path $runDir -Force | Out-Null
$cleanup = [ordered]@{
    api_stop_succeeded = $false
    main_forced = $false
    preflight_harness_node_kills = @()
    harness_node_kills = @()
    managed_java_kills = @()
    runtime_memory_removed = $false
    original_memory_restored = $false
    configuration_restored = $false
    properties_restored = $false
    disposable_world_removed = $false
    remaining_harness_node = @()
    remaining_managed_java = @()
    errors = @()
}

try {
    if (-not (Test-Path -LiteralPath $archive)) { throw "Missing fixture archive: $archive" }
    if (-not (Test-Path -LiteralPath $fixtureProfile)) { throw "Missing fixture profile: $fixtureProfile" }
    if (-not (Test-Path -LiteralPath $runner)) { throw "Missing A/B runner: $runner" }
    if (-not (Test-Path -LiteralPath $configPath)) { throw "Missing managed server config: $configPath" }
    if (-not (Test-Path -LiteralPath $propertiesPath)) { throw "Missing server properties: $propertiesPath" }
    if (Test-Path -LiteralPath $worldPath) { throw "Disposable world already exists: $worldPath" }
    foreach ($process in @(Get-HarnessOwnedNodeProcesses)) {
        Stop-Process -Id $process.ProcessId -Force -ErrorAction Stop
        $cleanup.preflight_harness_node_kills += $process.ProcessId
    }
    if ($cleanup.preflight_harness_node_kills.Count -gt 0) { Start-Sleep -Seconds 1 }
    if (@(Get-Process -Name java,javaw -ErrorAction SilentlyContinue).Count -gt 0) { throw 'Java is already running.' }
    foreach ($port in @(8080, 25579)) {
        if (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue) {
            throw "Port $port is already listening."
        }
    }

    $nodePath = (Get-Command node.exe -ErrorAction Stop).Source
    & $nodePath --check $runner
    if ($LASTEXITCODE -ne 0) { throw 'Tree A/B runner failed syntax validation.' }

    $branch = ((& git -C $repo branch --show-current 2>&1 | Out-String).Trim())
    $head = ((& git -C $repo rev-parse HEAD 2>&1 | Out-String).Trim())
    $dirty = @(& git -C $repo status --porcelain)
    if ($branch -ne 'architecture/machine-brain-v2') { throw "Unexpected V2 branch: $branch" }

    $scenarioProfile = Get-Content -LiteralPath $fixtureProfile -Raw | ConvertFrom-Json
    if ([string]$scenarioProfile.name -ne 'MindcraftBot') { throw 'Fixture profile is not MindcraftBot.' }
    if ($null -eq $scenarioProfile.runtime) {
        $scenarioProfile | Add-Member -NotePropertyName runtime -NotePropertyValue ([pscustomobject]@{ autonomy = 'command' }) -Force
    } else {
        $scenarioProfile.runtime | Add-Member -NotePropertyName autonomy -NotePropertyValue 'command' -Force
    }
    [IO.File]::WriteAllText(
        $scenarioProfilePath,
        (($scenarioProfile | ConvertTo-Json -Depth 30) + [Environment]::NewLine),
        [Text.UTF8Encoding]::new($false)
    )

    Copy-Item -LiteralPath $configPath -Destination $configBackup
    Copy-Item -LiteralPath $propertiesPath -Destination $propertiesBackup
    $backedUp = $true

    if (Test-Path -LiteralPath $botDir) {
        Move-Item -LiteralPath $botDir -Destination $preMemory
        $memoryMoved = $true
    }
    New-Item -ItemType Directory -Path $botDir | Out-Null
    $runtimeMemoryInstalled = $true

    Expand-Archive -LiteralPath $archive -DestinationPath $extractRoot
    if (-not (Test-Path -LiteralPath $sourceExtractPath)) {
        throw "Fixture archive did not contain $sourceWorldName."
    }
    Move-Item -LiteralPath $sourceExtractPath -Destination $worldPath
    $worldInstalled = $true

    Set-ServerProperty $propertiesPath 'level-name' $worldName
    Set-ServerProperty $propertiesPath 'level-seed' $sourceSeed
    Set-ServerProperty $propertiesPath 'difficulty' 'peaceful'
    Set-ServerProperty $propertiesPath 'gamemode' 'survival'
    Set-ServerProperty $propertiesPath 'online-mode' 'false'
    Set-ServerProperty $propertiesPath 'spawn-protection' '0'
    Write-ManagedDesiredState 'running'
    $configurationChanged = $true

    $launchSettingsJson = ([ordered]@{
        auto_start = $true
        auto_open_ui = $false
        init_message = ''
        default_goal = ''
        load_memory = $false
        decision_trace = [ordered]@{
            enabled = $false
            retention = 128
        }
    } | ConvertTo-Json -Compress)

    $previousSettingsJson = [Environment]::GetEnvironmentVariable('SETTINGS_JSON', [EnvironmentVariableTarget]::Process)
    try {
        [Environment]::SetEnvironmentVariable('SETTINGS_JSON', $launchSettingsJson, [EnvironmentVariableTarget]::Process)
        $mainProcess = Start-Process -FilePath $nodePath -ArgumentList @('main.js', '--profile', $scenarioProfilePath) -WorkingDirectory $repo -PassThru -WindowStyle Hidden -RedirectStandardOutput $stackStdout -RedirectStandardError $stackStderr
    } finally {
        [Environment]::SetEnvironmentVariable('SETTINGS_JSON', $previousSettingsJson, [EnvironmentVariableTarget]::Process)
    }
    if ($null -eq $mainProcess) { throw 'Isolated Mindcraft launcher did not start.' }

    $readyDeadline = [DateTime]::UtcNow.AddMinutes(3)
    $ready = $false
    while ([DateTime]::UtcNow -lt $readyDeadline) {
        $mainProcess.Refresh()
        if ($mainProcess.HasExited) { throw "Mindcraft launcher exited during boot with code $($mainProcess.ExitCode)." }
        try {
            $health = Invoke-RestMethod -Uri "$baseUrl/api/health" -Method Get -TimeoutSec 5
            $agents = Invoke-RestMethod -Uri "$baseUrl/api/agents" -Method Get -TimeoutSec 5
            $bot = @($agents.agents | Where-Object { $_.name -eq 'MindcraftBot' }) | Select-Object -First 1
            if ($health.checks.minecraftReachable -eq $true -and $bot.state -eq 'running' -and $bot.in_game -eq $true -and $bot.socket_connected -eq $true) {
                $ready = $true
                break
            }
        } catch {}
        Start-Sleep -Seconds 2
    }
    if (-not $ready) { throw 'Mindcraft runtime did not become world-ready within three minutes.' }

    $hold = Invoke-JsonPost "$baseUrl/api/director/command" @{ agent = 'MindcraftBot'; message = '!stop' }
    if ($hold.success -ne $true) { throw 'Could not place MindcraftBot under operator hold before A/B run.' }
    Start-Sleep -Seconds 2

    $runnerProcess = Start-Process -FilePath $nodePath -ArgumentList @($runner, $repo, $resultPath, $baseUrl, [string]$ActionTimeoutMs) -WorkingDirectory $repo -PassThru -Wait -NoNewWindow -RedirectStandardOutput $runnerStdout -RedirectStandardError $runnerStderr
    $runnerExitCode = $runnerProcess.ExitCode
    if (-not (Test-Path -LiteralPath $resultPath)) {
        $stderrText = if (Test-Path -LiteralPath $runnerStderr) { Get-Content -LiteralPath $runnerStderr -Raw } else { '' }
        throw "Tree A/B runner did not produce a result (exit $runnerExitCode): $stderrText"
    }
}
catch {
    $runError = $_.Exception.Message
}
finally {
    try {
        try {
            $stop = Invoke-JsonPost "$baseUrl/api/system/stop" @{} 120
            $cleanup.api_stop_succeeded = $stop.success -eq $true
        } catch {
            $cleanup.errors += "API stop: $($_.Exception.Message)"
        }
        Start-Sleep -Seconds 4

        if ($mainProcess) {
            try {
                $mainProcess.Refresh()
                if (-not $mainProcess.HasExited) {
                    Stop-Process -Id $mainProcess.Id -Force -ErrorAction Stop
                    $cleanup.main_forced = $true
                }
            } catch {
                $cleanup.errors += "Launcher stop: $($_.Exception.Message)"
            }
        }
        foreach ($process in @(Get-HarnessOwnedNodeProcesses)) {
            try {
                Stop-Process -Id $process.ProcessId -Force -ErrorAction Stop
                $cleanup.harness_node_kills += $process.ProcessId
            } catch {
                $cleanup.errors += "Harness Node stop $($process.ProcessId): $($_.Exception.Message)"
            }
        }

        $managedJar = [IO.Path]::GetFullPath((Join-Path $managed 'server.jar'))
        $managedJava = @(Get-CimInstance Win32_Process | Where-Object {
            ($_.Name -in @('java.exe', 'javaw.exe')) -and $_.CommandLine -like ('*' + $managedJar + '*')
        })
        foreach ($process in $managedJava) {
            try {
                Stop-Process -Id $process.ProcessId -Force -ErrorAction Stop
                $cleanup.managed_java_kills += $process.ProcessId
            } catch {
                $cleanup.errors += "Managed Java stop $($process.ProcessId): $($_.Exception.Message)"
            }
        }
        Start-Sleep -Seconds 2

        if ($runtimeMemoryInstalled -and (Test-Path -LiteralPath $botDir)) {
            Remove-Item -LiteralPath $botDir -Recurse -Force
            $cleanup.runtime_memory_removed = $true
        }
        if ($memoryMoved -and (Test-Path -LiteralPath $preMemory)) {
            Move-Item -LiteralPath $preMemory -Destination $botDir
            $cleanup.original_memory_restored = $true
        } elseif (-not $memoryMoved) {
            $cleanup.original_memory_restored = -not (Test-Path -LiteralPath $botDir)
        }

        if ($backedUp -and (Test-Path -LiteralPath $configBackup)) {
            Copy-Item -LiteralPath $configBackup -Destination $configPath -Force
            $cleanup.configuration_restored = $true
        }
        if ($backedUp -and (Test-Path -LiteralPath $propertiesBackup)) {
            Copy-Item -LiteralPath $propertiesBackup -Destination $propertiesPath -Force
            $cleanup.properties_restored = $true
        }
        if ($worldInstalled -and (Test-Path -LiteralPath $worldPath)) {
            Remove-Item -LiteralPath $worldPath -Recurse -Force
            $cleanup.disposable_world_removed = $true
        }
    } catch {
        $cleanup.errors += "Cleanup: $($_.Exception.Message)"
    }

    try {
        $cleanup.remaining_harness_node = @(Get-HarnessOwnedNodeProcesses | ForEach-Object { $_.ProcessId })
        $managedJar = [IO.Path]::GetFullPath((Join-Path $managed 'server.jar'))
        $cleanup.remaining_managed_java = @(Get-CimInstance Win32_Process | Where-Object {
            ($_.Name -in @('java.exe', 'javaw.exe')) -and $_.CommandLine -like ('*' + $managedJar + '*')
        } | ForEach-Object { $_.ProcessId })
    } catch {
        $cleanup.errors += "Final Java check: $($_.Exception.Message)"
    }

    $result = $null
    if (Test-Path -LiteralPath $resultPath) {
        try { $result = Get-Content -LiteralPath $resultPath -Raw | ConvertFrom-Json } catch {}
    }
    $wrapperReport = [ordered]@{
        schema_version = 'minecraft-tree-ab-wrapper.v1'
        generated_utc = [DateTime]::UtcNow.ToString('o')
        repo = $repo
        branch = if (Test-Path -LiteralPath $repo) { ((& git -C $repo branch --show-current 2>$null | Out-String).Trim()) } else { $null }
        head = if (Test-Path -LiteralPath $repo) { ((& git -C $repo rev-parse HEAD 2>$null | Out-String).Trim()) } else { $null }
        worktree_status_before = @($dirty)
        runner_exit_code = $runnerExitCode
        error = $runError
        result_path = $resultPath
        result_summary = $result.summary
        cleanup = $cleanup
    }
    Write-Json $wrapperReportPath $wrapperReport
}

Get-Content -LiteralPath $wrapperReportPath -Raw
if ($runError) { exit 1 }
if ($runnerExitCode -ne 0) { exit $runnerExitCode }
exit 0
