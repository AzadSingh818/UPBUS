/**
 * Centralized Margdarshi live bus data fetching service.
 * Uses the correct UPSRTC endpoint with proper error handling and timeout.
 */

export async function fetchMargdarshiLiveData(): Promise<any[]> {
  try {
    const fetch = (await import('node-fetch')).default;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000); // 15-second timeout

    const response = await fetch(
      'https://margdarshi.upsrtcvlt.com/php/getGpsLiveData.php',
      {
        method: 'POST',
        headers: { 'User-Agent': 'Mozilla/5.0' },
        signal: controller.signal as any
      }
    );

    clearTimeout(timeoutId);

    if (!response.ok) {
      console.error(
        `[Margdarshi Client] HTTP ${response.status}: ${response.statusText}`
      );
      return [];
    }

    const rawText = await response.text();
    const data = JSON.parse(rawText);

    if (!Array.isArray(data)) {
      console.warn(
        '[Margdarshi Client] Expected array response, got:',
        typeof data
      );
      return [];
    }

    return data;
  } catch (error) {
    console.error('[Margdarshi Client] Error fetching live data:', error);
    return [];
  }
}
