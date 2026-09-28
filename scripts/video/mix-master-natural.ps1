$ErrorActionPreference = "Stop"
$src = "video-assets/audio-normal/pause-capped-025"
$mix = "video-assets/audio-normal/mix-tmp"
New-Item -ItemType Directory -Path $mix -Force | Out-Null
$plan = @(
  @{ id="seg01-00-05"; w=5.0 },
  @{ id="seg02-05-10"; w=5.7 },
  @{ id="seg03-10-18"; w=7.2 },
  @{ id="seg04-18-27"; w=10.0 },
  @{ id="seg05-27-35"; w=6.9 },
  @{ id="seg06-35-45"; w=9.0 },
  @{ id="seg07-45-53"; w=9.2 },
  @{ id="seg08-53-60"; w=7.0 }
)
foreach ($p in $plan) {
  & ffmpeg -y -v error -i "$src/$($p.id).wav" -af "apad=whole_dur=$($p.w)" -t $p.w -ar 44100 -ac 2 "$mix/$($p.id).wav"
  $d = [double](& ffprobe -v error -show_entries format=duration -of csv=p=0 "$mix/$($p.id).wav")
  Write-Output ("{0}  slot={1,4:N1}s  actual={2,6:N3}s" -f $p.id, $p.w, $d)
}
$lines = $plan | ForEach-Object { "file $($_.id).wav" }
[System.IO.File]::WriteAllText("$mix/concat.txt", [string]::Join([char]10, $lines))
& ffmpeg -y -v error -f concat -safe 0 -i "$mix/concat.txt" -c copy "video-assets/audio-normal/narration-master-60s-natural.wav"
& ffmpeg -y -v error -i "video-assets/audio-normal/narration-master-60s-natural.wav" -codec:a libmp3lame -q:a 2 "video-assets/audio-normal/narration-master-60s-natural.mp3"
$total = [double](& ffprobe -v error -show_entries format=duration -of csv=p=0 "video-assets/audio-normal/narration-master-60s-natural.wav")
Write-Output ("NATURAL MASTER TOTAL: {0:N3}s" -f $total)
Remove-Item $mix -Recurse -Force