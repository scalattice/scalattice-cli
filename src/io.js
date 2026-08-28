import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

let sharedRl = null;

/** Reuse the interactive prompt so nested questions do not close stdin. */
export function setPromptInterface(rl) {
  sharedRl = rl || null;
}

export async function prompt(question, { defaultValue = '' } = {}) {
  const hint = defaultValue ? ` [${defaultValue}]` : '';
  const ask = `${question}${hint}: `;
  if (sharedRl) {
    const answer = (await sharedRl.question(ask)).trim();
    return answer || defaultValue;
  }
  const rl = readline.createInterface({ input, output, terminal: true });
  try {
    const answer = (await rl.question(ask)).trim();
    return answer || defaultValue;
  } finally {
    rl.close();
  }
}

export function print(msg = '') {
  console.log(msg);
}

export function die(msg, code = 1) {
  console.error(msg);
  process.exit(code);
}
