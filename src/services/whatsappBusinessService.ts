/**
 * NetPulse ISP OS - WhatsApp Business Cloud API Service (Mock Integration)
 * 
 * Simulates Meta Graph API v19.0 endpoints (`POST /v19.0/{phone_number_id}/messages`)
 * for automated telecom workflows:
 * - Instant Payment Receipts with PDF receipt links
 * - Mass Area Outage Alerts & Network Restored broadcasts
 * - Complaint Ticket SLA assignments & Resolution notifications
 * - Automated Overdue Reminders & Walled-Garden isolation alerts
 * 
 * Realistic simulation includes:
 * - WhatsApp Business Account (WABA) credentials & phone number IDs
 * - International MSISDN formatting (E.164)
 * - Official Cloud API JSON Request & Response structures
 * - Asynchronous webhook delivery simulation (`sent` -> `delivered` -> `read`)
 * - Persistent local audit trail
 */

import { WhatsAppNotificationLog } from '../types/isp';

export interface WhatsAppCloudApiConfig {
  apiVersion: string;
  wabaId: string;
  phoneNumberId: string;
  businessName: string;
  webhookVerifyToken: string;
  isMockMode: boolean;
}

export const DEFAULT_WHATSAPP_CONFIG: WhatsAppCloudApiConfig = {
  apiVersion: 'v19.0',
  wabaId: '394820194820192',
  phoneNumberId: '109283749281726',
  businessName: 'Youth Net Broadband Services (Official)',
  webhookVerifyToken: 'youthnet_wa_webhook_verify_sec_9941',
  isMockMode: true,
};

export interface WhatsAppTemplateParameter {
  type: 'text' | 'currency' | 'date_time';
  text?: string;
  currency?: {
    fallback_value: string;
    code: string;
    amount_1000: number;
  };
  date_time?: {
    fallback_value: string;
  };
}

export interface WhatsAppTemplateComponent {
  type: 'header' | 'body' | 'button';
  sub_type?: 'url' | 'quick_reply';
  index?: number;
  parameters?: WhatsAppTemplateParameter[];
}

export interface WhatsAppCloudApiMessagePayload {
  messaging_product: 'whatsapp';
  recipient_type: 'individual';
  to: string; // e.g. "923001234567"
  type: 'template' | 'text';
  template?: {
    name: string;
    language: {
      code: string; // e.g. "en_US" or "ur"
    };
    components: WhatsAppTemplateComponent[];
  };
  text?: {
    preview_url?: boolean;
    body: string;
  };
}

export interface WhatsAppCloudApiResponse {
  messaging_product: 'whatsapp';
  contacts: Array<{
    input: string;
    wa_id: string;
  }>;
  messages: Array<{
    id: string; // e.g. "wamid.HBgMN...="
    message_status?: 'accepted' | 'held_for_quality_assessment';
  }>;
  mockSimulatedAt: string;
}

export interface WhatsAppAuditRecord {
  id: string;
  wamid: string;
  recipientPhone: string;
  recipientName: string;
  templateName: string;
  type: WhatsAppNotificationLog['type'];
  status: 'sent' | 'delivered' | 'read' | 'failed';
  renderedText: string;
  rawPayload: WhatsAppCloudApiMessagePayload;
  rawResponse: WhatsAppCloudApiResponse;
  timestamp: string;
  deliveredAt?: string;
  readAt?: string;
}

// Payment receipt parameters
export interface PaymentReceiptPayload {
  customerName: string;
  customerPhone: string;
  invoiceNumber: string;
  receiptNumber: string;
  amountPaid: number;
  paymentMethod: string;
  paidDate?: string;
  planName?: string;
  pppoeUsername?: string;
  collectorName?: string;
  currencySymbol?: string;
}

// Outage broadcast parameters
export interface OutageAlertPayload {
  recipientPhone: string;
  recipientName: string;
  areaNode: string;
  incidentTitle: string;
  cause: string;
  severity: 'minor' | 'major' | 'critical';
  estimatedHours: number;
  isRestored?: boolean;
  resolutionNotes?: string;
}

// Complaint ticket notification parameters
export interface TicketNotificationPayload {
  customerPhone: string;
  customerName: string;
  ticketNumber: string;
  title: string;
  category: string;
  priority: string;
  areaNode: string;
  status: 'assigned' | 'investigating' | 'resolved' | 'closed';
  technicianName?: string;
  technicianPhone?: string;
  resolutionNotes?: string;
}

const STORAGE_KEY = 'netpulse_wa_cloud_api_audit_logs';

