$ErrorActionPreference = 'Stop'
$crmNodeCommand = Get-Command node -ErrorAction SilentlyContinue
$crmNodePath = if ($crmNodeCommand) { $crmNodeCommand.Source } else { Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' }
if (-not (Test-Path -LiteralPath $crmNodePath)) { throw 'Node.js is required. Install Node.js 20 or later.' }
Set-Location -LiteralPath $PSScriptRoot
Write-Host 'AdVance CRM: http://127.0.0.1:4173'
Write-Host 'Keep this terminal open while using the CRM. Ctrl+C stops the local server.'
& $crmNodePath (Join-Path $PSScriptRoot 'server.cjs')
