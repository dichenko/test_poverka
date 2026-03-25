const express = require('express');
const config = require('../config');
const employeesService = require('../services/employees.service');
const submissionsService = require('../services/submissions.service');
const botService = require('../services/bot.service');

const router = express.Router();

router.post('/webhook/max', async (req, res, next) => {
  try {
    const providedSecret = req.header('x-max-secret');

    if (!providedSecret || providedSecret !== config.maxWebhookSecret) {
      return res.status(401).json({
        ok: false,
        error: 'Invalid x-max-secret header.'
      });
    }

    const userId = String(req.body.user_id || '').trim();
    const text = String(req.body.text || '').trim();

    if (!userId) {
      return res.status(400).json({
        ok: false,
        error: 'user_id is required.'
      });
    }

    const employee = await employeesService.findByMaxUserId(userId);

    if (!employee || !employee.is_active) {
      return res.json({
        ok: true,
        message: 'Доступ запрещен. Тебя нет в списке сотрудников.'
      });
    }

    if (!botService.isConfirmationText(text)) {
      const miniappLink = botService.buildMiniappLink(userId);

      return res.json({
        ok: true,
        message: `Привет, ${employee.full_name}. Открой miniapp: ${miniappLink}`
      });
    }

    const latestDraft = await submissionsService.findLatestDraftByUserId(userId);

    if (!latestDraft) {
      return res.json({
        ok: true,
        message: 'У тебя нет данных для подтверждения.'
      });
    }

    await submissionsService.confirmSubmission(latestDraft.id);

    return res.json({
      ok: true,
      message: 'Все ок. Данные подтверждены и сохранены.'
    });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
