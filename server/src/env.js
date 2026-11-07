import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

/**
 * Loads the repo-root .env (copy it from .env.example).
 * Real environment variables take precedence over the file.
 */
export function loadEnvFile() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  dotenv.config({ path: path.resolve(here, '../../.env') });
}
