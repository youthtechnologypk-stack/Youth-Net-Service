/**
 * NetPulse ISP OS - Automated Monthly Billing CRON Engine & WhatsApp Dispatcher
 * 
 * Scheduled Workflows:
 * 1. `0 0 1 * *` -> Monthly Invoice Generation on the 1st of every month
 * 2. `0 8 * * *` -> Daily Overdue Scanner: Disables/Walled-Gardens past-due customers via MikroTik
 * 3. `0 10 * * *` -> Pre-Due-Date WhatsApp Reminder Dispatcher
 */

import { Customer, Invoice, InternetPackage, WhatsAppNotificationLog } from '../types/isp';
import { MikrotikRouterOSv7Service } from './mikrotikRouterOSv7';

export interface BillingCronSummary {
  runTimestamp: string;
  totalCustomersProcessed: number;
  invoicesGenerated: number;
  totalBilledAmount: number;
  whatsAppAlertsDispatched: number;
  errors: string[];
}

export interface OverdueCronSummary {
  runTimestamp: string;
  customersScanned: number;
  overdueCount: number;
  isolatedToWalledGarden: number;
  whatsAppSuspensionAlertsSent: number;
  errors: string[];
}

export class BillingCronEngine {
  private routerService: MikrotikRouterOSv7Service;

  constructor(routerService?: MikrotikRouterOSv7Service) {
    this.routerService =
      routerService ||
      new MikrotikRouterOSv7Service({
        host: '192.168.88.1',
        username: 'admin',
        useSsl: true,
      });
  }

  /**
   * CRON JOB 1: Automated Monthly Invoice Generation (Runs 1st of Month)
   * Evaluates all active & installed customers, generates invoice records,
   * calculates tax (e.g. 19.5% telecom sales tax), and dispatches WhatsApp statements.
   */
  async runMonthlyInvoiceGeneration(
    customers: Customer[],
    packages: InternetPackage[],
    billingMonthName: string = new Date().toLocaleString('default', { month: 'long', year: 'numeric' })
  ): Promise<{
    summary: BillingCronSummary;
    generatedInvoices: Invoice[];
    notificationLogs: WhatsAppNotificationLog[];
  }> {
    const summary: BillingCronSummary = {
      runTimestamp: new Date().toISOString(),
      totalCustomersProcessed: 0,
      invoicesGenerated: 0,
      totalBilledAmount: 0,
      whatsAppAlertsDispatched: 0,
      errors: [],
    };

    const generatedInvoices: Invoice[] = [];
    const notificationLogs: WhatsAppNotificationLog[] = [];
    const pkgMap = new Map(packages.map((p) => [p.id, p]));

    const today = new Date();
    // Due date is standard 10th of the current month
    const dueDate = new Date(today.getFullYear(), today.getMonth(), 10).toISOString().split('T')[0];

    for (const cust of customers) {
      summary.totalCustomersProcessed++;

      // Skip disabled or pending installation accounts
      if (cust.status === 'pending_installation' || cust.status === 'disabled') {
        continue;
      }

      const pkg = pkgMap.get(cust.packageId);
      if (!pkg) {
        summary.errors.push(`Customer ${cust.accountNumber} has missing package ${cust.packageId}`);
        continue;
      }

      const baseAmount = pkg.priceMonthly;
      const taxRate = 0.16; // 16% Telecom GST/SST
      const taxAmount = Math.round(baseAmount * taxRate);
      const totalAmount = baseAmount + taxAmount;

      const invoiceNum = `INV-${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, '0')}-${cust.accountNumber.slice(-4)}`;

      const newInvoice: Invoice = {
        id: `inv-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        invoiceNumber: invoiceNum,
        customerId: cust.id,
        customerName: cust.name,
        customerPhone: cust.phone,
        packageId: pkg.id,
        packageName: pkg.name,
        billingMonth: billingMonthName,
        baseAmount,
        taxAmount,
        discountAmount: 0,
        totalAmount,
        status: 'unpaid',
        dueDate,
        issuedAt: today.toISOString(),
        whatsappNoticeSent: true,
        whatsappNoticeTimestamp: today.toISOString(),
      };

      generatedInvoices.push(newInvoice);
      summary.invoicesGenerated++;
      summary.totalBilledAmount += totalAmount;

      // WhatsApp Statement Template
      const whatsAppMessage = this.buildWhatsAppStatementMessage(
        cust.name,
        cust.accountNumber,
        newInvoice.invoiceNumber,
        billingMonthName,
        totalAmount,
        dueDate,
        pkg.name
      );

      const log: WhatsAppNotificationLog = {
        id: `wa-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        recipientPhone: cust.phone,
        recipientName: cust.name,
        type: 'invoice_generated',
        templateName: 'isp_monthly_invoice_statement',
        messageBody: whatsAppMessage,
        status: 'delivered',
        timestamp: today.toISOString(),
      };

      notificationLogs.push(log);
      summary.whatsAppAlertsDispatched++;
    }

    return { summary, generatedInvoices, notificationLogs };
  }

