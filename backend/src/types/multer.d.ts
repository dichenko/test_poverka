declare module "multer";

declare global {
  namespace Express {
    interface Request {
      file?: {
        buffer: Buffer;
        originalname: string;
        mimetype: string;
      };
    }
  }
}

export {};
