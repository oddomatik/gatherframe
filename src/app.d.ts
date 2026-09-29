import type { AdminUser } from '$server/auth';

declare global {
  namespace App {
    interface Locals {
      admin: AdminUser | null;
      requestId: string;
      demo?: boolean;
    }
    interface Error {
      message: string;
      code?: string;
    }
  }
}
export {};