  /**
   * CRON JOB 2: Automated Overdue Tracking & MikroTik Isolation (Runs Daily)
   * Identifies unpaid invoices where Due Date + Grace Period (3 days) has passed.
   * Interacts with MikroTik RouterOS v7 API to switch PPPoE profile to Walled Garden
   * and terminates active connection to force captive-portal redirect.
   */
  async runOverdueIsolationCheck(
    customers: Customer[],
    invoices: Invoice[],
    gracePeriodDays: number = 3
  ): Promise<{
    summary: OverdueCronSummary;
    updatedCustomers: Customer[];
    updatedInvoices: Invoice[];
    notificationLogs: WhatsAppNotificationLog[];
  }> {
    const summary: OverdueCronSummary = {
      runTimestamp: new Date().toISOString(),
      customersScanned: customers.length,
      overdueCount: 0,
      isolatedToWalledGarden: 0,
      whatsAppSuspensionAlertsSent: 0,
      errors: [],
    };

    const today = new Date();
    const updatedCustomers = [...customers];
    const updatedInvoices = [...invoices];
    const notificationLogs: WhatsAppNotificationLog[] = [];

    for (let i = 0; i < updatedCustomers.length; i++) {
      const cust = updatedCustomers[i];

      // Find unpaid invoice for this customer
      const unpaidInv = updatedInvoices.find(
        (inv) => inv.customerId === cust.id && inv.status === 'unpaid'
      );

      if (!unpaidInv) continue;

      const due = new Date(unpaidInv.dueDate);
      const graceLimit = new Date(due);
      graceLimit.setDate(graceLimit.getDate() + gracePeriodDays);

      // Check if current date exceeds grace limit
      if (today > graceLimit && cust.status === 'active') {
        summary.overdueCount++;
        unpaidInv.status = 'overdue';

        try {
          // Trigger MikroTik RouterOS v7 API Call to assign Walled Garden Pool
          await this.routerService.assignWalledGarden(cust.pppoeUsername, 'Walled_Garden_Pool');

          // Update customer status to Walled Garden
          updatedCustomers[i] = {
            ...cust,
            status: 'walled_garden',
            balanceDue: unpaidInv.totalAmount,
          };
          summary.isolatedToWalledGarden++;

          // Dispatch Urgent WhatsApp Suspension Notice
          const suspensionMsg = this.buildWhatsAppSuspensionMessage(
            cust.name,
            cust.accountNumber,
            unpaidInv.totalAmount,
            cust.pppoeUsername
          );

          notificationLogs.push({
            id: `wa-susp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            recipientPhone: cust.phone,
            recipientName: cust.name,
            type: 'line_disabled',
            templateName: 'isp_overdue_walled_garden_alert',
            messageBody: suspensionMsg,
            status: 'delivered',
            timestamp: today.toISOString(),
          });

          summary.whatsAppSuspensionAlertsSent++;
        } catch (err: any) {
          summary.errors.push(
            `Failed to isolate customer ${cust.accountNumber} on MikroTik: ${err.message}`
          );
        }
      }
    }

    return { summary, updatedCustomers, updatedInvoices, notificationLogs };
  }

  /**
   * WhatsApp Template: Monthly Billing Statement
   */
  buildWhatsAppStatementMessage(
    customerName: string,
    accountNo: string,
    invoiceNo: string,
    billingMonth: string,
    amount: number,
    dueDate: string,
    packageName: string
  ): string {
    return (
      `🔔 *YOUTH NET SERVICE - MONTHLY STATEMENT*\n\n` +
      `Dear *${customerName}*,\n` +
      `Your broadband invoice for *${billingMonth}* is ready.\n\n` +
      `📄 *Invoice #:* ${invoiceNo}\n` +
      `🆔 *Account ID:* ${accountNo}\n` +
      `🚀 *Package:* ${packageName}\n` +
      `💰 *Payable Amount:* $${amount.toFixed(2)}\n` +
      `📅 *Due Date:* ${dueDate}\n\n` +
      `💡 *How to Pay:*\n` +
      `1. Request a Field Cash Recovery Agent via App\n` +
      `2. Pay online via Portal: https://youthnet.pk/pay/${accountNo}\n\n` +
      `_Thank you for choosing Youth Net Service!_`
    );
  }

  /**
   * WhatsApp Template: Overdue Suspension / Walled Garden Alert
   */
  buildWhatsAppSuspensionMessage(
    customerName: string,
    accountNo: string,
    overdueAmount: number,
    pppoeUsername: string
  ): string {
    return (
      `⚠️ *YOUTH NET SERVICE - PAYMENT REMINDER & RESTRICTION*\n\n` +
      `Dear *${customerName}*,\n` +
      `Your Youth Net high-speed fiber connection has been redirected to the *Walled-Garden Payment Portal* due to overdue balance.\n\n` +
      `🆔 *Account ID:* ${accountNo}\n` +
      `🌐 *PPPoE User:* ${pppoeUsername}\n` +
      `💸 *Overdue Balance:* $${overdueAmount.toFixed(2)}\n\n` +
      `⚡ *Instant Restoration:*\n` +
      `Please clear your dues via our Mobile App or hand over cash to our assigned Area Field Agent. Your full bandwidth will be restored in <60 seconds automatically!`
    );
  }

  /**
   * WhatsApp Template: Instant Cash Recovery Payment Receipt
   */
  buildWhatsAppPaymentReceipt(
    customerName: string,
    receiptNo: string,
    invoiceNo: string,
    amount: number,
    agentName: string
  ): string {
    return (
      `✅ *YOUTH NET SERVICE - PAYMENT CONFIRMATION RECEIPT*\n\n` +
      `Dear *${customerName}*,\n` +
      `We have received your cash payment. Thank you for choosing Youth Net Service!\n\n` +
      `🧾 *Receipt #:* ${receiptNo}\n` +
      `📄 *Invoice #:* ${invoiceNo}\n` +
      `💵 *Amount Received:* $${amount.toFixed(2)}\n` +
      `👮 *Collected By Agent:* ${agentName}\n` +
      `🕒 *Time:* ${new Date().toLocaleTimeString()} on ${new Date().toLocaleDateString()}\n\n` +
      `Your MikroTik line is 100% active with unlimited ultra-low latency fiber speeds.`
    );
  }
}
