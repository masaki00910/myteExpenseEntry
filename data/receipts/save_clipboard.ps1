Add-Type -AssemblyName System.Windows.Forms
$img = [System.Windows.Forms.Clipboard]::GetImage()
if ($img -ne $null) {
    $dir = 'C:\work\2026\20260301_claude_skills_myTE\data\receipts'
    New-Item -ItemType Directory -Force -Path $dir | Out-Null
    $ts = Get-Date -Format 'yyyyMMdd_HHmmss'
    $path = $dir + '\temp_' + $ts + '.png'
    $img.Save($path)
    Write-Output $path
} else {
    Write-Output 'NO_CLIPBOARD_IMAGE'
}
