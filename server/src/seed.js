import { resolveStorageConfig } from './config.js';
import { loadEnvFile } from './env.js';
import { openDatabase } from './store/db.js';
import { loadSeedData } from './seed/loadSeedData.js';

// Usage: npm run seed   (from the repo root or from server/)
loadEnvFile();

const { databasePath, dataDir } = resolveStorageConfig();
const db = openDatabase(databasePath);

try {
  const counts = await loadSeedData(db, dataDir);
  console.log(`Seeded ${databasePath} from ${dataDir}`);
  for (const [table, count] of Object.entries(counts)) {
    console.log(`  ${table.padEnd(20)} ${count}`);
  }
} finally {
  db.close();
}
