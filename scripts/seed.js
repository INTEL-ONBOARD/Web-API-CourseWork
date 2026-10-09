import 'dotenv/config';
import { pool, withTransaction } from '../src/db.js';
import { deriveSeedSecret, hashSecret } from '../src/credentials.js';

const master = process.env.SEED_CREDENTIAL_MASTER;
if (!master || master.length < 32) throw new Error('Set a private SEED_CREDENTIAL_MASTER of at least 32 characters');

const geography = [
  ['Western', ['Colombo', 'Gampaha', 'Kalutara']],
  ['Central', ['Kandy', 'Matale', 'Nuwara Eliya']],
  ['Southern', ['Galle', 'Matara', 'Hambantota']],
  ['Northern', ['Jaffna', 'Kilinochchi', 'Mannar', 'Mullaitivu', 'Vavuniya']],
  ['Eastern', ['Ampara', 'Batticaloa', 'Trincomalee']],
  ['North Western', ['Kurunegala', 'Puttalam']],
  ['North Central', ['Anuradhapura', 'Polonnaruwa']],
  ['Uva', ['Badulla', 'Monaragala']],
  ['Sabaragamuwa', ['Kegalle', 'Ratnapura']],
];

const code = (name) => name.toUpperCase().replace(/[^A-Z]+/g, '-').replace(/^-|-$/g, '');
const installations = [];

await withTransaction(async (db) => {
  for (const [provinceName, districtNames] of geography) {
    const province = (await db.query(
      `INSERT INTO provinces (code, name) VALUES ($1, $2)
       ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name
       RETURNING id`, [code(provinceName), provinceName]
    )).rows[0];
    for (const districtName of districtNames) {
      const district = (await db.query(
        `INSERT INTO districts (province_id, code, name) VALUES ($1, $2, $3)
         ON CONFLICT (code) DO UPDATE SET province_id = EXCLUDED.province_id, name = EXCLUDED.name
         RETURNING id`, [province.id, code(districtName), districtName]
      )).rows[0];
      const substation = (await db.query(
        `INSERT INTO grid_substations (district_id, code, name) VALUES ($1, $2, $3)
         ON CONFLICT (code) DO UPDATE SET district_id = EXCLUDED.district_id, name = EXCLUDED.name
         RETURNING id`, [district.id, `GS-${code(districtName)}`, `${districtName} Grid Substation`]
      )).rows[0];
      for (let site = 1; site <= 8; site += 1) {
        const ordinal = installations.length + 1;
        const meterId = `SLSEA-${String(ordinal).padStart(4, '0')}`;
        const capacityKw = Number((3 + ((ordinal * 13) % 45) / 10).toFixed(1));
        const deviceSecret = deriveSeedSecret(master, `meter:${meterId}`);
        const hash = await hashSecret(deviceSecret);
        const installation = (await db.query(
          `INSERT INTO solar_installations (substation_id, meter_id, capacity_kw, device_secret_hash)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (meter_id) DO UPDATE SET substation_id = EXCLUDED.substation_id,
             capacity_kw = EXCLUDED.capacity_kw, device_secret_hash = EXCLUDED.device_secret_hash
           RETURNING id, capacity_kw`, [substation.id, meterId, capacityKw, hash]
        )).rows[0];
        installations.push({ id: installation.id, capacityKw, ordinal });
      }
    }
  }

  const western = (await db.query(`SELECT id FROM provinces WHERE code = 'WESTERN'`)).rows[0].id;
  const colombo = (await db.query(`SELECT id FROM districts WHERE code = 'COLOMBO'`)).rows[0].id;
  const users = [
    ['national.analyst', 'national_analyst', null, null],
    ['province.western', 'province_analyst', western, null],
    ['district.colombo', 'district_analyst', null, colombo],
    ['catalog.admin', 'admin', null, null],
  ];
  for (const [username, role, provinceId, districtId] of users) {
    const hash = await hashSecret(deriveSeedSecret(master, `user:${username}`));
    await db.query(
      `INSERT INTO users (username, password_hash, role, province_id, district_id)
       VALUES ($1, $2, $3, $4, $5) ON CONFLICT (username) DO UPDATE SET password_hash = EXCLUDED.password_hash`,
      [username, hash, role, provinceId, districtId]
    );
  }
});

const existingSeedStart = (await pool.query(
  `SELECT min(r.recorded_at) AS first_reading FROM generation_readings r
   JOIN solar_installations i ON i.id = r.installation_id WHERE i.meter_id = 'SLSEA-0001'`
)).rows[0].first_reading;
const anchor = process.env.SEED_ANCHOR_DATE
  ? new Date(process.env.SEED_ANCHOR_DATE)
  : existingSeedStart
    ? new Date(new Date(existingSeedStart).getTime() + 671 * 900_000)
    : new Date(Math.floor(Date.now() / 900_000) * 900_000);
if (Number.isNaN(anchor.getTime())) throw new Error('SEED_ANCHOR_DATE must be an ISO timestamp');

const batch = [];
let inserted = 0;
async function flush() {
  if (!batch.length) return;
  const columns = 5;
  const placeholders = batch.map((_, index) => {
    const start = index * columns + 1;
    return `(${Array.from({ length: columns }, (_value, i) => `$${start + i}`).join(', ')})`;
  });
  const values = batch.flat();
  const result = await pool.query(
    `INSERT INTO generation_readings (installation_id, recorded_at, power_kw, energy_kwh, voltage)
     VALUES ${placeholders.join(', ')} ON CONFLICT (installation_id, recorded_at) DO NOTHING`, values
  );
  inserted += result.rowCount;
  batch.length = 0;
}

for (const installation of installations) {
  let energy = 1000 + installation.ordinal * 10;
  for (let step = 671; step >= 0; step -= 1) {
    const recordedAt = new Date(anchor.getTime() - step * 900_000);
    const local = new Date(recordedAt.getTime() + 330 * 60_000);
    const localHour = local.getUTCHours() + local.getUTCMinutes() / 60;
    const daylight = Math.max(0, Math.sin(Math.PI * (localHour - 6) / 12));
    const cloud = 0.83 + ((installation.ordinal * 7 + local.getUTCDate() * 3) % 16) / 100;
    const power = Number((installation.capacityKw * daylight * cloud).toFixed(3));
    energy = Number((energy + power / 4).toFixed(3));
    const voltage = Number((228 + Math.sin((installation.ordinal + step) / 17) * 4).toFixed(2));
    batch.push([installation.id, recordedAt, power, energy, voltage]);
    if (batch.length === 1000) await flush();
  }
}
await flush();
console.log(`Seeded geography and ${installations.length} installations; inserted ${inserted} new readings`);
await pool.end();
