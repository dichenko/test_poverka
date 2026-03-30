export function miniappOpenMessage(fullName: string) {
  return `Здравствуйте, ${fullName}. Откройте мини-приложение для передачи показаний.`;
}

export function unknownUserMessage(maxUserId: string) {
  return `Вас нет в базе.
[Свяжитесь с поддержкой в Max](max://user/91634403)
Или по телефону +7(937)-033-22-22
Ваш MaxID: ${maxUserId}`;
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
  return `Профиль пользователя:
🆔 ID: ${input.maxUserId}
👤 ФИО: ${input.fullName}
🏢 Организация: ${input.organizationName || "-"}
☰ Осталось пакетов: ${input.remainingPackages}
☎ Связь с админом @HelpMetr
📞 Связь с админом +79370332222`;
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
