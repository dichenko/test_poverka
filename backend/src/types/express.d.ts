import type { UserRole } from "@prisma/client";

declare global {
  namespace Express {
    interface Request {
      rawBody?: Buffer;
      auth?: {
        userId: string;
        maxUserId: string;
        role: UserRole;
      };
    }
  }
}

export {};
