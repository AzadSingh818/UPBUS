"use strict";
/**
 * Centralized Margdarshi live bus data fetching service.
 * Uses the correct UPSRTC endpoint with proper error handling and timeout.
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.fetchMargdarshiLiveData = fetchMargdarshiLiveData;
async function fetchMargdarshiLiveData() {
    try {
        const fetch = (await Promise.resolve().then(() => __importStar(require('node-fetch')))).default;
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 15000); // 15-second timeout
        const response = await fetch('https://margdarshi.upsrtcvlt.com/php/getGpsLiveData.php', {
            method: 'POST',
            headers: { 'User-Agent': 'Mozilla/5.0' },
            signal: controller.signal
        });
        clearTimeout(timeoutId);
        if (!response.ok) {
            console.error(`[Margdarshi Client] HTTP ${response.status}: ${response.statusText}`);
            return [];
        }
        const rawText = await response.text();
        const data = JSON.parse(rawText);
        if (!Array.isArray(data)) {
            console.warn('[Margdarshi Client] Expected array response, got:', typeof data);
            return [];
        }
        return data;
    }
    catch (error) {
        console.error('[Margdarshi Client] Error fetching live data:', error);
        return [];
    }
}
