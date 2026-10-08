import { Injectable } from '@nestjs/common';
import appConfig from '../config/app.config';
import { logger } from '../common/logger/logger';

const RESEND_URL = 'https://api.resend.com/emails';

type Named = { name: string };
export type BookingEmailData = {
  id: string;
  status: string;
  date: Date;
  time: string;
  discount: number;
  finalPrice: number;
  services: Named[];
  subservices: Named[];
  address: {
    houseNo: string | null;
    street: string;
    landmark: string | null;
    city: string;
    state: string;
    zip: string;
  } | null;
  user: { name: string | null; email: string | null; phoneNumber: string };
};

const escapeHtml = (value: unknown) =>
  String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

@Injectable()
export class EmailService {
  // Never throws: email failures are logged so callers' requests still succeed.
  async send({ to, subject, html }: { to: string[]; subject: string; html: string }) {
    const { resendKey, from } = appConfig.email;
    if (!resendKey || !from) {
      logger.warn('RESEND_KEY or RESEND_FROM not set; skipping email', { subject });
      return;
    }

    try {
      const response = await fetch(RESEND_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from, to, subject, html }),
      });

      if (!response.ok) {
        logger.error('Failed to send email', { subject, status: response.status, body: await response.text() });
        return;
      }

      logger.info('Email sent', { subject, to });
    } catch (error) {
      logger.error('Failed to send email', { subject, error: error.message });
    }
  }

  async sendBookingCreated(booking: BookingEmailData) {
    const to = [...new Set([booking.user.email, appConfig.email.bookingNotifyTo].filter((e): e is string => !!e?.trim()))];

    const a = booking.address;
    const address = a
      ? [a.houseNo, a.street, a.landmark, a.city, a.state, a.zip].filter(Boolean).join(', ')
      : '-';
    const rows: [string, unknown][] = [
      ['Booking ID', booking.id],
      ['Status', booking.status],
      ['Date', booking.date.toISOString().slice(0, 10)],
      ['Time', booking.time],
      ['Services', booking.services.map((s) => s.name).join(', ')],
      ['Subservices', booking.subservices.map((s) => s.name).join(', ')],
      ['Discount', booking.discount],
      ['Final price', booking.finalPrice],
      ['Address', address],
      ['Customer', booking.user.name || '-'],
      ['Phone', booking.user.phoneNumber],
    ];

    const html = `
      <h2>New booking received</h2>
      <table cellpadding="6" style="border-collapse:collapse;font-family:sans-serif;font-size:14px">
        ${rows
          .map(
            ([label, value]) =>
              `<tr><td style="border:1px solid #ddd"><strong>${escapeHtml(label)}</strong></td><td style="border:1px solid #ddd">${escapeHtml(value)}</td></tr>`,
          )
          .join('')}
      </table>`;

    await this.send({ to, subject: `New booking #${booking.id.slice(0, 8)}`, html });
  }
}
