$WshShell = New-Object -comObject WScript.Shell
$DesktopPath = [Environment]::GetFolderPath("Desktop")
$ShortcutPath = "$DesktopPath\StudyTracker.lnk"
$Shortcut = $WshShell.CreateShortcut($ShortcutPath)

# Try to find Chrome installation path
$chromePaths = @(
    "C:\Program Files\Google\Chrome\Application\chrome.exe",
    "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
)

$chromeExe = "chrome.exe" # Fallback to PATH
foreach ($path in $chromePaths) {
    if (Test-Path $path) {
        $chromeExe = $path
        break
    }
}

$Shortcut.TargetPath = $chromeExe
$Shortcut.Arguments = "--app=`"d:\Productivity\StudyTracker\index.html`""
$Shortcut.IconLocation = "d:\Productivity\StudyTracker\favicon.ico"
$Shortcut.Save()
Write-Output "Shortcut created successfully at $ShortcutPath opening via Chrome."
