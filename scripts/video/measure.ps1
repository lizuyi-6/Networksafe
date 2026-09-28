function Measure-Dir($dir) {
  $res = @{}
  Get-ChildItem "$dir\seg*.mp3" | ForEach-Object {
    $d = [double](& ffprobe -v error -show_entries format=duration -of csv=p=0 $_.FullName)
    $o = & ffmpeg -i $_.FullName -af "silencedetect=noise=-35dB:d=0.25" -f null - 2>&1 | Out-String
    $events = [regex]::Matches($o, "silence_(start|end): ([\d.]+)") | ForEach-Object { @{ kind=$_.Groups[1].Value; t=[double]$_.Groups[2].Value } }
    $sil = 0.0; $open = $null
    foreach ($e in $events) { if ($e.kind -eq "start") { $open = $e.t } elseif ($null -ne $open) { $sil += ($e.t - $open); $open = $null } }
    if ($null -ne $open) { $sil += ($d - $open) }
    $res[$_.BaseName] = @{ total=$d; speech=($d - $sil) }
  }
  return $res
}
$fast = Measure-Dir "video-assets\audio"
$norm = Measure-Dir "video-assets\audio-normal"
$windows = @{ "seg01-00-05"=5; "seg02-05-10"=5; "seg03-10-18"=8; "seg04-18-27"=9; "seg05-27-35"=8; "seg06-35-45"=10; "seg07-45-53"=8; "seg08-53-60"=7 }
$cum = 0.0
foreach ($k in ($windows.Keys | Sort-Object)) {
  $w = $windows[$k]; $f = $fast[$k]; $n = $norm[$k]
  $start = $cum; $cum += $n.speech
  Write-Output ("{0}  win={1,2}s  fast_speech={2,5:N2}s  norm_total={3,5:N2}s  norm_speech={4,5:N2}s  over={5:+#.00;-#.00;0.00}s  natural_slot={6,5:N1}-{7,5:N1}" -f $k, $w, $f.speech, $n.total, $n.speech, ($n.speech - $w), $start, $cum)
}
Write-Output ("NORM_SPEECH_TOTAL: {0:N2}s" -f $cum)