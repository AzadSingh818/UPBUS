import { NextResponse } from 'next/server';

const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || 'BF1mkJgxzEjWPZsPiMClod6z6GUISG0wuEGyY8Y-p1Xf1ychnHvCstx6GCqIooHh-jrnBmAK2GUy_VUnGVwrPoQ';

export async function GET() {
  return NextResponse.json({ publicKey: VAPID_PUBLIC_KEY });
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    return NextResponse.json({ success: true, message: 'Subscribed to arrival alerts.' });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
