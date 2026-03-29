export const TOPUP_BALANCE_CALLBACK_PAYLOAD = "topup_balance";

export interface UserProfileMessageInput {
  maxUserId: string;
  fullName: string;
  organizationName: string | null;
  remainingPackages: string;
}

export function buildTopupBalanceKeyboard() {
  return [
    {
      type: "inline_keyboard",
      payload: {
        buttons: [
          [
            {
              type: "message",
              text: "Пополнить баланс",
              payload: TOPUP_BALANCE_CALLBACK_PAYLOAD
            }
          ]
        ]
      }
    }
  ];
}

export function buildUserProfileMessage(input: UserProfileMessageInput) {
  return {
    text: `Профиль пользователя:\n?? ID: ${input.maxUserId}\n?? ФИО: ${input.fullName}\n?? Организация: ${
      input.organizationName || "-"
    }\n? Осталось пакетов: ${input.remainingPackages}\n? Связь с админом @HelpMetr\n?? Связь с админом +79370332222`,
    attachments: buildTopupBalanceKeyboard()
  };
}
