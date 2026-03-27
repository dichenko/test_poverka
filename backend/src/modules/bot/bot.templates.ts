export function miniappOpenMessage(fullName: string) {
  return `Здравствуйте, ${fullName}. Откройте мини-приложение для передачи показаний.`;
}

export function unknownUserMessage(maxUserId: string) {
  return `Вас нет в базе. Ваш MaxID: ${maxUserId}`;
}

export function noPendingSubmissionMessage() {
  return "Нет заявок, ожидающих подтверждения.";
}

export function submissionConfirmedMessage() {
  return "Данные подтверждены и зафиксированы.";
}
