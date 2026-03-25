const express = require('express');
const employeesService = require('../services/employees.service');
const submissionsService = require('../services/submissions.service');
const botService = require('../services/bot.service');

const router = express.Router();

function ensureRequiredString(value) {
  return String(value || '').trim();
}

router.get('/api/miniapp/access', async (req, res, next) => {
  try {
    const userId = ensureRequiredString(req.query.user_id);
    const token = ensureRequiredString(req.query.token);

    if (!userId || !token) {
      return res.status(401).json({
        ok: false,
        error: 'user_id and token are required.'
      });
    }

    if (!botService.validateMiniappToken(userId, token)) {
      return res.status(401).json({
        ok: false,
        error: 'Invalid token.'
      });
    }

    const employee = await employeesService.findByMaxUserId(userId);

    if (!employee || !employee.is_active) {
      return res.status(403).json({
        ok: false,
        error: 'Access denied.'
      });
    }

    return res.json({
      ok: true,
      employee: {
        max_user_id: employee.max_user_id,
        full_name: employee.full_name
      }
    });
  } catch (error) {
    return next(error);
  }
});

router.post('/api/miniapp/submit', async (req, res, next) => {
  try {
    const token = ensureRequiredString(req.body.token);
    const userId = ensureRequiredString(req.body.user_id);
    const fullName = ensureRequiredString(req.body.full_name);
    const meterNumber = ensureRequiredString(req.body.meter_number);
    const currentValue = ensureRequiredString(req.body.current_value);

    if (!token || !userId || !fullName || !meterNumber || !currentValue) {
      return res.status(400).json({
        ok: false,
        error: 'token, user_id, full_name, meter_number and current_value are required.'
      });
    }

    if (!botService.validateMiniappToken(userId, token)) {
      return res.status(401).json({
        ok: false,
        error: 'Invalid token.'
      });
    }

    const employee = await employeesService.findByMaxUserId(userId);

    if (!employee || !employee.is_active) {
      return res.status(403).json({
        ok: false,
        error: 'Access denied.'
      });
    }

    const submission = await submissionsService.createDraftSubmission({
      maxUserId: userId,
      fullName,
      meterNumber,
      currentValue
    });

    return res.status(201).json({
      ok: true,
      message_for_bot:
        `Проверь данные:\n` +
        `ФИО: ${submission.full_name}\n` +
        `Номер счетчика: ${submission.meter_number}\n` +
        `Показание: ${submission.current_value}\n\n` +
        'Если все верно, напиши: подтверждаю',
      submission
    });
  } catch (error) {
    return next(error);
  }
});

router.get('/api/submissions/:userId', async (req, res, next) => {
  try {
    const userId = ensureRequiredString(req.params.userId);

    if (!userId) {
      return res.status(400).json({
        ok: false,
        error: 'userId is required.'
      });
    }

    const submissions = await submissionsService.listByUserId(userId);

    return res.json({
      ok: true,
      submissions
    });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
