import { createAiProvider } from './ai/index.js';
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { loadEnvFile } from './env.js';
import { openDatabase } from './store/db.js';
import { countRows } from './store/repository.js';

loadEnvFile();

const config = loadConfig();
const db = openDatabase(config.databasePath);
const aiProvider = createAiProvider(config);
const app = createApp({ config, aiProvider, db });

if (countRows(db, 'tickets') === 0) {
  console.warn(`No tickets found in ${config.databasePath}. Run "npm run seed" to load the demo data.`);
}

app.listen(config.port, () => {
  console.log(`TrustDesk API listening on http://localhost:${config.port} (AI provider: ${aiProvider.name})`);
});
