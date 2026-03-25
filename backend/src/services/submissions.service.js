const db = require('../db');

async function createDraftSubmission(payload) {
  const result = await db.query(
    `
      INSERT INTO form_submissions (
        max_user_id,
        full_name,
        meter_number,
        current_value,
        status
      )
      VALUES ($1, $2, $3, $4, 'draft')
      RETURNING id, max_user_id, full_name, meter_number, current_value, status, created_at, confirmed_at
    `,
    [
      payload.maxUserId,
      payload.fullName,
      payload.meterNumber,
      payload.currentValue
    ]
  );

  return result.rows[0];
}

async function findLatestDraftByUserId(maxUserId) {
  const result = await db.query(
    `
      SELECT id, max_user_id, full_name, meter_number, current_value, status, created_at, confirmed_at
      FROM form_submissions
      WHERE max_user_id = $1 AND status = 'draft'
      ORDER BY id DESC
      LIMIT 1
    `,
    [maxUserId]
  );

  return result.rows[0] || null;
}

async function confirmSubmission(id) {
  const result = await db.query(
    `
      UPDATE form_submissions
      SET status = 'confirmed',
          confirmed_at = NOW()
      WHERE id = $1
      RETURNING id, max_user_id, full_name, meter_number, current_value, status, created_at, confirmed_at
    `,
    [id]
  );

  return result.rows[0] || null;
}

async function listByUserId(maxUserId) {
  const result = await db.query(
    `
      SELECT id, max_user_id, full_name, meter_number, current_value, status, created_at, confirmed_at
      FROM form_submissions
      WHERE max_user_id = $1
      ORDER BY id DESC
    `,
    [maxUserId]
  );

  return result.rows;
}

module.exports = {
  createDraftSubmission,
  findLatestDraftByUserId,
  confirmSubmission,
  listByUserId
};
