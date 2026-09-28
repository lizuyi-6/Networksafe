$ErrorActionPreference = "Stop"
$dir = "video-assets/audio"
$mix = "video-assets/audio/mix-tmp"
New-Item -ItemType Directory -Path $mix -Force | Out-Null
$plan = @(
  @{ id="seg01-00-05"; w=5.0 },
  @{ id="seg02-05-10"; w=5.0 },
  @{ id="seg03-10-18"; w=8.3 },
  @{ id="seg04-18-27"; w=8.7 },
  @{ id="seg05-27-35"; w=8.0 },
  @{ id="seg06-35-45"; w=10.0 },
  @{ id="seg07-45-53"; w=8.0 },
  @{ id="seg08-53-60"; w=7.0 }
)
foreach ($p in $plan) {
  $in = "$dir/$($p.id).mp3"
  $out = "$mix/$($p.id).wav"
  & ffmpeg -y -v error -i $in -af "silenceremove=start_periods=1:start_threshold=-35dB:start_silence=0.05,areverse,silenceremove=start_periods=1:start_threshold=-35dB:start_silence=0.05,areverse,apad=whole_dur=$($p.w)" -t $p.w -ar 44100 -ac 2 $out
  $d = [double](& ffprobe -v error -show_entries format=duration -of csv=p=0 $out)
  Write-Output ("{0}  window={1,4:N1}s  actual={2,6:N3}s" -f $p.id, $p.w, $d)
}
$lines = $plan | ForEach-Object { "file $($_.id).wav" }
[System.IO.File]::WriteAllText("$mix/concat.txt", [string]::Join([char]10, $lines))
& ffmpeg -y -v error -f concat -safe 0 -i "$mix/concat.txt" -c copy "video-assets/audio/narration-master-60s.wav"
& ffmpeg -y -v error -i "video-assets/audio/narration-master-60s.wav" -codec:a libmp3lame -q:a 2 "video-assets/audio/narration-master-60s.mp3"
$total = [double](& ffprobe -v error -show_entries format=duration -of csv=p=0 "video-assets/audio/narration-master-60s.wav")
Write-Output ("MASTER TOTAL: {0:N3}s" -f $total)
Remove-Item $mix -Recurse -Force