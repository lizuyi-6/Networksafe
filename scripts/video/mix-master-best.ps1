$ErrorActionPreference = "Stop"
$base = "video-assets/audio-best-shuangkuai"
$src = "$base/src"
$trim = "$base/edge-trimmed"
New-Item -ItemType Directory -Path $trim -Force | Out-Null
$ids = @("seg01-00-05","seg02-05-10","seg03-10-18","seg04-18-27","seg05-27-35","seg06-35-45","seg07-45-53","seg08-53-60")
foreach ($id in $ids) {
  & ffmpeg -y -v error -i "$src/$id.mp3" -af "silenceremove=start_periods=1:start_threshold=-35dB:start_silence=0.05,areverse,silenceremove=start_periods=1:start_threshold=-35dB:start_silence=0.05,areverse" -ar 44100 -ac 2 "$trim/$id.wav"
}
$gap = 0.4
$cursor = 0.0
$rows = @()
foreach ($id in $ids) {
  $d = [double](& ffprobe -v error -show_entries format=duration -of csv=p=0 "$trim/$id.wav")
  $rows += [pscustomobject]@{ id=$id; start=$cursor; dur=$d; end=($cursor + $d) }
  $cursor += $d + $gap
}
$total = $cursor - $gap
foreach ($r in $rows) { Write-Output ("{0}  {1,6:N2} - {2,6:N2}  ({3,5:N2}s)" -f $r.id, $r.start, $r.end, $r.dur) }
$filterParts = @()
$mixInputs = @()
$i = 0
foreach ($r in $rows) {
  $delayMs = [int]($r.start * 1000)
  $filterParts += "[$i]adelay=${delayMs}|${delayMs}[d$i]"
  $mixInputs += "[d$i]"
  $i++
}
$filter = ($filterParts -join ";") + ";" + ($mixInputs -join "") + "amix=inputs=$($ids.Count):normalize=0,atrim=0:$total,apad=whole_dur=$total[out]"
& ffmpeg -y -v error @($ids | ForEach-Object { "-i"; "$trim/$_.wav" }) -filter_complex $filter -map "[out]" -ar 44100 -ac 2 "$base/narration-master-best.wav"
& ffmpeg -y -v error -i "$base/narration-master-best.wav" -codec:a libmp3lame -q:a 2 "$base/narration-master-best.mp3"
$check = [double](& ffprobe -v error -show_entries format=duration -of csv=p=0 "$base/narration-master-best.wav")
Write-Output ("MASTER: {0:N3}s" -f $check)