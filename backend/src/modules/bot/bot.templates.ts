export function miniappOpenMessage(fullName: string) {
  return `Здравствуйте, ${fullName}. Откройте мини-приложение для передачи показаний.`;
}

export function unknownUserMessage(maxUserId: string) {
  return `Доступ не предоставлен. Ваш MAX ID: ${maxUserId}. Обратитесь к администратору.`;
}

export function noPendingSubmissionMessage() {
  return "Нет заявок, ожидающих подтверждения.";
}

export function submissionConfirmedMessage() {
  return "Данные подтверждены и зафиксированы.";
}
