const db = require('../db');

async function findByMaxUserId(maxUserId) {
  const result = await db.query(
    `
      SELECT id, max_user_id, full_name, is_active, created_at
      FROM employees
      WHERE max_user_id = $1
      LIMIT 1
    `,
    [maxUserId]
  );

  return result.rows[0] || null;
}

module.exports = {
  findByMaxUserId
};
