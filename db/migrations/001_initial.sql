CREATE TABLE provinces (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code text NOT NULL UNIQUE,
  name text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE districts (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  province_id integer NOT NULL REFERENCES provinces(id) ON DELETE RESTRICT,
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (province_id, name)
);
CREATE INDEX districts_province_idx ON districts (province_id);

CREATE TABLE grid_substations (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  district_id integer NOT NULL REFERENCES districts(id) ON DELETE RESTRICT,
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX grid_substations_district_idx ON grid_substations (district_id);

CREATE TABLE solar_installations (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  substation_id integer NOT NULL REFERENCES grid_substations(id) ON DELETE RESTRICT,
  meter_id text NOT NULL UNIQUE,
  capacity_kw numeric(9,3) NOT NULL CHECK (capacity_kw > 0),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  device_secret_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX solar_installations_substation_idx ON solar_installations (substation_id);

CREATE TABLE generation_readings (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  installation_id integer NOT NULL REFERENCES solar_installations(id) ON DELETE RESTRICT,
  recorded_at timestamptz NOT NULL,
  power_kw numeric(10,3) NOT NULL CHECK (power_kw >= 0),
  energy_kwh numeric(14,3) NOT NULL CHECK (energy_kwh >= 0),
  voltage numeric(8,2) NOT NULL CHECK (voltage > 0),
  received_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (installation_id, recorded_at)
);
CREATE INDEX generation_readings_installation_time_idx
  ON generation_readings (installation_id, recorded_at DESC, id DESC);
CREATE INDEX generation_readings_time_idx ON generation_readings (recorded_at DESC, id DESC);

CREATE TABLE users (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  username text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  role text NOT NULL CHECK (role IN ('national_analyst', 'province_analyst', 'district_analyst', 'admin')),
  province_id integer REFERENCES provinces(id) ON DELETE RESTRICT,
  district_id integer REFERENCES districts(id) ON DELETE RESTRICT,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (role IN ('national_analyst', 'admin') AND province_id IS NULL AND district_id IS NULL)
    OR (role = 'province_analyst' AND province_id IS NOT NULL AND district_id IS NULL)
    OR (role = 'district_analyst' AND province_id IS NULL AND district_id IS NOT NULL)
  )
);
