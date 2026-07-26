// UserPromptSubmit hook reader: emits gates-reminder.txt as additionalContext.
// Robust to cwd — resolves the .txt relative to this script's own location.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const text = readFileSync(join(here, 'gates-reminder.txt'), 'utf8');

process.stdout.write(JSON.stringify({
  hookSpecificOutput: {
    hookEventName: 'UserPromptSubmit',
    additionalContext: text,
  },
}));