/**
 * Normalizes phone numbers to WhatsApp international E.164 digits without "+"
 * e.g., "+92 300 1234567" -> "923001234567", "03001234567" -> "923001234567"
 */
export function formatE164Phone(phone: string): string {
  if (!phone) return '923000000000';
  let cleaned = phone.replace(/[^\d]/g, '');
  if (cleaned.startsWith('0') && cleaned.length === 11) {
    cleaned = '92' + cleaned.slice(1);
  }
  if (!cleaned.startsWith('92') && cleaned.length === 10) {
    cleaned = '92' + cleaned;
  }
  return cleaned;
}

class WhatsAppBusinessService {
  private config: WhatsAppCloudApiConfig = DEFAULT_WHATSAPP_CONFIG;
  private auditLogs: WhatsAppAuditRecord[] = [];
  private listeners: Array<(record: WhatsAppAuditRecord) => void> = [];

  constructor() {
    this.loadFromStorage();
  }

  private loadFromStorage(): void {
    if (typeof window === 'undefined') return;
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        this.auditLogs = JSON.parse(saved);
      }
    } catch {
      this.auditLogs = [];
    }
  }

  private saveToStorage(): void {
    if (typeof window === 'undefined') return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.auditLogs.slice(0, 100)));
    } catch {
      // Ignore quota errors
    }
  }

  public subscribe(listener: (record: WhatsAppAuditRecord) => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  private notify(record: WhatsAppAuditRecord): void {
    this.listeners.forEach((fn) => {
      try {
        fn(record);
      } catch (e) {
        console.error('WhatsApp listener error:', e);
      }
    });
  }

  /**
   * Generates a realistic WhatsApp Cloud API WAMID
   */
  private generateWamid(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    let rand = '';
    for (let i = 0; i < 40; i++) {
      rand += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return `wamid.HBgM${rand}=`;
  }

  /**
   * Simulates WhatsApp Cloud API POST `/v19.0/{phone_number_id}/messages`
   */
  public async dispatchCloudApiMessage(
    payload: WhatsAppCloudApiMessagePayload,
    meta: {
      recipientName: string;
      type: WhatsAppNotificationLog['type'];
      renderedText: string;
    }
  ): Promise<{ response: WhatsAppCloudApiResponse; auditRecord: WhatsAppAuditRecord }> {
    const wamid = this.generateWamid();
    const now = new Date();

    const mockResponse: WhatsAppCloudApiResponse = {
      messaging_product: 'whatsapp',
      contacts: [
        {
          input: payload.to,
          wa_id: payload.to,
        },
      ],
      messages: [
        {
          id: wamid,
          message_status: 'accepted',
        },
      ],
      mockSimulatedAt: now.toISOString(),
    };

    const auditRecord: WhatsAppAuditRecord = {
      id: `wa-audit-${Date.now()}-${Math.floor(100 + Math.random() * 900)}`,
      wamid,
      recipientPhone: `+${payload.to}`,
      recipientName: meta.recipientName,
      templateName: payload.template?.name || 'custom_text',
      type: meta.type,
      status: 'sent',
      renderedText: meta.renderedText,
      rawPayload: payload,
      rawResponse: mockResponse,
      timestamp: now.toISOString(),
    };

    this.auditLogs.unshift(auditRecord);
    this.saveToStorage();
    this.notify(auditRecord);

    // Simulate realistic webhook status updates asynchronously:
    // 1. "delivered" after 600ms
    setTimeout(() => {
      const target = this.auditLogs.find((r) => r.wamid === wamid);
      if (target) {
        target.status = 'delivered';
        target.deliveredAt = new Date().toISOString();
        this.saveToStorage();
        this.notify({ ...target });
      }
    }, 600);

    // 2. "read" after 1800ms
    setTimeout(() => {
      const target = this.auditLogs.find((r) => r.wamid === wamid);
      if (target) {
        target.status = 'read';
        target.readAt = new Date().toISOString();
        this.saveToStorage();
        this.notify({ ...target });
      }
    }, 1800);

    return { response: mockResponse, auditRecord };
  }

  /**
   * WORKFLOW 1: Automated Payment Receipt
   * Triggered upon marking an invoice as paid or recording cash collection.
   */
  public async sendAutomatedPaymentReceipt(
    data: PaymentReceiptPayload
  ): Promise<{ response: WhatsAppCloudApiResponse; auditRecord: WhatsAppAuditRecord; messageText: string }> {
    const formattedTo = formatE164Phone(data.customerPhone);
    const curr = data.currencySymbol || 'Rs.';
    const paidAt = data.paidDate
      ? new Date(data.paidDate).toLocaleString('en-PK', { dateStyle: 'medium', timeStyle: 'short' })
      : new Date().toLocaleString('en-PK', { dateStyle: 'medium', timeStyle: 'short' });
    const methodClean = (data.paymentMethod || 'cash').replace('_', ' ').toUpperCase();

    const renderedText =
      `🧾 *YOUTH NET BROADBAND - OFFICIAL PAYMENT RECEIPT*\n` +
      `────────────────────────────\n` +
      `Dear *${data.customerName}*,\n` +
      `Thank you! We have received your subscription payment.\n\n` +
      `💳 *Receipt Number:* ${data.receiptNumber}\n` +
      `📄 *Invoice Ref:* ${data.invoiceNumber}\n` +
      `💰 *Amount Paid:* *${curr} ${data.amountPaid.toLocaleString()}*\n` +
      `🚀 *Plan / Package:* ${data.planName || 'High-Speed Broadband'}\n` +
      `👤 *PPPoE Account:* ${data.pppoeUsername || '@subscriber'}\n` +
      `💵 *Payment Channel:* ${methodClean}\n` +
      `👮 *Collected By:* ${data.collectorName || 'Office Accounts Desk'}\n` +
      `🕒 *Date & Time:* ${paidAt}\n\n` +
      `🟢 *Service Status:* Active & Unlimited\n` +
      `Your high-speed bandwidth connection is renewed. Thank you for choosing Youth Net Services!`;

    const cloudPayload: WhatsAppCloudApiMessagePayload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: formattedTo,
      type: 'template',
      template: {
        name: 'isp_payment_receipt_instant',
        language: { code: 'en_US' },
        components: [
          {
            type: 'header',
            parameters: [
              {
                type: 'text',
                text: data.receiptNumber,
              },
            ],
          },
          {
            type: 'body',
            parameters: [
              { type: 'text', text: data.customerName },
              { type: 'text', text: `${curr} ${data.amountPaid.toLocaleString()}` },
              { type: 'text', text: data.invoiceNumber },
              { type: 'text', text: methodClean },
              { type: 'text', text: paidAt },
            ],
          },
          {
            type: 'button',
            sub_type: 'url',
            index: 0,
            parameters: [
              {
                type: 'text',
                text: data.receiptNumber,
              },
            ],
          },
        ],
      },
    };

    const { response, auditRecord } = await this.dispatchCloudApiMessage(cloudPayload, {
      recipientName: data.customerName,
      type: 'payment_receipt',
      renderedText,
    });

    return { response, auditRecord, messageText: renderedText };
  }

  /**
   * WORKFLOW 2: Area Outage & Fiber Cut Broadcast Notice
   * Dispatches automated alerts to all subscribers connected to an impacted PON node or sector.
   */
  public async sendAreaOutageNotification(
    data: OutageAlertPayload
  ): Promise<{ response: WhatsAppCloudApiResponse; auditRecord: WhatsAppAuditRecord; messageText: string }> {
    const formattedTo = formatE164Phone(data.recipientPhone);

    let renderedText = '';
    let templateName = 'isp_area_outage_alert';

    if (data.isRestored) {
      templateName = 'isp_area_outage_restored';
      renderedText =
        `🟢 *YOUTH NET BROADBAND - SERVICE RESTORED*\n` +
        `────────────────────────────\n` +
        `Dear *${data.recipientName}*,\n\n` +
        `We are pleased to inform you that internet service on *${data.areaNode}* has been *FULLY RESTORED*.\n\n` +
        `🔧 *Resolution Notes:* ${data.resolutionNotes || 'Optical fiber spliced, dBm signal calibrated, and core routing cleared.'}\n` +
        `🕒 *Restored At:* ${new Date().toLocaleTimeString()} on ${new Date().toLocaleDateString()}\n\n` +
        `If your router fails to connect automatically, please restart your optical ONT/router for 30 seconds.\n` +
        `_Youth Net NOC Transmission & Fiber Operations_`;
    } else {
      const severityIcon = data.severity === 'critical' ? '🔴 CRITICAL OUTAGE' : '🟡 NETWORK DEGRADATION';
      renderedText =
        `🚨 *YOUTH NET BROADBAND - EMERGENCY AREA OUTAGE NOTICE*\n` +
        `────────────────────────────\n` +
        `Dear *${data.recipientName}*,\n\n` +
        `We have detected a disruption affecting your sector: *${data.areaNode}*.\n\n` +
        `⚠️ *Incident:* ${data.incidentTitle}\n` +
        `⚡ *Severity:* ${severityIcon}\n` +
        `🔍 *Identified Cause:* ${data.cause}\n` +
        `⏱️ *Estimated Restoration Time:* ~${data.estimatedHours} Hour(s)\n\n` +
        `Our emergency fiber optic splicing team is already on site. We sincerely apologize for any inconvenience caused.\n` +
        `_Youth Net 24/7 NOC Command Center_`;
    }

    const cloudPayload: WhatsAppCloudApiMessagePayload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: formattedTo,
      type: 'template',
      template: {
        name: templateName,
        language: { code: 'en_US' },
        components: [
          {
            type: 'body',
            parameters: [
              { type: 'text', text: data.recipientName },
              { type: 'text', text: data.areaNode },
              { type: 'text', text: data.isRestored ? 'RESTORED' : data.incidentTitle },
              { type: 'text', text: data.isRestored ? 'Completed' : `${data.estimatedHours} Hours` },
            ],
          },
        ],
      },
    };

    const { response, auditRecord } = await this.dispatchCloudApiMessage(cloudPayload, {
      recipientName: data.recipientName,
      type: 'outage_alert',
      renderedText,
    });

    return { response, auditRecord, messageText: renderedText };
  }

  /**
   * WORKFLOW 3: Complaint Ticket SLA Status Notification
   * Dispatches updates when tickets are created, assigned to technicians, or resolved.
   */
  public async sendTicketStatusNotification(
    data: TicketNotificationPayload
  ): Promise<{ response: WhatsAppCloudApiResponse; auditRecord: WhatsAppAuditRecord; messageText: string }> {
    const formattedTo = formatE164Phone(data.customerPhone);
    let renderedText = '';
    const templateName = data.status === 'resolved' ? 'isp_ticket_resolved' : 'isp_ticket_assigned';

    if (data.status === 'resolved') {
      renderedText =
        `✅ *YOUTH NET BROADBAND - COMPLAINT RESOLVED*\n` +
        `────────────────────────────\n` +
        `Dear *${data.customerName}*,\n` +
        `Your complaint ticket *#${data.ticketNumber}* has been marked as *RESOLVED*.\n\n` +
        `📋 *Issue Category:* ${data.category.replace('_', ' ').toUpperCase()}\n` +
        `📝 *Resolution Summary:* ${data.resolutionNotes || 'Optical line tested and verified working at subscriber premises.'}\n` +
        `⏱️ *Resolved At:* ${new Date().toLocaleTimeString()} on ${new Date().toLocaleDateString()}\n\n` +
        `Thank you for your patience!`;
    } else {
      renderedText =
        `📋 *YOUTH NET BROADBAND - TECHNICIAN DISPATCHED*\n` +
        `────────────────────────────\n` +
        `Dear *${data.customerName}*,\n` +
        `We have assigned your complaint ticket *#${data.ticketNumber}* to our area field technician.\n\n` +
        `🎫 *Issue:* ${data.title}\n` +
        `🛵 *Assigned Field Tech:* *${data.technicianName || 'Youth Net Area Technician'}*\n` +
        `📞 *Technician Contact:* ${data.technicianPhone || '+92 300 0000000'}\n` +
        `📍 *Coverage Node:* ${data.areaNode}\n\n` +
        `Our technician will contact you shortly before arrival.`;
    }

    const cloudPayload: WhatsAppCloudApiMessagePayload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: formattedTo,
      type: 'template',
      template: {
        name: templateName,
        language: { code: 'en_US' },
        components: [
          {
            type: 'body',
            parameters: [
              { type: 'text', text: data.customerName },
              { type: 'text', text: data.ticketNumber },
              { type: 'text', text: data.status.toUpperCase() },
              { type: 'text', text: data.technicianName || 'NOC Tech' },
            ],
          },
        ],
      },
    };

    const { response, auditRecord } = await this.dispatchCloudApiMessage(cloudPayload, {
      recipientName: data.customerName,
      type: 'ticket_update',
      renderedText,
    });

    return { response, auditRecord, messageText: renderedText };
  }

  /**
   * Retrieves all simulated WhatsApp Cloud API audit logs
   */
  public getAuditLogs(): WhatsAppAuditRecord[] {
    return [...this.auditLogs];
  }

  /**
   * Clears audit logs from memory and local storage
   */
  public clearAuditLogs(): void {
    this.auditLogs = [];
    if (typeof window !== 'undefined') {
      localStorage.removeItem(STORAGE_KEY);
    }
  }

  /**
   * Returns current WABA configuration
   */
  public getConfig(): WhatsAppCloudApiConfig {
    return { ...this.config };
  }
}

// Singleton export
export const whatsappBusinessService = new WhatsAppBusinessService();
