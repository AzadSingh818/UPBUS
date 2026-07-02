"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getVapidPublicKey = getVapidPublicKey;
exports.saveSubscription = saveSubscription;
exports.removeSubscription = removeSubscription;
exports.sendNotificationToAll = sendNotificationToAll;
exports.sendArrivalNotification = sendArrivalNotification;
const web_push_1 = __importDefault(require("web-push"));
const db_1 = require("../db");
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
// VAPID keys identifying the application server
let publicKey = process.env.VAPID_PUBLIC_KEY || '';
let privateKey = process.env.VAPID_PRIVATE_KEY || '';
const mailto = process.env.VAPID_EMAIL || 'mailto:support@upbus.in';
if (!publicKey || !privateKey) {
    console.warn('⚠️ [NotificationService] VAPID keys not configured in .env. Generating keys for this session...');
    const keys = web_push_1.default.generateVAPIDKeys();
    publicKey = keys.publicKey;
    privateKey = keys.privateKey;
    console.log(`🔑 Generated Session VAPID Keys:
  VAPID_PUBLIC_KEY=${publicKey}
  VAPID_PRIVATE_KEY=${privateKey}
  `);
}
web_push_1.default.setVapidDetails(mailto, publicKey, privateKey);
function getVapidPublicKey() {
    return publicKey;
}
/**
 * Register a user's push subscription in the database
 */
async function saveSubscription(subscription) {
    if (!subscription || !subscription.endpoint) {
        throw new Error('Invalid subscription payload');
    }
    const endpoint = subscription.endpoint;
    const p256dh = subscription.keys?.p256dh || '';
    const auth = subscription.keys?.auth || '';
    await (0, db_1.query)(`INSERT INTO push_subscriptions (endpoint, p256dh, auth) 
     VALUES ($1, $2, $3)
     ON CONFLICT (endpoint) 
     DO UPDATE SET p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth`, [endpoint, p256dh, auth]);
}
/**
 * Delete a user's subscription
 */
async function removeSubscription(endpoint) {
    await (0, db_1.query)('DELETE FROM push_subscriptions WHERE endpoint = $1', [endpoint]);
}
/**
 * Send Web Push notification to all active subscribers
 */
async function sendNotificationToAll(payload) {
    try {
        const res = await (0, db_1.query)('SELECT endpoint, p256dh, auth FROM push_subscriptions');
        if (!res.rows || res.rows.length === 0) {
            return;
        }
        const payloadString = JSON.stringify(payload);
        console.log(`📤 Sending push notification to ${res.rows.length} subscribers...`);
        const promises = res.rows.map(async (row) => {
            const sub = {
                endpoint: row.endpoint,
                keys: {
                    p256dh: row.p256dh,
                    auth: row.auth
                }
            };
            try {
                await web_push_1.default.sendNotification(sub, payloadString);
            }
            catch (err) {
                // If subscription has expired or is invalid (410 Gone / 404 Not Found), remove it
                if (err.statusCode === 410 || err.statusCode === 404) {
                    console.log(`🗑️ Removing expired subscription: ${row.endpoint}`);
                    await removeSubscription(row.endpoint);
                }
                else {
                    console.error(`⚠️ Failed to push to endpoint ${row.endpoint}:`, err.message);
                }
            }
        });
        await Promise.all(promises);
    }
    catch (error) {
        console.error('Error broadcasting notifications:', error);
    }
}
/**
 * Send notification for a specific bus arrival
 */
async function sendArrivalNotification(busRegNo, stopName, minutes) {
    const title = `Bus Arriving Soon! 🚌`;
    const body = `Bus ${busRegNo} is arriving at ${stopName} in about ${minutes} minutes.`;
    await sendNotificationToAll({
        title,
        body,
        tag: `arrival-${busRegNo}`,
        icon: '/favicon.ico'
    });
}
