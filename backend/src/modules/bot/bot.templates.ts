export function miniappOpenMessage(fullName: string) {
  return `Здравствуйте, ${fullName}. Откройте мини-приложение для передачи показаний.`;
}

export function unknownUserMessage(maxUserId: string) {
  return `Вас нет в базе. Ваш MaxID: ${maxUserId}`;
}

export function knownUserUnexpectedMessage(maxUserId: string, remainingPackages: string) {
  return `🆔 Ваш ID: ${maxUserId}
☰ Осталось на ${remainingPackages} пакетов для передачи
☎ Связь с админом @HelpMetr
📞 Связь с админом +79370332222`;
}

export function noPendingSubmissionMessage() {
  return "Нет заявок, ожидающих подтверждения.";
}

export function submissionConfirmedMessage() {
  return "Данные подтверждены и зафиксированы.";
}
