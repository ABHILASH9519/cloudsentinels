$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$serverEnv = Join-Path $repoRoot '.env.local'
$frontendEnv = Join-Path $repoRoot 'src/frontend/.env.local'

function Read-RequiredValue([string]$Prompt) {
    do { $value = (Read-Host $Prompt).Trim() } while ([string]::IsNullOrWhiteSpace($value))
    return $value
}

function Set-DotEnvValues([string]$Path, [hashtable]$Values) {
    $lines = [System.Collections.Generic.List[string]]::new()
    if (Test-Path $Path) { foreach ($line in Get-Content -LiteralPath $Path) { $lines.Add([string]$line) } }    foreach ($key in $Values.Keys) {
        $pattern = '^\s*' + [regex]::Escape($key) + '\s*='
        $replacement = $key + '=' + [string]$Values[$key]
        $found = $false
        for ($i = 0; $i -lt $lines.Count; $i++) {
            if ($lines[$i] -match $pattern) {
                if (-not $found) { $lines[$i] = $replacement; $found = $true } else { $lines[$i] = $null }
            }
        }
        for ($i = $lines.Count - 1; $i -ge 0; $i--) { if ($null -eq $lines[$i]) { $lines.RemoveAt($i) } }
        if (-not $found) { $lines.Add($replacement) }
    }
    $parent = Split-Path -Parent $Path
    New-Item -ItemType Directory -Force -Path $parent | Out-Null
    [System.IO.File]::WriteAllLines($Path, $lines, [System.Text.UTF8Encoding]::new($false))
}

Write-Host 'CloudSentinels local Firebase configuration' -ForegroundColor Cyan
Write-Host 'Web app values are public Firebase client configuration. Admin credentials remain in a separate file outside this repository.'
$projectId = Read-RequiredValue 'Firebase project ID'
$apiKey = Read-RequiredValue 'Firebase Web API key'
$authDomain = Read-RequiredValue 'Firebase Auth domain (for example project-id.firebaseapp.com)'
$appId = Read-RequiredValue 'Firebase Web App ID'
$serviceAccountInput = Read-RequiredValue 'Absolute path to Firebase Admin service-account JSON (outside this repository)'

$serviceAccountPath = (Resolve-Path -LiteralPath $serviceAccountInput).Path
$repoFull = [System.IO.Path]::GetFullPath($repoRoot).TrimEnd([char]'\') + [System.IO.Path]::DirectorySeparatorChar
if ($serviceAccountPath.StartsWith($repoFull, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw 'Store the Firebase Admin service-account JSON outside the repository; no private key may be stored in the project tree.'
}
$serviceAccount = Get-Content -LiteralPath $serviceAccountPath -Raw | ConvertFrom-Json
if ($serviceAccount.type -ne 'service_account' -or [string]::IsNullOrWhiteSpace($serviceAccount.private_key) -or [string]::IsNullOrWhiteSpace($serviceAccount.client_email)) {
    throw 'The selected JSON is not a valid Firebase Admin service-account credential file.'
}
if ($serviceAccount.project_id -ne $projectId) {
    throw 'Firebase Web project ID and Admin service-account project_id do not match.'
}
if ($authDomain -notmatch '^[A-Za-z0-9.-]+$' -or $apiKey -match '[\r\n]' -or $appId -match '[\r\n]') {
    throw 'One or more Firebase Web configuration values have an invalid format.'
}

$normalizedCredentialPath = $serviceAccountPath.Replace('\', '/')
Set-DotEnvValues $frontendEnv @{
    VITE_FIREBASE_API_KEY = $apiKey
    VITE_FIREBASE_AUTH_DOMAIN = $authDomain
    VITE_FIREBASE_PROJECT_ID = $projectId
    VITE_FIREBASE_APP_ID = $appId
}
Set-DotEnvValues $serverEnv @{
    FIREBASE_PROJECT_ID = $projectId
    GOOGLE_APPLICATION_CREDENTIALS = $normalizedCredentialPath
}

Write-Host 'Firebase configuration written to ignored local environment files.' -ForegroundColor Green
Write-Host 'No Admin private key was copied into the repository or frontend environment.'
Write-Host 'Restart the local API and Vite frontend, then verify /readyz and sign-in.'
