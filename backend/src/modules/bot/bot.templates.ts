export function miniappOpenMessage(fullName: string) {
  return `Здравствуйте, ${fullName}. Откройте мини-приложение для передачи показаний.`;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function unknownUserMessage(maxUserId: string) {
  return `Вас нет в базе.<br>
Свяжитесь с поддержкой: <a href="max://user/91634403">Метрология ГК</a><br>
Или по телефону +7(937)-033-22-22<br>
Ваш MaxID: ${escapeHtml(maxUserId)}`;
}

export function knownUserUnexpectedMessage(maxUserId: string, remainingPackages: string) {
  return `🆔 Ваш ID: ${maxUserId}
☰ Осталось на ${remainingPackages} пакетов для передачи
☎ Связь с админом @HelpMetr
📞 Связь с админом +79370332222`;
}

export function profileMessage(input: {
  maxUserId: string;
  fullName: string;
  organizationName: string | null;
  remainingPackages: string;
}) {
  const organizationName = input.organizationName || "-";
  return `Профиль пользователя:<br>
🆔 ID: ${escapeHtml(input.maxUserId)}<br>
👤 ФИО: ${escapeHtml(input.fullName)}<br>
🏢 Организация: ${escapeHtml(organizationName)}<br>
☰ Осталось пакетов: ${escapeHtml(input.remainingPackages)}<br>
☎ Связь с админом <a href="max://user/91634403">Метрология ГК</a>`;
}

export function submissionReviewMessage(input: {
  address: string | null;
  phone: string | null;
  waterType: string | null;
  equipmentTypeName: string | null;
  factoryNumber: string;
  productionYear: number | null;
  reading: string;
}) {
  const waterTypeLabel = input.waterType === "GVS" ? "ГВС" : input.waterType === "HVS" ? "ХВС" : "-";
  const phone = input.phone ? `+7${input.phone}` : "-";

  return `Проверьте заявку:\n\nАдрес: ${input.address || "-"}\nТелефон: ${phone}\nТип воды: ${waterTypeLabel}\nТип счетчика: ${input.equipmentTypeName || "-"}\nЗаводской номер: ${input.factoryNumber}\nГод выпуска: ${input.productionYear ?? "-"}\nПоказания: ${input.reading}`;
}

export function photoRequiredMessage() {
  return "Прикрепите одну фотографию счетчика.";
}

export function photoSavedAndConfirmedMessage() {
  return "Фотография получена. Заявка подтверждена и сохранена.";
}

export function insufficientBalanceMessage() {
  return "Недостаточно средств на балансе организации. Отправка не выполнена. Пополните баланс и попробуйте снова.";
}

export function noPendingSubmissionMessage() {
  return "Нет заявок, ожидающих подтверждения.";
}

export function submissionCancelledMessage() {
  return "Заявка отменена и удалена.";
}

export function submissionConfirmedMessage() {
  return "Данные подтверждены и зафиксированы.";
}