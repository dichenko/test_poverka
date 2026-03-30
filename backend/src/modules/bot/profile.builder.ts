import { profileMessage } from "./bot.templates";

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
    text: profileMessage(input),
    attachments: buildTopupBalanceKeyboard(),
    format: "html" as const
  };
}