import { mkdir, writeFile } from 'fs/promises';
import path from 'path';
import { owaspWebEvaluationService } from '../src/services/owasp-web-evaluation.service';

async function main(): Promise<void> {
  const datasetRootArg = process.argv.find((arg) => arg.startsWith('--dataset-root='));
  const maxSamplesArg = process.argv.find((arg) => arg.startsWith('--max-samples-per-family='));
  const baselinesArg = process.argv.find((arg) => arg.startsWith('--baselines='));
  const routeModesArg = process.argv.find((arg) => arg.startsWith('--route-modes='));
  const skipRouteSweep = process.argv.includes('--skip-route-sweep');
  const datasetRoot = datasetRootArg ? datasetRootArg.split('=')[1] : undefined;
  const maxSamplesPerFamily = maxSamplesArg ? Number(maxSamplesArg.split('=')[1]) : undefined;
  const baselines = baselinesArg
    ? baselinesArg.split('=')[1].split(',').map((value) => value.trim()).filter(Boolean) as Array<'modsecurity_crs' | 'single_agent' | 'multi_agent_no_debate' | 'multi_agent_with_debate'>
    : undefined;
  const routeModes = routeModesArg
    ? routeModesArg.split('=')[1].split(',').map((value) => value.trim()).filter(Boolean) as Array<'cloud_only' | 'local_preferred' | 'hybrid_verify'>
    : undefined;
  const report = await owaspWebEvaluationService.evaluate({
    datasetRoot,
    maxSamplesPerFamily,
    baselines,
    routeModes,
    includeRouteModeSweep: !skipRouteSweep
  });
  const outputDir = path.resolve(__dirname, '../../docs/papers/ieee-access-submission/experimental-results');
  const outputPath = path.join(outputDir, 'owasp-web-eval.json');

  await mkdir(outputDir, { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  console.log(`OWASP web evaluation report written to ${outputPath}`);
  console.log(`Samples: ${report.dataset.sampleCount}`);
  for (const baseline of report.baselines) {
    console.log(`${baseline.name}: ${baseline.available ? `F1=${baseline.metrics?.f1Score ?? 'n/a'}` : 'unavailable'}`);
  }
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
