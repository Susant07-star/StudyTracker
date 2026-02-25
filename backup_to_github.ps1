$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
cd "d:\Productivity\StudyTracker"

$Date = Get-Date -Format "yyyy-MM-dd hh:mm tt"
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  StudyTracker Auto-Backup to GitHub" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Checking for changes..." -ForegroundColor Yellow

$status = git status --porcelain
if ([string]::IsNullOrWhiteSpace($status)) {
    Write-Host "No new changes found! Your code is already safely backed up." -ForegroundColor Green
    Start-Sleep -Seconds 3
    exit
}

Write-Host "Changes found. Saving your code to GitHub..." -ForegroundColor Yellow
git add .
git commit -m "Auto-backup: $Date"
git push

if ($?) {
    Write-Host ""
    Write-Host "========================================" -ForegroundColor Green
    Write-Host "  BACKUP SUCCESSFUL! 🎉" -ForegroundColor Green
    Write-Host "========================================" -ForegroundColor Green
} else {
    Write-Host ""
    Write-Host "========================================" -ForegroundColor Red
    Write-Host "  BACKUP FAILED! ❌" -ForegroundColor Red
    Write-Host "  Please check the error messages above." -ForegroundColor Red
    Write-Host "========================================" -ForegroundColor Red
}

Write-Host ""
Write-Host "Press any key to close this window..."
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
