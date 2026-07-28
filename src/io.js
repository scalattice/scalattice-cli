import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

export async function prompt(question, { defaultValue = '' } = {}) {
  const rl = readline.createInterface({ input, output });
  try {
    const hint = defaultValue ? ` [${defaultValue}]` : '';
    const answer = (await rl.question(`${question}${hint}: `)).trim();
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
