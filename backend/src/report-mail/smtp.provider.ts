import nodemailer, { type Transporter } from "nodemailer";

export interface SendEmailInput {
  to: string | string[];
  subject: string;
  text: string;
  attachmentPath: string;
  attachmentName: string;
}

export interface MailProvider {
  sendEmail(input: SendEmailInput): Promise<void>;
  verify(): Promise<void>;
}

export interface SmtpMailProviderInput {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  password: string;
  from: string;
}

export class SmtpMailProvider implements MailProvider {
  private readonly transporter: Transporter;

  constructor(private readonly input: SmtpMailProviderInput) {
    this.transporter = nodemailer.createTransport({
      host: input.host,
      port: input.port,
      secure: input.secure,
      auth: {
        user: input.user,
        pass: input.password
      }
    });
  }

  async verify() {
    await this.transporter.verify();
  }

  async sendEmail(input: SendEmailInput) {
    await this.transporter.sendMail({
      from: this.input.from,
      to: input.to,
      subject: input.subject,
      text: input.text,
      attachments: [
        {
          filename: input.attachmentName,
          path: input.attachmentPath
        }
      ]
    });
  }
}
