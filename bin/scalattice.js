#!/usr/bin/env node
import { main } from '../src/index.js';

main(process.argv.slice(2)).catch((err) => {
  const msg = err?.message || String(err);
  console.error(`Error: ${msg}`);
  process.exit(1);
});
