/**
2:  * swHelper.ts
3:  * Helper functions for Service Worker registration and Web Push notifications.
4:  */

function urlBase64ToUint8Array(base64String: string) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/\-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

/**
 * Register service worker if supported
 */
export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
    try {
      const registration = await navigator.serviceWorker.register('/sw.js');
      console.log('📬 Service Worker registered with scope:', registration.scope);
      return registration;
    } catch (error) {
      console.error('❌ Service Worker registration failed:', error);
    }
  }
  return null;
}

/**
 * Check if the browser is currently subscribed to push notifications
 */
export async function getPushSubscription(): Promise<PushSubscription | null> {
  if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
    const registration = await navigator.serviceWorker.ready;
    return await registration.pushManager.getSubscription();
  }
  return null;
}

/**
 * Subscribe user to push notifications
 * @param apiBase Backend API url
 */
export async function subscribeToNotifications(apiBase: string): Promise<PushSubscription | null> {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator) || !('PushManager' in window)) {
    console.warn('Push notifications are not supported in this browser.');
    return null;
  }

  try {
    const registration = await navigator.serviceWorker.ready;
    
    // Check permission status
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      throw new Error('Notification permission denied.');
    }

    // 1. Fetch public VAPID key
    let publicKey = 'BF1mkJgxzEjWPZsPiMClod6z6GUISG0wuEGyY8Y-p1Xf1ychnHvCstx6GCqIooHh-jrnBmAK2GUy_VUnGVwrPoQ';
    try {
      const keyResponse = await fetch('/api/push-sub');
      if (keyResponse.ok) {
        const kData = await keyResponse.json();
        if (kData.publicKey) publicKey = kData.publicKey;
      }
    } catch (e) {
      console.warn('Using default VAPID key');
    }

    // 2. Subscribe client using key
    let subscription: PushSubscription | null = null;
    try {
      const options = {
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey)
      };
      subscription = await registration.pushManager.subscribe(options);
    } catch (subErr) {
      console.warn('Browser push manager subscribe error:', subErr);
      // Fallback: Still grant local browser notifications
      return { endpoint: 'local_granted' } as any;
    }
    
    // 3. Post subscription to backend / serverless
    try {
      await fetch('/api/push-sub', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subscription })
      });
    } catch (e) {
      console.warn('Backend sub register non-critical error:', e);
    }

    console.log('🔔 Push notification subscription successful!');
    return subscription;
  } catch (error) {
    console.error('❌ Notification subscription failed:', error);
    throw error;
  }
}

/**
 * Unsubscribe user from push notifications
 * @param apiBase Backend API url
 */
export async function unsubscribeFromNotifications(apiBase: string): Promise<boolean> {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
    return false;
  }

  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();

    if (!subscription) {
      return false;
    }

    // 1. Remove from backend
    await fetch(`${apiBase}/push/unsubscribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoint: subscription.endpoint })
    });

    // 2. Unsubscribe locally
    const unsubscribed = await subscription.unsubscribe();
    console.log('🔕 Push notification subscription removed.');
    return unsubscribed;
  } catch (error) {
    console.error('❌ Failed to unsubscribe:', error);
    return false;
  }
}
