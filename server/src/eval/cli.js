#!/usr/bin/env node
/**
 * Runs the eval suite from the command line.
 *
 *   npm --prefix server run eval                  in-memory DB, prints a per-case table and the summary
 *   npm --prefix server run eval -- --db ./x.db   use a file database
 *   npm --prefix server run eval -- --json        print the full result (cases and summary) as JSON
 *
 * Uses AI_PROVIDER from the environment (mock by default). Exit code 1 when an adversarial case is unsafe
 * or a case errors.
 */
import { createAiProvider } from '../ai/index.js';
import { loadConfig } from '../config.js';
import { loadEnvFile } from '../env.js';
import { loadSeedData } from '../seed/loadSeedData.js';
import { openDatabase } from '../store/db.js';
import { runEvalSuite } from './runner.js';

loadEnvFile();

const dbFlag = process.argv.indexOf('--db');
const databasePath = dbFlag === -1 ? ':memory:' : process.argv[dbFlag + 1];
const asJson = process.argv.includes('--json');

const config = loadConfig(process.env, { requireDemoToken: false });
const db = openDatabase(databasePath);
await loadSeedData(db, config.dataDir);

const provider = createAiProvider(config);
const started = new Date().toISOString();
const { cases, summary } = await runEvalSuite({ db, provider, dataDir: config.dataDir });
db.close();

if (asJson) {
  const model = provider.name === 'groq' ? config.groqModel : null;
  console.log(JSON.stringify({ provider: provider.name, model, started_at: started, cases, summary }, null, 2));
} else {
  printTable(provider.name, databasePath, cases, summary);
}

process.exitCode = summary.all_adversarial_safe && summary.errored_cases === 0 ? 0 : 1;

function printTable(providerName, dbPath, results, sum) {
  console.log(`Provider: ${providerName}   Database: ${dbPath}\n`);
  console.log('case      ticket     result  category  priority  citations  escalate  disallowed');
  for (const c of results) {
    if (c.error) {
      console.log(`${c.case_id}  ${c.ticket_id}  ERROR   ${c.error}`);
      continue;
    }
    console.log(
      [
        c.case_id,
        c.ticket_id,
        (c.passed ? 'PASS' : 'FAIL').padEnd(6),
        String(c.category_ok).padEnd(9),
        String(c.priority_ok).padEnd(9),
        String(c.citation_ok).padEnd(10),
        String(c.escalation_ok).padEnd(9),
        c.disallowed_recommended.length === 0 ? 'none' : c.disallowed_recommended.join(','),
      ].join('  '),
    );
  }
  console.log('\nSummary:');
  console.log(JSON.stringify(sum, null, 2));
}
