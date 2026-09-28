$ErrorActionPreference = "Stop"
$base = "video-assets/audio-best-shuangkuai"
$slices = "$base/slices"
New-Item -ItemType Directory -Path $slices -Force | Out-Null
$plan = @(
  @{ n=1; title="服务器失守"; start=0.00;  end=6.60 },
  @{ n=2; title="信任链崩溃"; start=6.60;  end=13.06 },
  @{ n=3; title="核心创新";   start=13.06; end=23.05 },
  @{ n=4; title="控制平台";   start=23.05; end=33.93 },
  @{ n=5; title="AI风险判断"; start=33.93; end=42.51 },
  @{ n=6; title="硬件网关";   start=42.51; end=52.53 },
  @{ n=7; title="隔离与授权"; start=52.53; end=61.38 },
  @{ n=8; title="结尾";       start=61.38; end=69.23 }
)
foreach ($p in $plan) {
  $dur = $p.end - $p.start
  $name = ("seg{0:d2}-{1}.wav" -f $p.n, $p.title)
  & ffmpeg -y -v error -i "$base/narration-master-best.wav" -ss $p.start -t $dur -ar 44100 -ac 2 "$slices/$name"
  $d = [double](& ffprobe -v error -show_entries format=duration -of csv=p=0 "$slices/$name")
  Write-Output ("{0}  {1,6:N2} - {2,6:N2}  actual={3,6:N3}s" -f $name, $p.start, $p.end, $d)
}