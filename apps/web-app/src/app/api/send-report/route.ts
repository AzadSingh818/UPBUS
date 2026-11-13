import { NextResponse } from 'next/server';
import nodemailer from 'nodemailer';

const ADMIN_EMAIL = 'exnavodayanfoundationcoe@gmail.com';

const transporter = nodemailer.createTransport({
  host: 'smtp.gmail.com',
  port: 465,
  secure: true,
  auth: {
    user: 'exnavodayanfoundationcoe@gmail.com',
    pass: 'gogveceglbrjkqfo'
  }
});

export async function POST(req: Request) {
  try {
    const data = await req.json();
    const { busRegNo, routeName, reportType, description, passengerContact, latitude, longitude } = data;

    if (!busRegNo || !reportType) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const mapLink = latitude && longitude
      ? `https://www.google.com/maps?q=${latitude},${longitude}`
      : 'Not available';

    const dateStr = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });

    const htmlContent = `
      <div style="font-family: Arial, sans-serif; background-color: #0f172a; color: #f8fafc; padding: 24px; border-radius: 12px; max-width: 600px; margin: 0 auto; border: 1px solid #334155;">
        <div style="display: flex; align-items: center; border-bottom: 2px solid #ef4444; padding-bottom: 12px; margin-bottom: 16px;">
          <h2 style="color: #ef4444; margin: 0; font-size: 20px;">⚠️ UP Bus Passenger Alert / Report</h2>
        </div>

        <p style="font-size: 14px; color: #cbd5e1; margin-bottom: 20px;">
          A passenger has submitted an operational alert for bus <strong>${busRegNo}</strong>.
        </p>

        <table style="width: 100%; border-collapse: collapse; font-size: 14px; margin-bottom: 20px;">
          <tr>
            <td style="padding: 8px 12px; background: #1e293b; color: #94a3b8; width: 35%;"><strong>Bus Reg No:</strong></td>
            <td style="padding: 8px 12px; background: #1e293b; color: #38bdf8; font-weight: bold;">${busRegNo}</td>
          </tr>
          ${routeName ? `
          <tr>
            <td style="padding: 8px 12px; color: #94a3b8;"><strong>Route:</strong></td>
            <td style="padding: 8px 12px; color: #f8fafc;">${routeName}</td>
          </tr>` : ''}
          <tr>
            <td style="padding: 8px 12px; background: #1e293b; color: #94a3b8;"><strong>Issue Type:</strong></td>
            <td style="padding: 8px 12px; background: #1e293b; color: #f59e0b; font-weight: bold;">${reportType}</td>
          </tr>
          <tr>
            <td style="padding: 8px 12px; color: #94a3b8;"><strong>Passenger Note:</strong></td>
            <td style="padding: 8px 12px; color: #f8fafc;">${description || 'No description provided'}</td>
          </tr>
          ${passengerContact ? `
          <tr>
            <td style="padding: 8px 12px; background: #1e293b; color: #94a3b8;"><strong>Contact / Info:</strong></td>
            <td style="padding: 8px 12px; background: #1e293b; color: #a3e635;">${passengerContact}</td>
          </tr>` : ''}
          <tr>
            <td style="padding: 8px 12px; color: #94a3b8;"><strong>Reported Time:</strong></td>
            <td style="padding: 8px 12px; color: #f8fafc;">${dateStr}</td>
          </tr>
          <tr>
            <td style="padding: 8px 12px; background: #1e293b; color: #94a3b8;"><strong>GPS Location:</strong></td>
            <td style="padding: 8px 12px; background: #1e293b;">
              ${latitude && longitude ? `<a href="${mapLink}" target="_blank" style="color: #60a5fa; text-decoration: underline;">View Live on Google Maps (${Number(latitude).toFixed(4)}, ${Number(longitude).toFixed(4)})</a>` : 'Location not available'}
            </td>
          </tr>
        </table>

        <div style="font-size: 12px; color: #64748b; border-top: 1px solid #334155; padding-top: 12px; text-align: center;">
          UP Bus Live Fleet System • Automated Real-time Dispatch
        </div>
      </div>
    `;

    await transporter.sendMail({
      from: `"UP Bus Alert System" <${ADMIN_EMAIL}>`,
      to: ADMIN_EMAIL,
      subject: `⚠️ [UP BUS REPORT] ${reportType} - Bus ${busRegNo}`,
      html: htmlContent
    });

    return NextResponse.json({ success: true, message: 'Email dispatched successfully.' });
  } catch (error: any) {
    console.error('Error dispatching report email:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

