import 'dotenv/config';
import { deriveSeedSecret } from '../src/credentials.js';

const master = process.env.SEED_CREDENTIAL_MASTER;
if (!master) throw new Error('Set SEED_CREDENTIAL_MASTER first');
for (const username of ['national.analyst', 'province.western', 'district.colombo', 'catalog.admin']) {
  console.log(`${username}: ${deriveSeedSecret(master, `user:${username}`)}`);
}
console.log(`SLSEA-0001: ${deriveSeedSecret(master, 'meter:SLSEA-0001')}`);
