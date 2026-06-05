param(
  [Parameter(Mandatory = $true)]
  [string]$ProfilePath
)

$resolvedProfilePath = [System.IO.Path]::GetFullPath($ProfilePath)
$normalizedProfilePath = $resolvedProfilePath.Replace('/', '\')
$alternateProfilePath = $normalizedProfilePath.Replace('\', '/')
$matchTokens = @(
  $normalizedProfilePath,
  $alternateProfilePath,
  "--user-data-dir=$normalizedProfilePath",
  "--user-data-dir=`"$normalizedProfilePath`"",
  "--user-data-dir=$alternateProfilePath",
  "--user-data-dir=`"$alternateProfilePath`""
)

$matchingChromeProcesses = Get-CimInstance Win32_Process -Filter "Name = 'chrome.exe'" |
  Where-Object {
    $commandLine = $_.CommandLine
    if ([string]::IsNullOrWhiteSpace($commandLine)) {
      return $false
    }

    foreach ($token in $matchTokens) {
      if ($commandLine.IndexOf($token, [System.StringComparison]::OrdinalIgnoreCase) -ge 0) {
        return $true
      }
    }

    return $false
  }

if (-not $matchingChromeProcesses) {
  Write-Host "No Chrome debug-profile process is running."
  exit 0
}

$processIds = $matchingChromeProcesses |
  Select-Object -ExpandProperty ProcessId -Unique |
  Sort-Object

foreach ($processId in $processIds) {
  $process = Get-Process -Id $processId -ErrorAction SilentlyContinue
  try {
    if ($process -and -not $process.HasExited -and $process.MainWindowHandle -ne 0) {
      [void]$process.CloseMainWindow()
    }
  } catch [System.InvalidOperationException] {
    continue
  }
}

Start-Sleep -Seconds 5

foreach ($processId in $processIds) {
  $process = Get-Process -Id $processId -ErrorAction SilentlyContinue
  if ($process -and -not $process.HasExited) {
    Stop-Process -Id $processId -Force
  }
}

Write-Host "Stopped Chrome process(es) using $normalizedProfilePath."
