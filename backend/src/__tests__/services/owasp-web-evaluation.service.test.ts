import fs from 'fs';
import os from 'os';
import path from 'path';
import { owaspWebEvaluationService } from '../../services/owasp-web-evaluation.service';

function writeBenchmarkCase(root: string, testName: string, servletPath: string, parameterName: string): void {
  const javaPath = path.join(root, 'src', 'main', 'java', 'org', 'owasp', 'benchmark', 'testcode', `${testName}.java`);
  fs.mkdirSync(path.dirname(javaPath), { recursive: true });
  fs.writeFileSync(
    javaPath,
    [
      'package org.owasp.benchmark.testcode;',
      '',
      'import jakarta.servlet.annotation.WebServlet;',
      'import jakarta.servlet.http.HttpServletRequest;',
      '',
      `@WebServlet(value = "${servletPath}")`,
      `public class ${testName} {`,
      '  public void doPost(HttpServletRequest request) {',
      `    request.getParameter("${parameterName}");`,
      '  }',
      '}',
      ''
    ].join('\n'),
    'utf8'
  );
}

describe('OWASP web evaluation service', () => {
  let tempRoot: string;

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'owasp-eval-'));
  });

  afterEach(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  test('loadSamples keeps balanced attack and benign slices per family', async () => {
    fs.writeFileSync(
      path.join(tempRoot, 'expectedresults-1.2.csv'),
      [
        'BenchmarkTest10001,cmdi,true,CWE-78',
        'BenchmarkTest10002,cmdi,true,CWE-78',
        'BenchmarkTest10003,cmdi,false,CWE-78',
        'BenchmarkTest10004,cmdi,false,CWE-78'
      ].join('\n'),
      'utf8'
    );

    writeBenchmarkCase(tempRoot, 'BenchmarkTest10001', '/benchmark/cmdi-10001', 'host');
    writeBenchmarkCase(tempRoot, 'BenchmarkTest10002', '/benchmark/cmdi-10002', 'host');
    writeBenchmarkCase(tempRoot, 'BenchmarkTest10003', '/benchmark/cmdi-10003', 'host');
    writeBenchmarkCase(tempRoot, 'BenchmarkTest10004', '/benchmark/cmdi-10004', 'host');

    const dataset = await owaspWebEvaluationService.loadSamples(tempRoot, 1);

    expect(dataset.rows).toBe(4);
    expect(dataset.samples).toHaveLength(2);
    expect(dataset.samples.filter((sample) => sample.isAttack)).toHaveLength(1);
    expect(dataset.samples.filter((sample) => !sample.isAttack)).toHaveLength(1);
    expect(dataset.categories.command_injection).toBe(2);
  });
});
