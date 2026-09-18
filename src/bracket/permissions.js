import { prompt } from '../io.js';

const READ_TOOLS = new Set(['read_file', 'glob', 'grep', 'list_dir', 'todo_write']);

export function createPermissions({ yolo = false, interactive = true, ask } = {}) {
  const always = new Set();
  return {
    get yolo() {
      return yolo;
    },
    setYolo(v) {
      yolo = Boolean(v);
    },
    async approve(toolName, summary) {
      if (yolo) return true;
      if (READ_TOOLS.has(toolName)) return true;
      if (always.has(toolName)) return true;
      if (!interactive) {
        throw new Error(
          `${toolName} needs approval. Re-run with --yolo (or --dangerously-skip-permissions).`
        );
      }
      if (typeof ask === 'function') {
        const answer = String((await ask(toolName, summary)) || '')
          .trim()
          .toLowerCase();
        if (answer === 'a' || answer === 'always') {
          always.add(toolName);
          return true;
        }
        return answer === 'y' || answer === 'yes';
      }
      const answer = (
        await prompt(`Allow ${toolName}?\n  ${summary}\n[y]es / [n]o / [a]lways`, {
          defaultValue: 'n',
        })
      )
        .trim()
        .toLowerCase();
      if (answer === 'a' || answer === 'always') {
        always.add(toolName);
        return true;
      }
      return answer === 'y' || answer === 'yes';
    },
  };
}
