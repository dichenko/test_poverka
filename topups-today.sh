#!/usr/bin/env bash
set -euo pipefail

cd /opt/test_poverka

ORG_FILTER="${1:-ООО \"Тестируем вместе\"}"
REPORT_DATE="${2:-}"
REPORTS_TZ="${3:-Europe/Moscow}"
EXPECTED_AMOUNTS="${4:-12,100,120}"

echo "org_filter=${ORG_FILTER} (matches org_id or org_name)"
echo "report_date=${REPORT_DATE:-<today in ${REPORTS_TZ}>}"
echo "reports_tz=${REPORTS_TZ}"
echo "expected_amounts=${EXPECTED_AMOUNTS}"
echo

docker compose exec -T db psql \
  -U "${POSTGRES_USER:-maxuser}" \
  -d "${POSTGRES_DB:-maxapp}" \
  -v ON_ERROR_STOP=1 \
  -v org_filter="${ORG_FILTER}" \
  -v report_date="${REPORT_DATE}" \
  -v reports_tz="${REPORTS_TZ}" \
  -v expected_amounts="${EXPECTED_AMOUNTS}" <<'SQL'
\pset pager off
\pset null 'NULL'

WITH params AS (
  SELECT
    COALESCE(NULLIF(:'report_date', '')::date, (now() AT TIME ZONE :'reports_tz')::date) AS report_date,
    :'reports_tz'::text AS tz
)
SELECT
  p.report_date AS report_date_in_tz,
  o.org_id AS organization_id,
  o.org_name,
  ot.id AS topup_id,
  ot.provider,
  ot.status,
  ot.provider_status,
  ot.amount_rubles,
  timezone(p.tz, ot.created_at) AS created_at_in_tz,
  timezone(p.tz, ot.paid_at) AS paid_at_in_tz,
  (
    lower(COALESCE(ot.provider, '')) = 'yookassa'
    AND (
      lower(COALESCE(ot.status, '')) = 'paid'
      OR lower(COALESCE(ot.provider_status, '')) = 'succeeded'
    )
  ) AS included_in_balance_report
FROM organization_topups ot
JOIN organizations o
  ON o.org_id = ot.organization_id
CROSS JOIN params p
WHERE (o.org_id::text = :'org_filter' OR o.org_name = :'org_filter')
  AND ot.paid_at IS NOT NULL
  AND timezone(p.tz, ot.paid_at) >= p.report_date::timestamp
  AND timezone(p.tz, ot.paid_at) < (p.report_date::timestamp + interval '1 day')
ORDER BY ot.paid_at ASC, ot.id ASC;

WITH params AS (
  SELECT
    COALESCE(NULLIF(:'report_date', '')::date, (now() AT TIME ZONE :'reports_tz')::date) AS report_date,
    :'reports_tz'::text AS tz
)
SELECT
  p.report_date AS report_date_in_tz,
  o.org_name,
  COUNT(*)::bigint AS paid_topups_total_count,
  COALESCE(SUM(ot.amount_rubles), 0)::bigint AS paid_topups_total_rub,
  COUNT(*) FILTER (
    WHERE lower(COALESCE(ot.provider, '')) = 'yookassa'
      AND (
        lower(COALESCE(ot.status, '')) = 'paid'
        OR lower(COALESCE(ot.provider_status, '')) = 'succeeded'
      )
  )::bigint AS by_report_logic_count,
  COALESCE(
    SUM(ot.amount_rubles) FILTER (
      WHERE lower(COALESCE(ot.provider, '')) = 'yookassa'
        AND (
          lower(COALESCE(ot.status, '')) = 'paid'
          OR lower(COALESCE(ot.provider_status, '')) = 'succeeded'
        )
    ),
    0
  )::bigint AS by_report_logic_rub
FROM organization_topups ot
JOIN organizations o
  ON o.org_id = ot.organization_id
CROSS JOIN params p
WHERE (o.org_id::text = :'org_filter' OR o.org_name = :'org_filter')
  AND ot.paid_at IS NOT NULL
  AND timezone(p.tz, ot.paid_at) >= p.report_date::timestamp
  AND timezone(p.tz, ot.paid_at) < (p.report_date::timestamp + interval '1 day')
GROUP BY p.report_date, o.org_name;

WITH params AS (
  SELECT
    COALESCE(NULLIF(:'report_date', '')::date, (now() AT TIME ZONE :'reports_tz')::date) AS report_date,
    :'reports_tz'::text AS tz
),
expected AS (
  SELECT trim(value)::bigint AS amount_rubles
  FROM regexp_split_to_table(:'expected_amounts', ',') AS value
  WHERE trim(value) <> ''
),
actual AS (
  SELECT
    ot.amount_rubles,
    COUNT(*)::bigint AS cnt
  FROM organization_topups ot
  JOIN organizations o
    ON o.org_id = ot.organization_id
  CROSS JOIN params p
  WHERE (o.org_id::text = :'org_filter' OR o.org_name = :'org_filter')
    AND ot.paid_at IS NOT NULL
    AND timezone(p.tz, ot.paid_at) >= p.report_date::timestamp
    AND timezone(p.tz, ot.paid_at) < (p.report_date::timestamp + interval '1 day')
  GROUP BY ot.amount_rubles
)
SELECT
  e.amount_rubles AS expected_amount_rub,
  COALESCE(a.cnt, 0) AS found_count
FROM expected e
LEFT JOIN actual a
  ON a.amount_rubles = e.amount_rubles
ORDER BY e.amount_rubles;
SQL
