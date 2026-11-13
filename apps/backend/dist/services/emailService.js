"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendPassengerReportEmail = sendPassengerReportEmail;
const nodemailer_1 = __importDefault(require("nodemailer"));
const dotenv_1 = __importDefault(require("dotenv"));
const path_1 = __importDefault(require("path"));
// Load .env
dotenv_1.default.config();
dotenv_1.default.config({ path: path_1.default.resolve(__dirname, '../../.env') });
const ADMIN_EMAIL = 'exnavodayanfoundationcoe@gmail.com';
function getTransporter() {
    const smtpHost = process.env.SMTP_HOST || 'smtp.gmail.com';
    const smtpPort = parseInt(process.env.SMTP_PORT || '465', 10);
    const smtpUser = process.env.SMTP_USER || process.env.EMAIL_USER || 'exnavodayanfoundationcoe@gmail.com';
    const smtpPass = (process.env.SMTP_PASS || process.env.EMAIL_PASS || 'gogveceglbrjkqfo').replace(/\s+/g, '');
    if (smtpUser && smtpPass) {
        return nodemailer_1.default.createTransport({
            host: smtpHost,
            port: smtpPort,
            secure: smtpPort === 465,
            auth: {
                user: smtpUser,
                pass: smtpPass
            }
        });
    }
    return null;
}
async function sendPassengerReportEmail(data) {
    const mapLink = data.latitude && data.longitude
        ? `https://www.google.com/maps?q=${data.latitude},${data.longitude}`
        : 'Not available';
    const dateStr = (data.timestamp || new Date()).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
    const htmlContent = `
    <div style="font-family: Arial, sans-serif; background-color: #0f172a; color: #f8fafc; padding: 24px; border-radius: 12px; max-width: 600px; margin: 0 auto; border: 1px solid #334155;">
      <div style="display: flex; align-items: center; border-bottom: 2px solid #ef4444; padding-bottom: 12px; margin-bottom: 16px;">
        <h2 style="color: #ef4444; margin: 0; font-size: 20px;">⚠️ UP Bus Passenger Alert / Report</h2>
      </div>

      <p style="font-size: 14px; color: #cbd5e1; margin-bottom: 20px;">
        A passenger has submitted an operational alert for bus <strong>${data.busRegNo}</strong>.
      </p>

      <table style="width: 100%; border-collapse: collapse; font-size: 14px; margin-bottom: 20px;">
        <tr>
          <td style="padding: 8px 12px; background: #1e293b; color: #94a3b8; width: 35%; border-radius: 4px 0 0 4px;"><strong>Bus Reg No:</strong></td>
          <td style="padding: 8px 12px; background: #1e293b; color: #38bdf8; font-weight: bold; border-radius: 0 4px 4px 0;">${data.busRegNo}</td>
        </tr>
        ${data.routeName ? `
        <tr>
          <td style="padding: 8px 12px; color: #94a3b8;"><strong>Route:</strong></td>
          <td style="padding: 8px 12px; color: #f8fafc;">${data.routeName}</td>
        </tr>` : ''}
        <tr>
          <td style="padding: 8px 12px; background: #1e293b; color: #94a3b8;"><strong>Issue Type:</strong></td>
          <td style="padding: 8px 12px; background: #1e293b; color: #f59e0b; font-weight: bold;">${data.reportType}</td>
        </tr>
        <tr>
          <td style="padding: 8px 12px; color: #94a3b8;"><strong>Passenger Note:</strong></td>
          <td style="padding: 8px 12px; color: #f8fafc;">${data.description || 'No description provided'}</td>
        </tr>
        ${data.passengerContact ? `
        <tr>
          <td style="padding: 8px 12px; background: #1e293b; color: #94a3b8;"><strong>Contact / Info:</strong></td>
          <td style="padding: 8px 12px; background: #1e293b; color: #a3e635;">${data.passengerContact}</td>
        </tr>` : ''}
        <tr>
          <td style="padding: 8px 12px; color: #94a3b8;"><strong>Reported Time:</strong></td>
          <td style="padding: 8px 12px; color: #f8fafc;">${dateStr}</td>
        </tr>
        <tr>
          <td style="padding: 8px 12px; background: #1e293b; color: #94a3b8;"><strong>GPS Location:</strong></td>
          <td style="padding: 8px 12px; background: #1e293b;">
            ${data.latitude && data.longitude ? `<a href="${mapLink}" target="_blank" style="color: #60a5fa; text-decoration: underline;">View Live on Google Maps (${data.latitude.toFixed(4)}, ${data.longitude.toFixed(4)})</a>` : 'Location not available'}
          </td>
        </tr>
      </table>

      <div style="font-size: 12px; color: #64748b; border-top: 1px solid #334155; padding-top: 12px; text-align: center;">
        UP Bus Live Fleet System • Automated Real-time Dispatch
      </div>
    </div>
  `;
    const transporter = getTransporter();
    const fromUser = process.env.SMTP_USER || process.env.EMAIL_USER || 'exnavodayanfoundationcoe@gmail.com';
    if (transporter) {
        try {
            await transporter.sendMail({
                from: `"UP Bus Alert System" <${fromUser}>`,
                to: ADMIN_EMAIL,
                subject: `⚠️ [UP BUS REPORT] ${data.reportType} - Bus ${data.busRegNo}`,
                html: htmlContent
            });
            console.log(`📧 [Email Alert] Successfully sent report for bus ${data.busRegNo} to ${ADMIN_EMAIL}`);
            return true;
        }
        catch (err) {
            console.error('❌ [Email Alert] Failed to send via transporter:', err.message);
        }
    }
    else {
        console.log(`ℹ️ [Email Alert Dispatch] Prepared email to ${ADMIN_EMAIL}:
    Subject: ⚠️ [UP BUS REPORT] ${data.reportType} - Bus ${data.busRegNo}
    Note: Set SMTP_USER & SMTP_PASS in .env to deliver directly to inbox.`);
    }
    return false;
}
