-- Interface counter history (3-year retention for trend graphs).
-- Raw 60s samples live 7 days; anything older compacts into hourly buckets
-- that are kept indefinitely (>= 3 years of per-port history).
CREATE TABLE interface_samples (
  switch_id TEXT NOT NULL REFERENCES switches (id) ON DELETE CASCADE,
  iface TEXT NOT NULL,
  ts TIMESTAMPTZ NOT NULL,
  in_bytes BIGINT NOT NULL DEFAULT 0,
  out_bytes BIGINT NOT NULL DEFAULT 0,
  in_pkts BIGINT NOT NULL DEFAULT 0,
  out_pkts BIGINT NOT NULL DEFAULT 0,
  drops BIGINT NOT NULL DEFAULT 0,
  errors BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (switch_id, iface, ts)
);
CREATE INDEX interface_samples_lookup ON interface_samples (switch_id, iface, ts DESC);

CREATE TABLE interface_samples_hourly (
  switch_id TEXT NOT NULL REFERENCES switches (id) ON DELETE CASCADE,
  iface TEXT NOT NULL,
  hour TIMESTAMPTZ NOT NULL,
  in_bytes BIGINT NOT NULL DEFAULT 0,
  out_bytes BIGINT NOT NULL DEFAULT 0,
  in_pkts BIGINT NOT NULL DEFAULT 0,
  out_pkts BIGINT NOT NULL DEFAULT 0,
  drops BIGINT NOT NULL DEFAULT 0,
  errors BIGINT NOT NULL DEFAULT 0,
  samples INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (switch_id, iface, hour)
);
