$src = "video-assets/audio-normal"
$trim = "video-assets/audio-normal/edge-trimmed"
New-Item -ItemType Directory -Path $trim -Force | Out-Null
$ids = @("seg01-00-05","seg02-05-10","seg03-10-18","seg04-18-27","seg05-27-35","seg06-35-45","seg07-45-53","seg08-53-60")
$sum = 0.0
foreach ($id in $ids) {
  $out = "$trim/$id.wav"
  & ffmpeg -y -v error -i "$src/$id.mp3" -af "silenceremove=start_periods=1:start_threshold=-35dB:start_silence=0.05,areverse,silenceremove=start_periods=1:start_threshold=-35dB:start_silence=0.05,areverse" -ar 44100 -ac 2 $out
  $d = [double](& ffprobe -v error -show_entries format=duration -of csv=p=0 $out)
  $sum += $d
  Write-Output ("{0}  trimmed={1,6:N2}s" -f $id, $d)
}
Write-Output ("TRIMMED_TOTAL: {0:N2}s" -f $sum)