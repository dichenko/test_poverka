const express = require('express');
const config = require('../config');
const employeesService = require('../services/employees.service');
const submissionsService = require('../services/submissions.service');
const botService = require('../services/bot.service');

const router = express.Router();

function pad2(value) {
  return String(value).padStart(2, '0');
}

function formatLogTimestamp(date) {
  const day = pad2(date.getDate());
  const month = pad2(date.getMonth() + 1);
  const hours = pad2(date.getHours());
  const minutes = pad2(date.getMinutes());
  const seconds = pad2(date.getSeconds());
  return `${day}/${month} ${hours}/${minutes}/${seconds}`;
}

function toNormalizedText(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function extractIncomingMessage(body) {
  const userIdCandidates = [
    body?.user_id,
    body?.userId,
    body?.sender_id,
    body?.senderId,
    body?.message?.sender?.user_id,
    body?.message?.recipient?.user_id,
    body?.from?.id,
    body?.user?.id,
    body?.chat?.id,
    body?.message?.from?.id,
    body?.message?.sender?.id,
    body?.payload?.user_id,
    body?.payload?.userId
  ];

  const textCandidates = [
    body?.text,
    body?.message?.body?.text,
    body?.message?.text,
    typeof body?.message === 'string' ? body.message : '',
    body?.body,
    body?.payload?.text,
    body?.event?.text
  ];

  const rawUserId = userIdCandidates.find((value) => value !== undefined && value !== null && String(value).trim());
  const rawText = textCandidates.find((value) => value !== undefined && value !== null && String(value).trim());

  return {
    userId: String(rawUserId || '').trim(),
    text: toNormalizedText(rawText)
  };
}

router.post('/webhook/max', async (req, res, next) => {
  try {
    const { userId, text } = extractIncomingMessage(req.body);
    const logUserId = userId || 'unknown';
    const logText = text || '<empty>';

    console.log(`${formatLogTimestamp(new Date())} ${logUserId} ${logText}`);
    if (!userId || !text) {
      console.log(`webhook raw payload: ${JSON.stringify(req.body)}`);
    }

    const providedSecret = req.header('x-max-secret');

    if (!providedSecret || providedSecret !== config.maxWebhookSecret) {
      return res.status(401).json({
        ok: false,
        error: 'Invalid x-max-secret header.'
      });
    }

    if (!userId) {
      return res.status(400).json({
        ok: false,
        error: 'user_id is required in webhook payload.'
      });
    }

    const employee = await employeesService.findByMaxUserId(userId);

    if (!employee || !employee.is_active) {
      return res.json({
        ok: true,
        message: `вас нет в базе данных. ваш MAX ID ${userId}`
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
